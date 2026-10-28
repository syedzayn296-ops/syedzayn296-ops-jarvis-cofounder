"use strict";

// Shared durability primitives for the six protected JSON files.
//
// Atomic replacement is temp-write + rename in the target directory. This keeps
// the previous bytes intact until the new complete file is renamed into place.
// It is deliberately not an fsync/power-loss guarantee: the process does not
// claim durability across an operating-system or hardware crash.
//
// Backups are never pruned here. A backup is created only when a target already
// exists, and an existing backup name is never overwritten.
//
// Missing-file creation uses a hard-link create-if-absent operation: the
// complete temp file is linked into place only when the target name is free.
// If another process wins, that file is read and returned unchanged.
//
// The writer lock is one exclusive lockfile per writer transaction. Production
// protected writes in index.js use that API and provide an explicit lock path.
// The lock is created with the exclusive ("wx") flag, so two processes cannot
// both create it. Lock ownership is the random token recorded in the metadata;
// release removes the file only if that token still matches.
//
// Stale-lock policy (conservative):
//   * A live PID is treated as a live owner even when the lock is old. Node has
//     no portable process-start identity, so a reused PID could belong to an
//     unrelated process; refusing is safer than reclaiming.
//   * Reclaim is attempted only when the OS reports the owner PID as definitely
//     dead (ESRCH). Reclaim is serialised through a separate exclusive .reclaim
//     marker, and the dead-owner metadata is re-read before the old lock is
//     removed.
//   * Ambiguous liveness, malformed metadata, or a recovery marker that cannot
//     be safely attributed always fail closed. The operator must confirm that
//     no Cofounder process is running before removing such a file manually.
//
// Writer transactions:
//   * withWriterLock(operation, options) acquires the writer lock, creates an
//     opaque transaction capability, invokes operation(tx), and releases the
//     lock after a synchronous result or a returned promise/thenable settles.
//   * index.js uses withWriterLock() for all production protected writes and
//     supplies one explicit lock path per transaction. Protected writes require
//     that exact transaction object; the transaction is backed by a module-private
//     WeakMap, and caller-supplied file/token fields are never accepted as proof
//     of ownership.
//   * Transaction error codes:
//       COFOUNDER_TX_REQUIRED        no transaction argument
//       COFOUNDER_TX_INVALID         unknown/forged transaction object
//       COFOUNDER_TX_RELEASED        transaction already ended
//       COFOUNDER_TX_LOCK_LOST       lock metadata is missing, malformed, or
//                                    no longer carries this transaction's token
//       COFOUNDER_TX_NESTED          another transaction is already active in
//                                    this process
//       COFOUNDER_TX_RELEASE_FAILED  the callback succeeded, but the lock could
//                                    not be released by this transaction
//   * A release failure after a callback failure does not replace the callback
//     error; it is attached as error.releaseError.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_LOCK_FILE = ".cofounder-state.lock";

// The process-local slot exists only to reject nested/overlapping acquisitions.
// It never authorizes a write; authorization always comes from the exact object
// key in transactionRecords plus the active record state.
const transactionRecords = new WeakMap();
let activeTransaction = null;

function createLockError(message) {
    const error = new Error(message);
    error.code = "COFOUNDER_LOCKED";
    return error;
}

function createTransactionError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function createExclusiveFile(file, content) {
    let fd;

    try {
        // "wx" is the ownership boundary. If it fails, this invocation did not
        // create the target and must not unlink whatever already exists there.
        fd = fs.openSync(file, "wx");
    } catch (error) {
        throw error;
    }

    try {
        fs.writeFileSync(fd, content);
        fs.closeSync(fd);
        fd = null;
    } catch (error) {
        // Cleanup is limited to the file this invocation positively created
        // via the exclusive open above.
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch (_) {}
        }
        try {
            fs.unlinkSync(file);
        } catch (_) {}
        throw error;
    }
}

function writeTemporaryFile(target, content) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const temp = path.join(
            path.dirname(target),
            `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
        );

        try {
            fs.writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
            return temp;
        } catch (error) {
            if (error.code === "EEXIST") {
                // Another file already owns this random name. Never unlink it;
                // choose a fresh name instead.
                continue;
            }
            try {
                fs.unlinkSync(temp);
            } catch (_) {}
            throw error;
        }
    }

    throw new Error(`Could not create a unique temporary file for ${target}`);
}

function backupExistingFile(target) {
    const original = fs.readFileSync(target);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let suffix = 0;

    while (true) {
        const candidate = `${target}.${stamp}${suffix === 0 ? "" : `.${suffix}`}.bak`;
        try {
            createExclusiveFile(candidate, original);
            return candidate;
        } catch (error) {
            if (error.code === "EEXIST") {
                suffix += 1;
                continue;
            }
            throw error;
        }
    }
}

function writeProtectedJson(tx, file, data) {
    assertActiveTransaction(tx);
    const target = path.resolve(file);
    const content = JSON.stringify(data, null, 2);
    let temp = null;
    let backup = null;

    try {
        temp = writeTemporaryFile(target, content);

        // A caller holding a writer transaction reduces this check/rename
        // window for command-driven writes. The advisory lock remains
        // cooperative; it is not an OS-enforced multi-writer guarantee.
        if (fs.existsSync(target)) {
            backup = backupExistingFile(target);
        }

        fs.renameSync(temp, target);
        temp = null;
        return backup;
    } catch (error) {
        if (temp) {
            try {
                fs.unlinkSync(temp);
            } catch (_) {}
        }
        throw error;
    }
}

function createProtectedJsonIfAbsent(tx, file, data) {
    assertActiveTransaction(tx);
    const target = path.resolve(file);
    const content = JSON.stringify(data, null, 2);
    const temp = writeTemporaryFile(target, content);

    try {
        try {
            // A hard link is an atomic create-if-absent operation: the complete
            // temp file becomes visible at the target only if that name does
            // not already exist. It never replaces an existing target.
            fs.linkSync(temp, target);
        } catch (error) {
            // Some Windows/filesystem failures can surface without EEXIST even
            // though the target now exists. If it does exist, the other writer
            // won; load that file instead of replacing it.
            if (error.code !== "EEXIST" && !fs.existsSync(target)) {
                throw error;
            }
        }

        return JSON.parse(fs.readFileSync(target, "utf8"));
    } finally {
        try {
            fs.unlinkSync(temp);
        } catch (_) {}
    }
}

function defaultIsProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return "alive";
    } catch (error) {
        if (error && error.code === "ESRCH") return "dead";
        return "unknown";
    }
}

function processVerdict(isProcessAlive, pid) {
    try {
        const verdict = isProcessAlive(pid);
        if (verdict === "alive" || verdict === "dead") return verdict;
        return "unknown";
    } catch (_) {
        return "unknown";
    }
}

function readLockMetadata(lockFile) {
    let raw;

    try {
        raw = fs.readFileSync(lockFile, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }

    let metadata;
    try {
        metadata = JSON.parse(raw);
    } catch (_) {
        return { malformed: true };
    }

    if (
        !metadata ||
        !Number.isInteger(metadata.pid) ||
        metadata.pid <= 0 ||
        typeof metadata.createdAt !== "string" ||
        Number.isNaN(Date.parse(metadata.createdAt)) ||
        typeof metadata.token !== "string" ||
        metadata.token.length === 0
    ) {
        return { malformed: true };
    }

    return metadata;
}

function releaseLockFile(file, token) {
    let metadata;

    try {
        metadata = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return false;
        if (error instanceof SyntaxError) return false;
        throw error;
    }

    if (!metadata || metadata.token !== token) return false;

    try {
        fs.unlinkSync(file);
        return true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

function acquireWriterLock(options = {}) {
    const lockFile = path.resolve(options.lockFile || DEFAULT_LOCK_FILE);
    const reclaimFile = `${lockFile}.reclaim`;
    const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
    const token = crypto.randomBytes(16).toString("hex");
    const metadata = {
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token
    };

    if (fs.existsSync(reclaimFile)) {
        throw createLockError(
            `A stale-lock recovery marker exists at ${reclaimFile}. Refusing to write. ` +
            "Confirm no Cofounder process is running and remove the marker manually."
        );
    }

    try {
        createExclusiveFile(lockFile, JSON.stringify(metadata));
        return { file: lockFile, token };
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
    }

    const existing = readLockMetadata(lockFile);
    if (!existing || existing.malformed) {
        throw createLockError(
            `Writer-lock metadata at ${lockFile} is missing or malformed. Refusing to write. ` +
            "Confirm no Cofounder process is running and remove the lock manually."
        );
    }

    const ownerState = processVerdict(isProcessAlive, existing.pid);
    if (ownerState === "unknown") {
        throw createLockError(
            `Writer-lock owner PID ${existing.pid} at ${lockFile} could not be verified as alive or dead. ` +
            "Refusing to write."
        );
    }
    if (ownerState !== "dead") {
        throw createLockError(
            `Another Cofounder process (PID ${existing.pid}) holds the writer lock at ${lockFile}. ` +
            "Refusing to write."
        );
    }

    const reclaimToken = crypto.randomBytes(16).toString("hex");
    const reclaimMetadata = {
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token: reclaimToken
    };

    try {
        createExclusiveFile(reclaimFile, JSON.stringify(reclaimMetadata));
    } catch (error) {
        if (error.code === "EEXIST") {
            throw createLockError(
                `Another Cofounder process is already recovering the stale lock at ${lockFile}. ` +
                "Refusing to write."
            );
        }
        throw error;
    }

    try {
        const rechecked = readLockMetadata(lockFile);
        if (!rechecked || rechecked.malformed || rechecked.token !== existing.token) {
            throw createLockError(
                `The writer lock at ${lockFile} changed during stale-lock recovery. Refusing to write.`
            );
        }

        const recheckedState = processVerdict(isProcessAlive, rechecked.pid);
        if (recheckedState !== "dead") {
            throw createLockError(
                `The writer lock at ${lockFile} is no longer demonstrably stale. Refusing to write.`
            );
        }

        fs.unlinkSync(lockFile);
        createExclusiveFile(lockFile, JSON.stringify(metadata));
        return { file: lockFile, token };
    } finally {
        try {
            releaseLockFile(reclaimFile, reclaimToken);
        } catch (_) {
            // The main lock is already acquired. A leftover recovery marker is
            // fail-closed for later attempts and can be removed manually.
        }
    }
}

function releaseWriterLock(lock) {
    if (!lock || !lock.file || !lock.token) return false;
    return releaseLockFile(lock.file, lock.token);
}

function assertActiveTransaction(tx) {
    if (tx === undefined || tx === null) {
        throw createTransactionError(
            "COFOUNDER_TX_REQUIRED",
            "A protected JSON write requires an active writer transaction."
        );
    }

    const record = transactionRecords.get(tx);
    if (!record) {
        throw createTransactionError(
            "COFOUNDER_TX_INVALID",
            "The supplied writer transaction is not recognized."
        );
    }

    if (record.state !== "active") {
        throw createTransactionError(
            "COFOUNDER_TX_RELEASED",
            "The supplied writer transaction has already been released."
        );
    }

    // This token check narrows the stale-transaction window, but it is not an
    // atomic ownership guarantee: the lock can still change between this read
    // and the protected write. The advisory lock remains cooperative.
    let metadata;
    try {
        metadata = readLockMetadata(record.lock.file);
    } catch (error) {
        throw createTransactionError(
            "COFOUNDER_TX_LOCK_LOST",
            "The writer lock could not be verified for this transaction.",
            error
        );
    }

    if (!metadata || metadata.malformed || metadata.token !== record.lock.token) {
        throw createTransactionError(
            "COFOUNDER_TX_LOCK_LOST",
            "The writer lock is missing, malformed, or no longer owned by this transaction."
        );
    }

    return record;
}

function releaseTransaction(record, primaryError, hasPrimaryError = false) {
    if (record.state !== "active") return;

    // Mark the capability inactive before releasing the file. A write that races
    // with release must fail rather than observe a released lock as active.
    record.state = "released";
    if (activeTransaction === record) activeTransaction = null;

    let releaseError = null;
    try {
        if (!releaseWriterLock(record.lock)) {
            releaseError = createTransactionError(
                "COFOUNDER_TX_RELEASE_FAILED",
                "The writer lock could not be released by this transaction."
            );
        }
    } catch (error) {
        releaseError = createTransactionError(
            "COFOUNDER_TX_RELEASE_FAILED",
            "The writer lock could not be released by this transaction.",
            error
        );
    }

    if (hasPrimaryError) {
        if (releaseError) {
            try {
                primaryError.releaseError = releaseError;
            } catch (_) {
                // This low-level API cannot attach the release error to a
                // primitive or non-extensible thrown value; that value remains
                // primary. Production index.js normalizes such values before
                // the transaction so the release failure stays observable.
            }
        }
        return;
    }

    if (releaseError) throw releaseError;
}

function isThenable(value) {
    return value !== null &&
        (typeof value === "object" || typeof value === "function") &&
        typeof value.then === "function";
}

// operation(tx) may return a value, a promise, or any other thenable. When it
// returns a thenable, the returned value is a promise that settles only after
// the lock has been released.
function withWriterLock(operation, options = {}) {
    if (typeof operation !== "function") {
        throw new TypeError("withWriterLock() requires a function operation.");
    }

    // This slot is only a nested/overlap guard. It is not used to authorize a
    // write; authorization requires the exact transaction object as a WeakMap key.
    if (activeTransaction !== null) {
        throw createTransactionError(
            "COFOUNDER_TX_NESTED",
            "Nested or overlapping writer transactions are not supported."
        );
    }

    const lock = acquireWriterLock(options);
    const tx = Object.freeze(Object.create(null));
    const record = { lock, state: "active" };
    transactionRecords.set(tx, record);
    activeTransaction = record;

    let result;
    try {
        result = operation(tx);
    } catch (error) {
        releaseTransaction(record, error, true);
        throw error;
    }

    let settled;
    try {
        settled = isThenable(result) ? Promise.resolve(result) : null;
    } catch (error) {
        releaseTransaction(record, error, true);
        throw error;
    }

    if (settled) {
        return settled.then(
            value => {
                releaseTransaction(record, null);
                return value;
            },
            error => {
                releaseTransaction(record, error, true);
                throw error;
            }
        );
    }

    releaseTransaction(record, null);
    return result;
}

module.exports = {
    withWriterLock,
    writeProtectedJson,
    createProtectedJsonIfAbsent,
    acquireWriterLock,
    releaseWriterLock,
    defaultIsProcessAlive
};

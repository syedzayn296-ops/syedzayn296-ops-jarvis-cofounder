"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    withWriterLock,
    writeProtectedJson,
    createProtectedJsonIfAbsent,
    acquireWriterLock,
    releaseWriterLock
} = require("../state-store");

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "cofounder-durability-"));
}

function hash(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function withTestLock(dir, operation) {
    return withWriterLock(operation, {
        lockFile: path.join(dir, "writer.lock")
    });
}

test("atomic write failure preserves the original target", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    const baseline = JSON.stringify({ version: 1 }, null, 2);
    const originalRename = fs.renameSync;

    try {
        fs.writeFileSync(target, baseline, "utf8");
        fs.renameSync = () => {
            const error = new Error("injected rename failure");
            error.code = "EIO";
            throw error;
        };

        assert.throws(
            () => withTestLock(dir, tx => writeProtectedJson(tx, target, { version: 2 })),
            /injected rename failure/
        );
        assert.equal(fs.readFileSync(target, "utf8"), baseline);
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
            []
        );
    } finally {
        fs.renameSync = originalRename;
        cleanup(dir);
    }
});

test("a backup-write failure refuses the replacement and preserves the target", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    const baseline = JSON.stringify({ version: 1 }, null, 2);
    const originalOpen = fs.openSync;
    const originalWrite = fs.writeFileSync;
    const originalClose = fs.closeSync;
    const backupFds = new Set();
    let backupWriteAttempted = false;

    try {
        fs.writeFileSync(target, baseline, "utf8");
        fs.openSync = (file, flags, mode) => {
            const fd = originalOpen(file, flags, mode);
            if (String(file).endsWith(".bak")) {
                backupFds.add(fd);
            }
            return fd;
        };
        fs.writeFileSync = (file, data, options) => {
            if (typeof file === "number" && backupFds.has(file)) {
                backupWriteAttempted = true;
                const error = new Error("injected backup write failure");
                error.code = "EIO";
                throw error;
            }
            return originalWrite(file, data, options);
        };
        fs.closeSync = fd => {
            backupFds.delete(fd);
            return originalClose(fd);
        };

        assert.throws(
            () => withTestLock(dir, tx => writeProtectedJson(tx, target, { version: 2 })),
            /injected backup write failure/
        );
        assert.equal(
            backupWriteAttempted,
            true,
            "the failure must occur after the backup file is successfully created"
        );
        assert.equal(fs.readFileSync(target, "utf8"), baseline);
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
            []
        );
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".bak")),
            [],
            "a failed backup write must clean up its partial backup"
        );
        assert.equal(fs.existsSync(path.join(dir, "writer.lock")), false);
    } finally {
        fs.openSync = originalOpen;
        fs.writeFileSync = originalWrite;
        fs.closeSync = originalClose;
        cleanup(dir);
    }
});

test("backup contains the baseline bytes and restores the baseline hash", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");

    try {
        withTestLock(dir, tx => writeProtectedJson(tx, target, { version: 1 }));
        assert.equal(
            fs.readdirSync(dir).filter(name => name.endsWith(".bak")).length,
            0,
            "missing-file creation must not create a backup"
        );
        const baseline = fs.readFileSync(target);
        const baselineHash = hash(baseline);

        const backupPath = withTestLock(dir, tx => writeProtectedJson(tx, target, { version: 2 }));
        assert.ok(backupPath, "a backup path should be returned");
        assert.equal(fs.existsSync(backupPath), true);

        const backup = fs.readFileSync(backupPath);
        assert.equal(hash(backup), baselineHash);

        fs.writeFileSync(target, backup);
        assert.equal(hash(fs.readFileSync(target)), baselineHash);
    } finally {
        cleanup(dir);
    }
});

test("create-if-absent preserves a file created after the initial missing decision", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "tasks.json");
    const fallback = { version: 0, source: "fallback" };
    const winner = { version: 1, source: "other-process" };
    const winnerBytes = JSON.stringify(winner, null, 2);

    try {
        // This models loadJson() deciding the file is missing.
        assert.equal(fs.existsSync(target), false);

        // The other process wins before create-if-absent attempts the link.
        fs.writeFileSync(target, winnerBytes, "utf8");

        const loaded = withTestLock(dir, tx =>
            createProtectedJsonIfAbsent(tx, target, fallback)
        );
        assert.deepEqual(loaded, winner);
        assert.equal(fs.readFileSync(target, "utf8"), winnerBytes);
        assert.equal(
            fs.readdirSync(dir).filter(name => name.endsWith(".bak")).length,
            0,
            "a lost create race must not create or replace a backup"
        );
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
            []
        );
    } finally {
        cleanup(dir);
    }
});

test("create-if-absent initialises a genuinely missing file", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "reminders.json");
    const fallback = [{ message: "baseline" }];

    try {
        const loaded = withTestLock(dir, tx =>
            createProtectedJsonIfAbsent(tx, target, fallback)
        );
        assert.deepEqual(loaded, fallback);
        assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), fallback);
        assert.equal(
            fs.readdirSync(dir).filter(name => name.endsWith(".bak")).length,
            0,
            "missing-file creation must not create a backup"
        );
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
            []
        );
    } finally {
        cleanup(dir);
    }
});

test("create-if-absent failure leaves no partial target", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "memory.json");
    const originalLink = fs.linkSync;

    try {
        fs.linkSync = () => {
            const error = new Error("injected link failure");
            error.code = "EIO";
            throw error;
        };

        assert.throws(
            () => withTestLock(dir, tx =>
                createProtectedJsonIfAbsent(tx, target, [{ text: "baseline" }])
            ),
            /injected link failure/
        );
        assert.equal(fs.existsSync(target), false);
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
            []
        );
    } finally {
        fs.linkSync = originalLink;
        cleanup(dir);
    }
});

test("create-if-absent does not overwrite an unparseable winner", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "business.json");
    const invalidWinner = "{ invalid json";

    try {
        fs.writeFileSync(target, invalidWinner, "utf8");
        assert.throws(
            () => withTestLock(dir, tx =>
                createProtectedJsonIfAbsent(tx, target, { version: 0 })
            ),
            SyntaxError
        );
        assert.equal(fs.readFileSync(target, "utf8"), invalidWinner);
        assert.deepEqual(
            fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
            []
        );
    } finally {
        cleanup(dir);
    }
});

test("a second writer is refused while the first holds the lock", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");

    try {
        const first = acquireWriterLock({ lockFile });
        const held = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        assert.equal(held.pid, process.pid);
        assert.equal(typeof held.createdAt, "string");
        assert.ok(!Number.isNaN(Date.parse(held.createdAt)));
        assert.equal(typeof held.token, "string");
        assert.ok(held.token.length > 0);

        try {
            assert.throws(
                () => acquireWriterLock({ lockFile }),
                error => error
                    && error.code === "COFOUNDER_LOCKED"
                    && /holds the writer lock/.test(error.message)
            );
        } finally {
            assert.equal(releaseWriterLock(first), true);
        }

        assert.equal(fs.existsSync(lockFile), false);
    } finally {
        cleanup(dir);
    }
});

test("release removes only the lock owned by the caller", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");

    try {
        const lock = acquireWriterLock({ lockFile });
        const owned = JSON.parse(fs.readFileSync(lockFile, "utf8"));

        fs.writeFileSync(lockFile, JSON.stringify({
            ...owned,
            token: "different-owner"
        }), "utf8");

        assert.equal(releaseWriterLock(lock), false);
        assert.equal(fs.existsSync(lockFile), true);
        assert.equal(
            JSON.parse(fs.readFileSync(lockFile, "utf8")).token,
            "different-owner"
        );
    } finally {
        cleanup(dir);
    }
});

test("dead-owner reclaim is conservative; live, ambiguous, and malformed locks fail closed", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");
    const writeLock = metadata => fs.writeFileSync(lockFile, JSON.stringify(metadata), "utf8");

    try {
        writeLock({
            pid: 424242,
            createdAt: "2020-01-01T00:00:00.000Z",
            token: "dead-token"
        });
        const reclaimed = acquireWriterLock({ lockFile, isProcessAlive: () => "dead" });
        try {
            assert.notEqual(reclaimed.token, "dead-token");
            const acquired = JSON.parse(fs.readFileSync(lockFile, "utf8"));
            assert.equal(acquired.pid, process.pid);
        } finally {
            assert.equal(releaseWriterLock(reclaimed), true);
        }
        assert.equal(fs.existsSync(lockFile), false);
        assert.equal(fs.existsSync(`${lockFile}.reclaim`), false);

        writeLock({
            pid: 424242,
            createdAt: "2020-01-01T00:00:00.000Z",
            token: "live-token"
        });
        assert.throws(
            () => acquireWriterLock({ lockFile, isProcessAlive: () => "alive" }),
            error => error
                && error.code === "COFOUNDER_LOCKED"
                && /holds the writer lock/.test(error.message)
        );
        assert.equal(
            JSON.parse(fs.readFileSync(lockFile, "utf8")).token,
            "live-token",
            "an old lock with a live owner must not be reclaimed"
        );

        assert.throws(
            () => acquireWriterLock({ lockFile, isProcessAlive: () => "unknown" }),
            error => error
                && error.code === "COFOUNDER_LOCKED"
                && /could not be verified/.test(error.message)
        );
        assert.equal(JSON.parse(fs.readFileSync(lockFile, "utf8")).token, "live-token");

        fs.writeFileSync(lockFile, "not-json", "utf8");
        assert.throws(
            () => acquireWriterLock({ lockFile, isProcessAlive: () => "dead" }),
            error => error
                && error.code === "COFOUNDER_LOCKED"
                && /malformed/.test(error.message)
        );
        assert.equal(fs.readFileSync(lockFile, "utf8"), "not-json");
    } finally {
        cleanup(dir);
    }
});

test("index.js routes protected JSON writes through explicit writer transactions", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

    // Static source-shape check for the Phase 2B.2 integration. It does not
    // execute the application or prove cross-process exclusion.
    assert.match(source, /require\("\.\/state-store"\)/);
    assert.match(
        source,
        /const writerLockFile = path\.join\(__dirname, "\.cofounder-state\.lock"\);/
    );
    assert.match(source, /function withProtectedTransaction\(operation\) \{/);
    assert.match(source, /stateStore\.withWriterLock\(tx => \{/);
    assert.match(source, /stateStore\.createProtectedJsonIfAbsent\(tx, file, fallback\)/);
    assert.match(
        source,
        /function saveJson\(tx, file, data\) \{\s*return stateStore\.writeProtectedJson\(tx, file, data\);/
    );
    assert.doesNotMatch(
        source,
        /stateStore\.createProtectedJsonIfAbsent\((?!tx,)/,
        "missing-file creation must use a transaction"
    );
    assert.doesNotMatch(
        source,
        /stateStore\.writeProtectedJson\((?!tx,)/,
        "protected writes must use a transaction"
    );
    assert.doesNotMatch(
        source,
        /saveJson\((?!tx,)/,
        "saveJson call sites must pass the active transaction"
    );
    assert.doesNotMatch(
        source,
        /stateStore\.(acquireWriterLock|releaseWriterLock)\(/,
        "index.js must not use the legacy command-wide writer lock"
    );
    assert.doesNotMatch(
        source,
        /fs\.(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|writeSync)\(/,
        "index.js must not bypass state-store with direct protected-file writes"
    );
});

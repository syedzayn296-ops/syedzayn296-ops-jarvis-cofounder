"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    withWriterLock,
    writeProtectedJson,
    createProtectedJsonIfAbsent
} = require("../state-store");

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "cofounder-transaction-"));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function lockFileFor(dir) {
    return path.join(dir, "writer.lock");
}

function withTestLock(dir, operation) {
    return withWriterLock(operation, {
        lockFile: lockFileFor(dir)
    });
}

function replaceLockToken(dir, token) {
    const lockFile = lockFileFor(dir);
    const metadata = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    fs.writeFileSync(lockFile, JSON.stringify({
        ...metadata,
        token
    }), "utf8");
}

function assertNoTemporaryFiles(dir) {
    assert.deepEqual(
        fs.readdirSync(dir).filter(name => name.endsWith(".tmp")),
        []
    );
    assert.deepEqual(
        fs.readdirSync(dir).filter(name => name.endsWith(".bak")),
        []
    );
}

test("withWriterLock supports synchronous callbacks and releases the lock", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");

    try {
        const result = withTestLock(dir, tx =>
            writeProtectedJson(tx, target, { version: 1 })
        );

        assert.equal(result, null);
        assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { version: 1 });
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("withWriterLock waits for returned promises before releasing the lock", async () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    let releaseGate;
    const gate = new Promise(resolve => {
        releaseGate = resolve;
    });

    try {
        const pending = withTestLock(dir, async tx => {
            assert.equal(fs.existsSync(lockFileFor(dir)), true);
            writeProtectedJson(tx, target, { version: 1 });
            await gate;
            writeProtectedJson(tx, target, { version: 2 });
            return "done";
        });

        assert.equal(fs.existsSync(lockFileFor(dir)), true);
        releaseGate();

        assert.equal(await pending, "done");
        assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { version: 2 });
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("withWriterLock waits for returned thenables", async () => {
    const dir = makeTempDir();
    let releaseGate;
    const gate = new Promise(resolve => {
        releaseGate = resolve;
    });
    const thenable = {
        then(resolve) {
            gate.then(() => resolve("thenable-result"));
        }
    };

    try {
        const pending = withTestLock(dir, () => thenable);

        assert.equal(fs.existsSync(lockFileFor(dir)), true);
        releaseGate();

        assert.equal(await pending, "thenable-result");
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("a rejected thenable releases the lock", async () => {
    const dir = makeTempDir();
    const failure = new Error("thenable rejection");
    const thenable = {
        then(resolve, reject) {
            queueMicrotask(() => reject(failure));
        }
    };

    try {
        await assert.rejects(
            withTestLock(dir, () => thenable),
            error => error === failure
        );
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("a synchronous callback throw releases the lock", () => {
    const dir = makeTempDir();
    const failure = new Error("synchronous transaction failure");

    try {
        assert.throws(
            () => withTestLock(dir, () => {
                throw failure;
            }),
            error => error === failure
        );
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("a rejected transaction callback releases the lock", async () => {
    const dir = makeTempDir();
    const failure = new Error("asynchronous transaction failure");

    try {
        await assert.rejects(
            withTestLock(dir, async () => {
                await Promise.resolve();
                throw failure;
            }),
            error => error === failure
        );
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("missing and forged transactions are rejected before side effects", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    const baseline = JSON.stringify({ version: 1 }, null, 2);

    try {
        fs.writeFileSync(target, baseline, "utf8");

        assert.throws(
            () => writeProtectedJson(undefined, target, { version: 2 }),
            error => error.code === "COFOUNDER_TX_REQUIRED"
        );
        assert.throws(
            () => writeProtectedJson(
                Object.freeze({ file: lockFileFor(dir), token: "forged" }),
                target,
                { version: 2 }
            ),
            error => error.code === "COFOUNDER_TX_INVALID"
        );
        assert.throws(
            () => createProtectedJsonIfAbsent({}, target, { version: 2 }),
            error => error.code === "COFOUNDER_TX_INVALID"
        );

        assert.equal(fs.readFileSync(target, "utf8"), baseline);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("a released transaction cannot write", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    let captured;

    try {
        withTestLock(dir, tx => {
            captured = tx;
            writeProtectedJson(tx, target, { version: 1 });
        });

        assert.throws(
            () => writeProtectedJson(captured, target, { version: 2 }),
            error => error.code === "COFOUNDER_TX_RELEASED"
        );
        assert.throws(
            () => createProtectedJsonIfAbsent(captured, target, { version: 2 }),
            error => error.code === "COFOUNDER_TX_RELEASED"
        );
        assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { version: 1 });
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("a lost lock token invalidates the active transaction before a write", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");

    try {
        assert.throws(
            () => withTestLock(dir, tx => {
                replaceLockToken(dir, "different-owner");
                assert.throws(
                    () => writeProtectedJson(tx, target, { version: 1 }),
                    error => error.code === "COFOUNDER_TX_LOCK_LOST"
                );
            }),
            error => error.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.existsSync(lockFileFor(dir)), true);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("nested and overlapping transactions are rejected", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");

    try {
        const result = withTestLock(dir, tx => {
            assert.throws(
                () => withWriterLock(() => {}, { lockFile: lockFileFor(dir) }),
                error => error.code === "COFOUNDER_TX_NESTED"
            );
            writeProtectedJson(tx, target, { version: 1 });
            return "outer-complete";
        });

        assert.equal(result, "outer-complete");
        assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { version: 1 });
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

test("detached asynchronous work cannot write after the transaction ends", async () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    let captured;
    let detachedError;

    try {
        withTestLock(dir, tx => {
            captured = tx;
            setImmediate(() => {
                try {
                    writeProtectedJson(tx, target, { version: 1 });
                } catch (error) {
                    detachedError = error;
                }
            });
            return "released";
        });

        await new Promise(resolve => setImmediate(resolve));

        assert.ok(detachedError);
        assert.equal(detachedError.code, "COFOUNDER_TX_RELEASED");
        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("a callback error remains primary when release also fails", () => {
    const dir = makeTempDir();
    const callbackError = new Error("callback failed");

    try {
        assert.throws(
            () => withTestLock(dir, tx => {
                replaceLockToken(dir, "different-owner");
                throw callbackError;
            }),
            error => error === callbackError &&
                Boolean(error.releaseError) &&
                error.releaseError.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(fs.existsSync(lockFileFor(dir)), true);
    } finally {
        cleanup(dir);
    }
});

test("an active transaction whose lock file is deleted cannot write", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    const baseline = JSON.stringify({ version: 1 }, null, 2);

    try {
        fs.writeFileSync(target, baseline, "utf8");

        assert.throws(
            () => withTestLock(dir, tx => {
                fs.unlinkSync(lockFileFor(dir));
                assert.throws(
                    () => writeProtectedJson(tx, target, { version: 2 }),
                    error => error.code === "COFOUNDER_TX_LOCK_LOST"
                );
            }),
            error => error.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(fs.readFileSync(target, "utf8"), baseline);
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("malformed lock metadata invalidates the active transaction before a write", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    const baseline = JSON.stringify({ version: 1 }, null, 2);

    try {
        fs.writeFileSync(target, baseline, "utf8");

        assert.throws(
            () => withTestLock(dir, tx => {
                fs.writeFileSync(lockFileFor(dir), "not-json", "utf8");
                assert.throws(
                    () => writeProtectedJson(tx, target, { version: 2 }),
                    error => error.code === "COFOUNDER_TX_LOCK_LOST"
                );
            }),
            error => error.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(fs.readFileSync(target, "utf8"), baseline);
        assert.equal(fs.readFileSync(lockFileFor(dir), "utf8"), "not-json");
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("an asynchronous callback rejection remains primary when release also fails", async () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    const baseline = JSON.stringify({ version: 1 }, null, 2);
    const callbackError = new Error("asynchronous callback failed");

    try {
        fs.writeFileSync(target, baseline, "utf8");

        const pending = withTestLock(dir, async () => {
            await Promise.resolve();
            replaceLockToken(dir, "different-owner");
            throw callbackError;
        });

        await assert.rejects(
            pending,
            error => error === callbackError &&
                Boolean(error.releaseError) &&
                error.releaseError.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(fs.readFileSync(target, "utf8"), baseline);
        assert.equal(fs.existsSync(lockFileFor(dir)), true);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("createProtectedJsonIfAbsent rejects a transaction whose lock has been lost", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "tasks.json");
    const fallback = { version: 1 };

    try {
        assert.throws(
            () => withTestLock(dir, tx => {
                replaceLockToken(dir, "different-owner");
                assert.throws(
                    () => createProtectedJsonIfAbsent(tx, target, fallback),
                    error => error.code === "COFOUNDER_TX_LOCK_LOST"
                );
            }),
            error => error.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.existsSync(lockFileFor(dir)), true);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("a successful asynchronous callback with a failed release rejects without reporting success", async () => {
    const dir = makeTempDir();
    const target = path.join(dir, "cofounder-state.json");
    let callbackCompleted = false;

    try {
        const pending = withTestLock(dir, async () => {
            await Promise.resolve();
            replaceLockToken(dir, "different-owner");
            callbackCompleted = true;
            return "callback-result";
        });

        await assert.rejects(
            pending,
            error => error.code === "COFOUNDER_TX_RELEASE_FAILED"
        );

        assert.equal(callbackCompleted, true);
        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.existsSync(lockFileFor(dir)), true);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("createProtectedJsonIfAbsent requires an active transaction", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "tasks.json");
    const fallback = { version: 1 };

    try {
        assert.throws(
            () => createProtectedJsonIfAbsent(undefined, target, fallback),
            error => error.code === "COFOUNDER_TX_REQUIRED"
        );
        assert.equal(fs.existsSync(target), false);

        const loaded = withTestLock(dir, tx =>
            createProtectedJsonIfAbsent(tx, target, fallback)
        );
        assert.deepEqual(loaded, fallback);
        assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), fallback);
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
        assertNoTemporaryFiles(dir);
    } finally {
        cleanup(dir);
    }
});

test("withWriterLock rejects a non-function operation before acquiring a lock", () => {
    const dir = makeTempDir();

    try {
        assert.throws(
            () => withWriterLock(null, { lockFile: lockFileFor(dir) }),
            /requires a function operation/
        );
        assert.equal(fs.existsSync(lockFileFor(dir)), false);
    } finally {
        cleanup(dir);
    }
});

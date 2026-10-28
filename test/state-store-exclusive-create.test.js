"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { acquireWriterLock } = require("../state-store");

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "cofounder-exclusive-create-"));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

test("exclusive create leaves an existing target byte-for-byte unchanged", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");
    const existing = JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token: "existing-owner-token"
    });

    try {
        fs.writeFileSync(lockFile, existing, "utf8");

        assert.throws(
            () => acquireWriterLock({ lockFile }),
            error => error
                && error.code === "COFOUNDER_LOCKED"
                && /holds the writer lock/.test(error.message)
        );
        assert.equal(fs.readFileSync(lockFile, "utf8"), existing);
    } finally {
        cleanup(dir);
    }
});

test("a non-EEXIST exclusive-create failure does not remove an existing target", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");
    const existing = "pre-existing-lock-bytes";
    const originalOpen = fs.openSync;

    try {
        fs.writeFileSync(lockFile, existing, "utf8");
        fs.openSync = (file, flags, mode) => {
            if (path.resolve(String(file)) === lockFile) {
                const error = new Error("injected open failure");
                error.code = "EACCES";
                throw error;
            }
            return originalOpen(file, flags, mode);
        };

        assert.throws(
            () => acquireWriterLock({ lockFile }),
            error => error
                && error.code === "EACCES"
                && /injected open failure/.test(error.message)
        );
        assert.equal(fs.readFileSync(lockFile, "utf8"), existing);
    } finally {
        fs.openSync = originalOpen;
        cleanup(dir);
    }
});

test("cleanup removes only the file created by a failed exclusive create", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");
    const otherFile = path.join(dir, "keep.txt");
    const originalWrite = fs.writeFileSync;

    try {
        fs.writeFileSync(otherFile, "keep", "utf8");
        fs.writeFileSync = (file, data, options) => {
            if (typeof file === "number") {
                const error = new Error("injected write failure");
                error.code = "EIO";
                throw error;
            }
            return originalWrite(file, data, options);
        };

        assert.throws(
            () => acquireWriterLock({ lockFile }),
            error => error
                && error.code === "EIO"
                && /injected write failure/.test(error.message)
        );
        assert.equal(fs.existsSync(lockFile), false);
        assert.equal(fs.readFileSync(otherFile, "utf8"), "keep");
    } finally {
        fs.writeFileSync = originalWrite;
        cleanup(dir);
    }
});

test("a failed reclaim-marker create does not remove the dead lock", () => {
    const dir = makeTempDir();
    const lockFile = path.join(dir, "writer.lock");
    const reclaimFile = `${lockFile}.reclaim`;
    const deadLock = JSON.stringify({
        pid: 424242,
        createdAt: "2020-01-01T00:00:00.000Z",
        token: "dead-owner-token"
    });
    const originalOpen = fs.openSync;

    try {
        fs.writeFileSync(lockFile, deadLock, "utf8");
        fs.openSync = (file, flags, mode) => {
            if (path.resolve(String(file)) === reclaimFile) {
                const error = new Error("injected reclaim open failure");
                error.code = "EACCES";
                throw error;
            }
            return originalOpen(file, flags, mode);
        };

        assert.throws(
            () => acquireWriterLock({ lockFile, isProcessAlive: () => "dead" }),
            error => error
                && error.code === "EACCES"
                && /injected reclaim open failure/.test(error.message)
        );
        assert.equal(fs.readFileSync(lockFile, "utf8"), deadLock);
        assert.equal(fs.existsSync(reclaimFile), false);
    } finally {
        fs.openSync = originalOpen;
        cleanup(dir);
    }
});

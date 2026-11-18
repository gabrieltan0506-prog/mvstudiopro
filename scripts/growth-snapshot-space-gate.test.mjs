import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_SNAPSHOT_RESERVE_BYTES, resolveSnapshotReserveBytes, requiredSnapshotBytes, assertSnapshotSpace, measureSnapshotSources, assertSnapshotSpaceForStore,
} from "./growth-snapshot-space-gate.mjs";

test("reserve: default when unset or empty; integer floor; invalid values refuse instead of disabling the reserve", () => {
  assert.equal(DEFAULT_SNAPSHOT_RESERVE_BYTES, 256 * 1024 * 1024);
  assert.equal(resolveSnapshotReserveBytes(undefined), DEFAULT_SNAPSHOT_RESERVE_BYTES);
  assert.equal(resolveSnapshotReserveBytes(""), DEFAULT_SNAPSHOT_RESERVE_BYTES);
  assert.equal(resolveSnapshotReserveBytes("0"), 0);
  assert.equal(resolveSnapshotReserveBytes("1048576.9"), 1048576);
  assert.equal(resolveSnapshotReserveBytes("1e9"), 1e9);
  for (const raw of ["-1", "abc", "NaN", "Infinity", " ", "12abc"])
    assert.throws(() => resolveSnapshotReserveBytes(raw), /growth_snapshot_reserve_invalid/, JSON.stringify(raw));
});

test("reserve reads GROWTH_SNAPSHOT_RESERVE_BYTES by default", t => {
  const saved = process.env.GROWTH_SNAPSHOT_RESERVE_BYTES;
  t.after(() => { if (saved === undefined) delete process.env.GROWTH_SNAPSHOT_RESERVE_BYTES; else process.env.GROWTH_SNAPSHOT_RESERVE_BYTES = saved; });
  process.env.GROWTH_SNAPSHOT_RESERVE_BYTES = "4096"; assert.equal(resolveSnapshotReserveBytes(), 4096);
  process.env.GROWTH_SNAPSHOT_RESERVE_BYTES = "bad"; assert.throws(() => resolveSnapshotReserveBytes(), /reserve_invalid/);
});

test("required = copy + max(largest linked, reserve)", () => {
  assert.equal(requiredSnapshotBytes({ copyBytes: 10, largestLinkedBytes: 100, reserveBytes: 50 }), 110);
  assert.equal(requiredSnapshotBytes({ copyBytes: 10, largestLinkedBytes: 30, reserveBytes: 50 }), 60);
  assert.equal(requiredSnapshotBytes({ copyBytes: 0, largestLinkedBytes: 0, reserveBytes: 0 }), 0);
});

test("space assertion boundaries: exactly required passes, one byte short or NaN fails with the documented message", () => {
  const base = { copyBytes: 10, largestLinkedBytes: 100, reserveBytes: 50 };
  assert.deepEqual(assertSnapshotSpace({ ...base, availableBytes: 110 }), { availableBytes: 110, required: 110 });
  assert.throws(() => assertSnapshotSpace({ ...base, availableBytes: 109 }), { message: "growth_snapshot_insufficient_space:available=109:required=110" });
  assert.throws(() => assertSnapshotSpace({ ...base, availableBytes: 0 }), /growth_snapshot_insufficient_space:available=0:required=110/);
  assert.throws(() => assertSnapshotSpace({ ...base, availableBytes: Number.NaN }), /growth_snapshot_insufficient_space/);
});

test("measure: copies summed, largest linked file found recursively, missing files count 0, symlinks not followed", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-space-gate-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "current.json"), "x".repeat(30));
  fs.writeFileSync(path.join(root, "runtime-meta.json"), "x".repeat(12));
  fs.mkdirSync(path.join(root, "platforms/nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "platforms/a.json"), "x".repeat(5));
  fs.writeFileSync(path.join(root, "platforms/nested/b.json"), "x".repeat(70));
  const big = path.join(root, "outside-big.bin"); fs.writeFileSync(big, "x".repeat(5000));
  fs.symlinkSync(big, path.join(root, "platforms/link.bin"));
  fs.mkdirSync(path.join(root, "platform-current")); fs.writeFileSync(path.join(root, "platform-current/douyin.current.json.gz"), "x".repeat(40));
  const measured = await measureSnapshotSources({
    storeDir: root, copyFiles: ["current.json", "runtime-meta.json", "absent.json"],
    linkedDirectories: ["platforms", "absent-dir"], linkedFiles: ["platform-current/douyin.current.json.gz", "platform-current/absent.gz"],
  });
  assert.deepEqual(measured, { copyBytes: 42, largestLinkedBytes: 70 });
});

test("store gate uses real free space: tiny reserve passes, absurd reserve refuses", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-space-gate-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = process.env.GROWTH_SNAPSHOT_RESERVE_BYTES;
  t.after(() => { if (saved === undefined) delete process.env.GROWTH_SNAPSHOT_RESERVE_BYTES; else process.env.GROWTH_SNAPSHOT_RESERVE_BYTES = saved; });
  const args = { storeDir: root, copyFiles: [], linkedDirectories: [], linkedFiles: [] };
  process.env.GROWTH_SNAPSHOT_RESERVE_BYTES = "1";
  const ok = await assertSnapshotSpaceForStore(args); assert(ok.availableBytes >= 1); assert.equal(ok.required, 1);
  process.env.GROWTH_SNAPSHOT_RESERVE_BYTES = String(2 ** 60);
  await assert.rejects(assertSnapshotSpaceForStore(args), /growth_snapshot_insufficient_space:available=\d+:required=\d+/);
  await assert.rejects(assertSnapshotSpaceForStore({ ...args, storeDir: path.join(root, "absent") }), { code: "ENOENT" });
});

test("snapshot CLI refuses before creating any directory when space is insufficient", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-space-gate-e2e-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = path.join(root, "store");
  fs.mkdirSync(path.join(store, "platform-current"), { recursive: true });
  fs.writeFileSync(path.join(store, "current.json"), "{}");
  fs.writeFileSync(path.join(store, "platform-current/douyin.current.json.gz"), "x");
  const output = path.join(store, "backups/current-batches/123-1");
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/snapshot-growth-platform-current-batch.mts", `--output=${output}`, "--batch-id=123-1"], {
    env: { ...process.env, GROWTH_STORE_DIR: store, GROWTH_SNAPSHOT_RESERVE_BYTES: String(2 ** 60) }, encoding: "utf8", timeout: 60_000,
  });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /growth_snapshot_insufficient_space:available=\d+:required=\d+/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert(!fs.existsSync(output)); assert(!fs.existsSync(path.join(store, "backups")));
  assert(!fs.existsSync(path.join(store, ".growth-store-mutation.lock")));
});

test("snapshot CLI with invalid reserve env refuses before creating any directory", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-space-gate-e2e-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "backups/current-batches/123-1");
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/snapshot-growth-platform-current-batch.mts", `--output=${output}`, "--batch-id=123-1"], {
    env: { ...process.env, GROWTH_STORE_DIR: root, GROWTH_SNAPSHOT_RESERVE_BYTES: "-5" }, encoding: "utf8", timeout: 60_000,
  });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /growth_snapshot_reserve_invalid/);
  assert(!fs.existsSync(path.join(root, "backups")));
});

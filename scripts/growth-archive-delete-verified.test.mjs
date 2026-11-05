import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cleanupReceiptSha256, deleteVerifiedArchive } from "./growth-archive-delete-verified.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
async function fixture(t, count = 1) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "growth-delete-verified-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "store");
  for (const name of ["2026-09-01-00", "2026-09-02-00", "2026-09-03-00"])
    await fs.mkdir(path.join(root, "archive", name), { recursive: true });
  const files = [];
  for (let i = 0; i < count; i++) {
    const raw = gzipSync(JSON.stringify({ items: i ? [{ id: i }] : [] }));
    const relative = `archive/2026-09-01-00/bilibili-${i}.json.gz`;
    await fs.writeFile(path.join(root, relative), raw);
    files.push({ path: relative, bytes: raw.length, sha256: sha(raw) });
  }
  const other = path.join(root, "archive/2026-09-01-00/douyin-keep.json.gz");
  await fs.writeFile(other, gzipSync('{"items":[{"id":"keep"}]}'));
  const receipt = { schemaVersion: 1, evidenceKind: "remote-restore",
    repository: "owner/private-data", createdAt: new Date().toISOString(), files,
    backup: { assets: [{ name: "fixture", sha256: "a".repeat(64) }], restores: [{ dir: "2026-09-01-00" }] } };
  const verifyEvidence = async value => ({ verified: true,
    receiptSha256: cleanupReceiptSha256(value), files: value.files });
  const options = { root, receipt, apply: true, approveSha256: cleanupReceiptSha256(receipt),
    verifyEvidence, journalPath: path.join(temp, "journal.jsonl") };
  return { root, temp, receipt, files, options, other };
}
const exists = file => fs.lstat(file).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; });

test("dry-run preserves every source and lock path; unverified is explicit", async t => {
  const f = await fixture(t, 2);
  const before = await fs.readdir(f.root);
  const result = await deleteVerifiedArchive({ root: f.root, receipt: f.receipt });
  assert.equal(result.evidenceVerified, false);
  assert.equal(result.completed, true);
  assert.equal(result.candidates, 2);
  assert.equal(result.removed.length, 0);
  assert.deepEqual(await fs.readdir(f.root), before);
  assert(await exists(path.join(f.root, f.files[0].path)));
  assert.equal(await exists(f.options.journalPath), false);
});

test("apply unlinks exact Bilibili files including valid empty items; mixed platform and directories remain", async t => {
  const f = await fixture(t, 2);
  const result = await deleteVerifiedArchive(f.options);
  assert.equal(result.removed.length, 2);
  assert.equal(result.removedLogicalBytes, f.files.reduce((n, row) => n + row.bytes, 0));
  assert.equal(result.actualFilesystemFreeBytesVerified, false);
  assert(await exists(f.other));
  assert(await exists(path.join(f.root, "archive/2026-09-01-00")));
  assert.equal(await exists(path.join(f.root, ".growth-platform-collection.lock")), false);
  assert.equal(await exists(path.join(f.root, ".growth-store-mutation.lock")), false);
  const journal = (await fs.readFile(f.options.journalPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(journal.map(row => row.event), ["start", "preflight", "unlink-intent", "unlinked", "unlink-intent", "unlinked", "completed"]);
});

test("apply requires exact review digest and verified remote evidence binding", async t => {
  const f = await fixture(t);
  await assert.rejects(deleteVerifiedArchive({ ...f.options, approveSha256: "f".repeat(64) }), /explicit_approval_required/);
  await assert.rejects(deleteVerifiedArchive({ ...f.options, verifyEvidence: undefined }), /remote_evidence_verifier_required/);
  for (const proof of [{ verified: true }, { verified: true, receiptSha256: f.options.approveSha256, files: [] }])
    await assert.rejects(deleteVerifiedArchive({ ...f.options, verifyEvidence: async () => proof }), /evidence_binding_invalid/);
  assert(await exists(path.join(f.root, f.files[0].path)));
  assert.equal(await exists(f.options.journalPath), false);
});

test("all-file preflight rejects changed source before deleting any sibling", async t => {
  const f = await fixture(t, 2);
  await fs.writeFile(path.join(f.root, f.files[1].path), gzipSync('{"items":["changed"]}'));
  await assert.rejects(deleteVerifiedArchive(f.options), /source_changed/);
  for (const row of f.files) assert(await exists(path.join(f.root, row.path)));
});

test("zero-byte source fails even when another healthy file exists", async t => {
  const f = await fixture(t, 2);
  await fs.truncate(path.join(f.root, f.files[1].path), 0);
  await assert.rejects(deleteVerifiedArchive(f.options), /source_changed/);
  assert(await exists(path.join(f.root, f.files[0].path)));
});

test("receipt cannot expand to other platforms, duplicate paths, traversal or zero bytes", async t => {
  const f = await fixture(t);
  for (const bad of [
    { ...f.files[0], path: "archive/2026-09-01-00/douyin-keep.json.gz" },
    { ...f.files[0], path: "archive/../bilibili-bad.json.gz" },
    { ...f.files[0], bytes: 0 },
  ]) await assert.rejects(deleteVerifiedArchive({ root: f.root, receipt: { ...f.receipt, files: [bad] } }), /file_scope_invalid/);
  await assert.rejects(deleteVerifiedArchive({ root: f.root, receipt: { ...f.receipt, files: [f.files[0], f.files[0]] } }), /file_scope_invalid/);
});

test("expired and future receipts never acquire source locks", async t => {
  const f = await fixture(t);
  for (const delta of [-25 * 3600000, 120000]) {
    await assert.rejects(deleteVerifiedArchive({ root: f.root,
      receipt: { ...f.receipt, createdAt: new Date(Date.now() + delta).toISOString() } }), /receipt_expired_or_future/);
  }
  assert.equal(await exists(path.join(f.root, ".growth-platform-collection.lock")), false);
});

test("latest two buckets cannot be deleted even with a matching receipt", async t => {
  const f = await fixture(t);
  const row = { ...f.files[0], path: f.files[0].path.replace("2026-09-01-00", "2026-09-02-00") };
  await fs.copyFile(path.join(f.root, f.files[0].path), path.join(f.root, row.path));
  await assert.rejects(deleteVerifiedArchive({ root: f.root, receipt: { ...f.receipt, files: [row] } }), /latest_bucket_protected/);
});

test("symlink file or bucket never follows target for cleanup", async t => {
  const f = await fixture(t);
  const file = path.join(f.root, f.files[0].path), saved = path.join(f.temp, "saved.gz");
  await fs.rename(file, saved); await fs.symlink(saved, file);
  await assert.rejects(deleteVerifiedArchive({ root: f.root, receipt: f.receipt }), /source_not_regular/);
  await fs.unlink(file);
  await fs.rename(path.dirname(file), path.join(f.temp, "saved-bucket"));
  await fs.symlink(path.join(f.temp, "saved-bucket"), path.dirname(file));
  await assert.rejects(deleteVerifiedArchive({ root: f.root, receipt: f.receipt }), /directory_type_invalid/);
  assert(await exists(saved));
});

test("busy leases never get stolen, including stale lock files", async t => {
  for (const name of [".growth-platform-collection.lock", ".growth-store-mutation.lock"]) {
    const f = await fixture(t);
    const lock = path.join(f.root, name);
    await fs.writeFile(lock, "other-owner");
    await fs.utimes(lock, new Date(0), new Date(0));
    await assert.rejects(deleteVerifiedArchive(f.options), /busy/);
    assert.equal(await fs.readFile(lock, "utf8"), "other-owner");
    assert(await exists(path.join(f.root, f.files[0].path)));
    if (name.includes("mutation")) assert.equal(await exists(path.join(f.root, ".growth-platform-collection.lock")), false);
  }
});

test("hardlinked snapshot means source unlink does not claim allocated space released", async t => {
  const f = await fixture(t);
  const snapshot = path.join(f.temp, "snapshot.gz");
  await fs.link(path.join(f.root, f.files[0].path), snapshot);
  const result = await deleteVerifiedArchive(f.options);
  assert.equal(result.unlinkedLastLinkAllocatedBytes, 0);
  assert(result.retainedByOtherLinksBytes > 0);
  assert(await exists(snapshot));
});

test("parallel apply cannot both acquire the store leases", async t => {
  const f = await fixture(t, 2);
  const results = await Promise.allSettled([
    deleteVerifiedArchive(f.options),
    deleteVerifiedArchive({ ...f.options, journalPath: path.join(f.temp, "other-journal.jsonl") }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(results.find(r => r.status === "rejected").reason.message, /busy/);
});

test("interrupted remote verification never writes source or approval journal", async t => {
  const f = await fixture(t);
  await assert.rejects(deleteVerifiedArchive({ ...f.options,
    verifyEvidence: async () => { throw Error("transfer_interrupted"); } }), /transfer_interrupted/);
  assert(await exists(path.join(f.root, f.files[0].path)));
  assert.equal(await exists(f.options.journalPath), false);
});

test("journal must be new and outside source; prior journal is preserved", async t => {
  const f = await fixture(t);
  await assert.rejects(deleteVerifiedArchive({ ...f.options, journalPath: path.join(f.root, "journal.jsonl") }), /journal_must_be_outside_store/);
  await fs.writeFile(f.options.journalPath, "existing-evidence");
  await assert.rejects(deleteVerifiedArchive(f.options), /EEXIST/);
  assert.equal(await fs.readFile(f.options.journalPath, "utf8"), "existing-evidence");
  assert(await exists(path.join(f.root, f.files[0].path)));
});

test("cancellation before apply leaves source and leases untouched", async t => {
  const f = await fixture(t), controller = new AbortController();
  controller.abort(Error("operator-cancelled"));
  await assert.rejects(deleteVerifiedArchive({ ...f.options, signal: controller.signal }), /operator-cancelled/);
  assert(await exists(path.join(f.root, f.files[0].path)));
  assert.equal(await exists(f.options.journalPath), false);
});

test("real CLI dry-run emits unverified plan without source mutation", async t => {
  const f = await fixture(t), receiptFile = path.join(f.temp, "receipt.json");
  await fs.writeFile(receiptFile, JSON.stringify(f.receipt));
  const result = spawnSync(process.execPath, ["scripts/growth-archive-delete-verified.mjs", "--root", f.root, "--receipt", receiptFile], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).evidenceVerified, false);
  assert(await exists(path.join(f.root, f.files[0].path)));
});

test("lease replaced after preflight stops deletion and preserves replacement owner", async t => {
  const f = await fixture(t, 3);
  const error = await deleteVerifiedArchive({ ...f.options, onJournal: async entry => {
    if (entry.event !== "preflight") return;
    const lock = path.join(f.root, ".growth-platform-collection.lock");
    await fs.unlink(lock);
    await fs.writeFile(lock, "replacement-owner", { flag: "wx" });
  }}).then(() => null, e => e);
  assert(error, "replaced lease must fail closed");
  assert.match(error.message, /lease_lost|ENOENT/);
  assert.equal(error.cleanupResult.removed.length, 0);
  assert.equal(await fs.readFile(path.join(f.root, ".growth-platform-collection.lock"), "utf8"), "replacement-owner");
  for (const row of f.files) assert(await exists(path.join(f.root, row.path)));
});

test("cancellation after one unlink records partial progress and retains remaining files", async t => {
  const f = await fixture(t, 6), controller = new AbortController();
  const error = await deleteVerifiedArchive({ ...f.options, signal: controller.signal,
    onJournal: async entry => { if (entry.event === "unlinked") controller.abort(Error("operator-cancelled-mid-batch")); },
  }).then(() => null, e => e);
  assert(error, "mid-batch cancellation must stop further unlinking");
  assert.match(error.message, /operator-cancelled-mid-batch/);
  assert.deepEqual(error.cleanupResult.removed, [f.files[0].path]);
  assert.equal(error.cleanupResult.completed, false);
  for (const row of f.files.slice(1)) assert(await exists(path.join(f.root, row.path)));
  const journal = (await fs.readFile(f.options.journalPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(journal.at(-1).event, "stopped");
  assert.deepEqual(journal.at(-1).result.removed, [f.files[0].path]);
});

test("写入删除意图后取消也必须保留尚未删除的来源", async t => {
  const f = await fixture(t), controller = new AbortController();
  const error = await deleteVerifiedArchive({ ...f.options, signal: controller.signal,
    onJournal: async entry => { if (entry.event === "unlink-intent") controller.abort(Error("cancel-before-unlink")); },
  }).then(() => null, e => e);
  assert(error, "删除前的取消必须中止当前文件");
  assert.match(error.message, /cancel-before-unlink/);
  assert.equal(error.cleanupResult.removed.length, 0);
  assert(await exists(path.join(f.root, f.files[0].path)));
});

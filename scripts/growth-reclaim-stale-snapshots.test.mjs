import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
const script = "scripts/growth-reclaim-stale-snapshots.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
const HOUR = 3600_000;
const deadPid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }));
const age = (file, hours) => { const t = new Date(Date.now() - hours * HOUR); fs.utimesSync(file, t, t); };
const exists = file => { try { fs.lstatSync(file); return true; } catch { return false; } };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-reclaim-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, "backups/current-batches"), archive = path.join(root, "backups/archive-offload");
  fs.mkdirSync(path.join(root, "platform-current"), { recursive: true });
  fs.mkdirSync(path.join(root, "paid-research/guaikei"), { recursive: true });
  fs.mkdirSync(path.join(root, "archive/2026-11-01"), { recursive: true });
  fs.mkdirSync(current, { recursive: true }); fs.mkdirSync(archive, { recursive: true });
  const sources = {
    platform: path.join(root, "platform-current/douyin.current.json.gz"),
    receipt: path.join(root, "paid-research/guaikei/00000000-0000-0000-0000-000000000001.raw.json"),
    bucket: path.join(root, "archive/2026-11-01/a.json"),
  };
  fs.writeFileSync(sources.platform, "platform-must-remain"); fs.writeFileSync(sources.receipt, '{"receipt":"must-remain"}');
  fs.writeFileSync(sources.bucket, '{"archive":"must-remain"}');
  const hashes = () => Object.fromEntries(Object.entries(sources).map(([k, f]) => [k, sha(fs.readFileSync(f))]));
  /** A real current snapshot: copied core, hardlinked platform + receipt, owner marker. */
  function currentBatch(name, { pid = deadPid, hours = 4, batchId = name, marker } = {}) {
    const dir = path.join(current, name);
    fs.mkdirSync(path.join(dir, "core"), { recursive: true });
    fs.mkdirSync(path.join(dir, "directories/paid-research/guaikei"), { recursive: true });
    fs.writeFileSync(path.join(dir, "core/current.json"), "{}");
    fs.linkSync(sources.platform, path.join(dir, "platform-current-douyin.current.json.gz"));
    fs.linkSync(sources.receipt, path.join(dir, "directories/paid-research/guaikei", path.basename(sources.receipt)));
    const markerFile = path.join(dir, ".snapshot-owner.json");
    fs.writeFileSync(markerFile, marker ?? JSON.stringify({ schemaVersion: 1, batchId, pid, createdAt: new Date().toISOString() }));
    age(markerFile, hours);
    return dir;
  }
  function archiveBatch(name, { hours = 25, batchId = name } = {}) {
    const dir = path.join(archive, name);
    fs.mkdirSync(path.join(dir, "inventories"), { recursive: true }); fs.mkdirSync(path.join(dir, "2026-11-01"));
    fs.writeFileSync(path.join(dir, "snapshot.tsv"), "2026-11-01\n");
    fs.writeFileSync(path.join(dir, "inventories/2026-11-01.json"), "{}"); // written by the snapshot itself: link count 1
    fs.linkSync(sources.bucket, path.join(dir, "2026-11-01/a.json"));
    const markerFile = path.join(dir, ".snapshot-owner.json");
    fs.writeFileSync(markerFile, JSON.stringify({ schemaVersion: 1, batchId, kind: "archive-hardlink-snapshot", creationToken: "t", probeDir: "" }));
    age(markerFile, hours);
    return dir;
  }
  return { root, current, archive, sources, hashes, currentBatch, archiveBatch };
}
const source = fs.readFileSync(script, "utf8");
/** Exactly as production: script text on stdin, root from GROWTH_STORE_DIR. */
function runStdin(f, args = [], env = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-", ...args], { input: source, cwd: os.tmpdir(), env: { ...process.env, GROWTH_STORE_DIR: f.root, ...env }, encoding: "utf8", timeout: 30_000 });
}
function runPath(f, args = []) {
  return spawnSync(process.execPath, [script, ...args], { env: { ...process.env, GROWTH_STORE_DIR: f.root }, encoding: "utf8", timeout: 30_000 });
}
const parse = r => { assert.equal(r.status, 0, r.stderr); const out = r.stdout.trim().split("\n"); assert.equal(out.length, 1); return JSON.parse(out[0]); };
const reasonOf = (result, batch) => result.retained.find(r => r.batch === batch)?.reason;

for (const [label, run] of [["stdin", runStdin], ["path", runPath]]) test(`${label}: over-age batch with exited owner is removed; sources and neighbouring batch stay byte-identical`, t => {
  const f = fixture(t), before = f.hashes();
  const stale = f.currentBatch("100-1"), neighbour = f.currentBatch("101-1", { hours: 1 });
  const neighbourHash = sha(fs.readFileSync(path.join(neighbour, "platform-current-douyin.current.json.gz")));
  const result = parse(run(f, ["--current-hours=3", "--archive-hours=24"]));
  assert.equal(result.ok, true); assert.equal(result.dryRun, false); assert.deepEqual(result.errors, []);
  assert.deepEqual(result.removed.map(r => [r.kind, r.batch]), [["current", "100-1"]]);
  assert(result.removed[0].bytes > 0);
  assert(!exists(stale)); assert(exists(neighbour));
  assert.equal(reasonOf(result, "101-1"), "too-new");
  assert.deepEqual(f.hashes(), before);
  assert.equal(sha(fs.readFileSync(path.join(neighbour, "platform-current-douyin.current.json.gz"))), neighbourHash);
});

test("default ages apply without arguments (3 h current)", t => {
  const f = fixture(t); f.currentBatch("100-1", { hours: 2.5 }); f.currentBatch("102-1", { hours: 3.5 });
  const result = parse(runStdin(f));
  assert.deepEqual(result.removed.map(r => r.batch), ["102-1"]); assert.equal(reasonOf(result, "100-1"), "too-new");
});

const retainedCases = {
  "too-new": f => { f.currentBatch("200-1", { hours: 1 }); return "too-new"; },
  // Marker must postdate this boot (a marker older than the boot proves the owner gone); the sandbox may have booted < 3 h ago.
  "owner alive": f => { f.currentBatch("200-1", { pid: process.pid, hours: 1 / 120 }); return ["owner-alive", ["--current-hours=0"]]; },
  "marker missing": f => { fs.rmSync(path.join(f.currentBatch("200-1"), ".snapshot-owner.json")); return /^error:ENOENT/; },
  "marker invalid JSON": f => { f.currentBatch("200-1", { marker: "{not-json" }); return /^error:/; },
  "batchId mismatch": f => { f.currentBatch("200-1", { batchId: "999-1" }); return "marker-invalid"; },
  "pid 1": f => { f.currentBatch("200-1", { pid: 1 }); return "marker-invalid"; },
  "symlinked marker": f => {
    const dir = f.currentBatch("200-1"), marker = path.join(dir, ".snapshot-owner.json");
    fs.renameSync(marker, path.join(f.root, "saved-marker.json")); fs.symlinkSync(path.join(f.root, "saved-marker.json"), marker);
    return /^error:marker-type/;
  },
  "bad directory name": f => { f.currentBatch("abc", { batchId: "abc" }); return "name-invalid"; },
  "sole-copy paid-research receipt": f => {
    f.currentBatch("200-1"); fs.writeFileSync(path.join(f.current, "200-1/directories/paid-research/guaikei/00000000-0000-0000-0000-000000000002.raw.json"), '{"only":"copy"}');
    return "sole-copy-receipt";
  },
};
for (const [label, setup] of Object.entries(retainedCases)) test(`current batch retained: ${label}`, t => {
  const f = fixture(t), [expected, args = []] = [setup(f)].flat(), batch = fs.readdirSync(f.current)[0], dir = path.join(f.current, batch);
  const tree = () => execFileSync("find", [dir, "-printf", "%P %y %s\\n"], { encoding: "utf8" });
  const before = tree(), hashes = f.hashes();
  const result = parse(runStdin(f, args));
  assert.deepEqual(result.removed, []);
  const reason = reasonOf(result, batch);
  if (expected instanceof RegExp) assert.match(String(reason), expected); else assert.equal(reason, expected);
  assert.equal(tree(), before); assert.deepEqual(f.hashes(), hashes);
});

test("marker older than this boot counts as exited even if its pid number is in use again", { skip: os.uptime() > 20 * 3600 && "host booted too long ago" }, t => {
  const f = fixture(t), dir = f.currentBatch("250-1", { pid: process.pid, hours: os.uptime() / 3600 + 1 });
  const result = parse(runStdin(f, ["--current-hours=0"]));
  assert.deepEqual(result.removed.map(r => r.batch), ["250-1"]); assert(!exists(dir));
});

test("symlinked batch directory is never followed or removed", t => {
  const f = fixture(t), real = f.currentBatch("300-1"), saved = path.join(f.root, "elsewhere-300-1");
  fs.renameSync(real, saved); fs.symlinkSync(saved, real);
  const result = parse(runStdin(f));
  assert.deepEqual(result.removed, []);
  assert(fs.lstatSync(real).isSymbolicLink()); assert(fs.existsSync(path.join(saved, ".snapshot-owner.json")));
  assert(fs.existsSync(path.join(saved, "platform-current-douyin.current.json.gz")));
});

test("symlinked backups/current-batches parent is refused as a whole", t => {
  const f = fixture(t); f.currentBatch("300-1");
  const saved = path.join(f.root, "elsewhere"); fs.renameSync(f.current, saved); fs.symlinkSync(saved, f.current);
  const result = parse(runStdin(f));
  assert.deepEqual(result.removed, []); assert.deepEqual(result.errors, [{ kind: "current", error: "path-invalid" }]);
  assert(fs.existsSync(path.join(saved, "300-1/.snapshot-owner.json")));
});

test("rewritten shared ledgers index.json/automation.json with link count 1 do not block removal", t => {
  const f = fixture(t), dir = f.currentBatch("400-1"), ledgers = path.join(dir, "directories/paid-research/guaikei");
  fs.writeFileSync(path.join(ledgers, "index.json"), "{}"); fs.writeFileSync(path.join(ledgers, "automation.json"), "{}");
  // The platform-current source was rewritten after the snapshot: the snapshot copy is the only link now.
  fs.rmSync(f.sources.platform); fs.writeFileSync(f.sources.platform, "rewritten");
  const before = f.hashes();
  const result = parse(runStdin(f));
  assert.deepEqual(result.removed.map(r => r.batch), ["400-1"]); assert(!exists(dir));
  assert(result.removed[0].reclaimableBytes >= "platform-must-remain".length);
  assert.deepEqual(f.hashes(), before);
});

test("--dry-run removes nothing but reports what would be removed", t => {
  const f = fixture(t), dir = f.currentBatch("500-1"), arch = f.archiveBatch("arch-1");
  const tree = () => execFileSync("find", [f.root, "-printf", "%P %y %s %n\\n"], { encoding: "utf8" });
  const before = tree();
  const result = parse(runStdin(f, ["--dry-run"]));
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.removed.map(r => [r.kind, r.batch]), [["current", "500-1"], ["archive", "arch-1"]]);
  assert(exists(dir)); assert(exists(arch)); assert.equal(tree(), before);
});

test("lock-free: reclaims while another process holds .growth-store-mutation.lock, and leaves the lock alone", async t => {
  const f = fixture(t), dir = f.currentBatch("600-1"), ready = path.join(f.root, "holder-ready");
  const holder = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import fs from "node:fs";
    import { withGrowthStoreMutationLock } from "./server/growth/growthStoreMutationLock.ts";
    await withGrowthStoreMutationLock("test-holder", async () => { fs.writeFileSync(process.env.READY, "1"); await new Promise(r => setTimeout(r, 60_000)); });
  `], { env: { ...process.env, GROWTH_STORE_DIR: f.root, READY: ready }, stdio: ["ignore", "ignore", "inherit"] });
  const exited = new Promise(resolve => holder.on("exit", resolve));
  t.after(async () => { holder.kill(); await exited; });
  for (let i = 0; i < 300 && !fs.existsSync(ready); i++) await new Promise(r => setTimeout(r, 100));
  assert(fs.existsSync(ready), "lock holder did not start");
  const lock = path.join(f.root, ".growth-store-mutation.lock"), lockBefore = fs.readFileSync(lock, "utf8");
  const started = Date.now();
  const result = parse(runStdin(f));
  assert(Date.now() - started < 10_000);
  assert.deepEqual(result.removed.map(r => r.batch), ["600-1"]); assert(!exists(dir));
  assert.equal(fs.readFileSync(lock, "utf8"), lockBefore);
});

test("missing backups directories: ok with empty lists", t => {
  const f = fixture(t); fs.rmSync(path.join(f.root, "backups"), { recursive: true });
  assert.deepEqual(parse(runStdin(f)), { ok: true, dryRun: false, removed: [], retained: [], errors: [] });
  assert.deepEqual(parse(runStdin(f, [], { GROWTH_STORE_DIR: path.join(f.root, "absent") })), { ok: true, dryRun: false, removed: [], retained: [], errors: [] });
});

for (const args of [["--bogus"], ["--current-hours=3", "extra"], ["--current-hours="], ["--current-hours=-1"], ["--archive-hours=abc"], ["--dry-run=1"]]) test(`argument ${JSON.stringify(args)} is rejected and nothing is removed`, t => {
  const f = fixture(t), dir = f.currentBatch("700-1"), arch = f.archiveBatch("arch-7");
  const result = runStdin(f, args);
  assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
  assert(exists(dir)); assert(exists(arch));
});

test("two names inside one batch pointing at the same receipt inode with no copy outside: batch retained, content survives", t => {
  const f = fixture(t), dir = f.currentBatch("300-1"), receipts = path.join(dir, "directories/paid-research/guaikei");
  const first = path.join(receipts, "00000000-0000-0000-0000-000000000009.raw.json");
  fs.writeFileSync(first, '{"only":"copy-with-two-names"}');
  fs.linkSync(first, path.join(receipts, "00000000-0000-0000-0000-000000000009.parsed.json")); // nlink 2，两条链接都在批内
  const result = parse(runStdin(f, ["--current-hours=3"]));
  assert.deepEqual(result.removed, []);
  assert.equal(reasonOf(result, "300-1"), "sole-copy-receipt");
  assert.equal(result.retained.find(r => r.batch === "300-1").soleCopies, 2);
  assert.equal(fs.readFileSync(first, "utf8"), '{"only":"copy-with-two-names"}');
  // 批外确有一条链接时不算唯一副本：整批可回收，批外副本内容不变。
  const g = fixture(t), other = g.currentBatch("301-1"), dup = path.join(other, "directories/paid-research/guaikei/dup.raw.json");
  fs.linkSync(g.sources.receipt, dup);
  const before = g.hashes(), second = parse(runStdin(g, ["--current-hours=3"]));
  assert.deepEqual(second.removed.map(r => r.batch), ["301-1"]); assert.deepEqual(g.hashes(), before);
});

test("archive-offload: interrupted <batch>.next staging dir is reclaimed when over-age and fully hardlinked; kept when too new or holding a sole copy", t => {
  const f = fixture(t), before = f.hashes();
  const stale = f.archiveBatch("456-1.next", { batchId: "456-1" });
  const young = f.archiveBatch("457-1.next", { batchId: "457-1", hours: 2 });
  const sole = f.archiveBatch("458-1.next", { batchId: "458-1" }); fs.writeFileSync(path.join(sole, "2026-11-01/only.json"), '{"only":"copy"}');
  const twin = f.archiveBatch("459-1.next", { batchId: "459-1" });
  fs.writeFileSync(path.join(twin, "2026-11-01/x.json"), '{"twin":"copy"}'); fs.linkSync(path.join(twin, "2026-11-01/x.json"), path.join(twin, "2026-11-01/y.json"));
  const result = parse(runStdin(f));
  assert.deepEqual(result.removed.map(r => [r.kind, r.batch]), [["archive", "456-1.next"]]);
  assert(!exists(stale));
  assert.equal(reasonOf(result, "457-1.next"), "too-new");
  assert.equal(reasonOf(result, "458-1.next"), "sole-copy-archive");
  assert.equal(reasonOf(result, "459-1.next"), "sole-copy-archive");
  for (const dir of [young, sole, twin]) assert(exists(path.join(dir, "2026-11-01/a.json")));
  assert.deepEqual(f.hashes(), before);
});

test("archive-offload: over-age all-hardlinked batch removed; sole-copy bucket file retained; .next and cursor untouched", t => {
  const f = fixture(t), before = f.hashes();
  const removable = f.archiveBatch("20261101T000000Z-1");
  const sole = f.archiveBatch("20261101T000000Z-2"); fs.writeFileSync(path.join(sole, "2026-11-01/only.json"), '{"only":"copy"}');
  const young = f.archiveBatch("20261101T000000Z-3", { hours: 2 });
  const wrongKind = f.archiveBatch("20261101T000000Z-4");
  fs.writeFileSync(path.join(wrongKind, ".snapshot-owner.json"), JSON.stringify({ schemaVersion: 1, batchId: "20261101T000000Z-4", kind: "other" }));
  age(path.join(wrongKind, ".snapshot-owner.json"), 30);
  // 标记批号带 .next 的不是归档脚本写出的合法暂存目录：保留。
  const next = f.archiveBatch("20261101T000000Z-5.next", { batchId: "20261101T000000Z-5.next" });
  const cursor = path.join(f.archive, ".rotation-cursor.json"); fs.writeFileSync(cursor, '{"schemaVersion":1,"lastDir":"2026-11-01"}');
  const cursorBefore = fs.readFileSync(cursor, "utf8");
  const result = parse(runStdin(f));
  assert.deepEqual(result.removed.map(r => [r.kind, r.batch]), [["archive", "20261101T000000Z-1"]]);
  assert(!exists(removable));
  assert.equal(reasonOf(result, "20261101T000000Z-2"), "sole-copy-archive");
  assert.equal(result.retained.find(r => r.batch === "20261101T000000Z-2").soleCopies, 1);
  assert.equal(reasonOf(result, "20261101T000000Z-3"), "too-new");
  assert.equal(reasonOf(result, "20261101T000000Z-4"), "marker-invalid");
  assert.equal(reasonOf(result, "20261101T000000Z-5.next"), "marker-invalid");
  for (const dir of [sole, young, wrongKind, next]) assert(exists(path.join(dir, "2026-11-01/a.json")));
  assert.equal(fs.readFileSync(path.join(sole, "2026-11-01/only.json"), "utf8"), '{"only":"copy"}');
  assert.equal(fs.readFileSync(cursor, "utf8"), cursorBefore);
  assert.deepEqual(f.hashes(), before);
  assert(!result.retained.some(r => r.batch === ".rotation-cursor.json"));
});

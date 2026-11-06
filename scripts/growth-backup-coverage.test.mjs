import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inventoryGrowthCoverage, REQUIRED_CORE_FILES, REQUIRED_CURRENT_PLATFORMS } from "./growth-backup-coverage.mjs";

const hash = raw => createHash("sha256").update(raw).digest("hex");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-coverage-"));
  fs.mkdirSync(path.join(root, "platform-current"));
  fs.mkdirSync(path.join(root, "platforms"));
  fs.mkdirSync(path.join(root, "history-ledger"));
  const paid = path.join(root,"paid-research/guaikei"); fs.mkdirSync(paid,{recursive:true});
  const jobId="11111111-1111-4111-8111-111111111111";
  fs.writeFileSync(path.join(paid,"index.json"),JSON.stringify({version:1,jobs:[{id:jobId,input:{platform:"tiktok"},status:"completed",items:[{id:"tiktok-one"}]}]}));
  fs.writeFileSync(path.join(paid,"automation.json"),JSON.stringify({version:1,runs:[{platform:"tiktok",jobIds:[jobId]}]}));
  fs.writeFileSync(path.join(paid,`${jobId}.raw.json`),JSON.stringify({errcode:0,data:[{id:"tiktok-one"}]}));
  fs.writeFileSync(path.join(paid,`${jobId}.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.normalized.json`),JSON.stringify({items:[{id:"tiktok-one"}]}));
  for (const file of REQUIRED_CORE_FILES)
    fs.writeFileSync(path.join(root, file), file === "archive-index.json" ? "[]" : "{}");
  for (const platform of [...REQUIRED_CURRENT_PLATFORMS, "kuaishou", "toutiao"])
    fs.writeFileSync(path.join(root, "platform-current", `${platform}.current.json.gz`), gzipSync(JSON.stringify({ platform, collection: { items: platform === "bilibili" ? [] : [{ id: platform }] } })));
  return root;
}
function snapshot(root, id = "1-1") {
  const output = path.join(root, "backups/current-batches", id);
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/snapshot-growth-platform-current-batch.mts", `--output=${output}`, `--batch-id=${id}`, `--asset-generation=batch-${id}`], { env: { ...process.env, GROWTH_STORE_DIR: root }, encoding: "utf8", timeout: 30_000 });
  return { result, output };
}

for (const [label, value] of [
  ["正式包装对象", { updatedAt: "2026-11-06T00:00:00.000Z", archiveIndex: [{ platform: "bilibili", file: "archive/2026-11-04-15/bilibili.json.gz", itemCount: 1 }] }],
  ["旧数组", [{ platform: "douyin", file: "archive/2026-11-04-15/douyin.json.gz", itemCount: 2 }]],
  ["空包装对象", { updatedAt: "2026-11-06T00:00:00.000Z", archiveIndex: [] }],
]) {
  test(`archive-index ${label}保留原始字节和快照哈希`, t => {
    const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "archive-index.json");
    const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    fs.writeFileSync(source, raw);
    const { result, output } = snapshot(root);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, "snapshot-manifest.json")));
    const entry = manifest.coreFiles.find(file => file.relativePath === "archive-index.json");
    assert.equal(entry.bytes, raw.length); assert.equal(entry.sha256, hash(raw));
    assert.deepEqual(fs.readFileSync(path.join(output, entry.snapshotFile)), raw);
    assert.deepEqual(fs.readFileSync(source), raw);
    const summaryPath = path.join(root, "backup-manifest.json");
    execFileSync(process.execPath, ["scripts/build-growth-backup-manifest.mjs", root, summaryPath]);
    const summary = JSON.parse(fs.readFileSync(summaryPath));
    assert.equal(summary.totals.archiveRuns, (Array.isArray(value) ? value : value.archiveIndex).length);
    assert.deepEqual(fs.readFileSync(source), raw);
  });
}

for (const [label, value] of [["缺失数组", {}], ["null数组", { archiveIndex: null }], ["对象数组", { archiveIndex: {} }], ["标量", 1], ["null", null]]) {
  test(`archive-index 拒绝${label}，不发布清单且保留源文件`, t => {
    const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "archive-index.json"), raw = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(source, raw);
    const { result, output } = snapshot(root);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /growth_core_snapshot_schema:archive-index.json/);
    assert(!fs.existsSync(path.join(output, "snapshot-manifest.json")));
    assert.deepEqual(fs.readFileSync(source), raw);
    assert(!fs.existsSync(path.join(root, ".growth-store-mutation.lock")));
    const summaryPath = path.join(root, "backup-manifest.json");
    const summary = spawnSync(process.execPath, ["scripts/build-growth-backup-manifest.mjs", root, summaryPath], { encoding: "utf8" });
    assert.notEqual(summary.status, 0); assert.match(summary.stderr, /growth_backup_archive_index_invalid/);
    assert(!fs.existsSync(summaryPath));
  });
}

test("metadata coverage lists uncovered business data, external exports, temporary files and archive anomalies without following links", async t => {
  const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "paid-research"),{recursive:true}); fs.writeFileSync(path.join(root, "paid-research", "keep.json"), "{}");
  fs.mkdirSync(path.join(root, "archive", "2026-10-08-16"), { recursive: true });
  fs.writeFileSync(path.join(root, "archive", "2026-10-08-16", "bilibili-zero.json.gz"), "");
  fs.writeFileSync(path.join(root, "writer.json.100.tmp"), "");
  fs.symlinkSync("/a/nonexistent/external/target", path.join(root, "exports"));
  const report = await inventoryGrowthCoverage(root);
  assert.equal(report.fullStoreComplete, false);
  assert.deepEqual(report.missingRequired, []);
  assert.equal(report.uncovered.length, 2);
  assert.equal(report.anomalies.length, 1);
  assert.equal(report.separate.length, 1);
  assert.equal(report.entries.find(x => x.path === "writer.json.100.tmp").category, "temporary-writer-file");
  assert.equal(report.entries.find(x => x.path === "exports").target, "/a/nonexistent/external/target");
});

test("real snapshot preserves four authorized platforms, validates empty items, copies core under one lease and records hashes", t => {
  const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const platform of ["kuaishou", "toutiao"]) for (const directory of ["platforms", "history-ledger"]) {
    fs.writeFileSync(path.join(root,directory,`${platform}.json`), '{"items":[]}');
  }
  fs.mkdirSync(path.join(root, "platforms/nested"));
  fs.writeFileSync(path.join(root, "platforms/nested/example.json"), '{"items":[]}');
  fs.writeFileSync(path.join(root, "history-ledger/bilibili.json"), '{"items":[{"id":"one"}]}');
  const { result, output } = snapshot(root);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "snapshot-manifest.json")));
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(manifest.excludedPlatforms, ["kuaishou", "toutiao"]);
  for (const platform of ["kuaishou", "toutiao"]) {
    assert(fs.existsSync(path.join(root,"platform-current",`${platform}.current.json.gz`)));
    assert(!fs.existsSync(path.join(output,`platform-current-${platform}.current.json.gz`)));
  }
  assert.equal(manifest.files.find(x => x.platform === "bilibili").itemCount, 0);
  assert.equal(manifest.coreFiles.length, 4);
  assert.deepEqual(manifest.directoryRoots, ["platforms", "history-ledger", "paid-research/guaikei"]);
  assert.equal(manifest.directoryFiles.length, 6);
  assert.deepEqual(manifest.dataPlatforms,["douyin","xiaohongshu","bilibili","weixin_channels","tiktok"]);
  assert.equal(manifest.paidResearch.tiktokItems,1);
  assert.equal(manifest.paidResearch.automaticResumeAllowed,false);
  const report = JSON.parse(fs.readFileSync(path.join(output,"coverage.json")));
  assert.equal(report.excluded.length,6);
  for (const platform of ["kuaishou", "toutiao"]) for (const directory of ["platforms", "history-ledger"]) {
    assert(fs.existsSync(path.join(root,directory,`${platform}.json`)));
    assert(!fs.existsSync(path.join(output,"directories",directory,`${platform}.json`)));
  }
  for (const row of manifest.directoryFiles) {
    const raw = fs.readFileSync(path.join(output, row.snapshotFile));
    assert.equal(raw.length, row.bytes); assert.equal(hash(raw), row.sha256);
    assert.equal(fs.statSync(path.join(output, row.snapshotFile)).ino, fs.statSync(path.join(root, row.relativePath)).ino);
  }
  fs.writeFileSync(path.join(root, "history-ledger/bilibili.json.next"), '{"changed":true}');
  fs.renameSync(path.join(root, "history-ledger/bilibili.json.next"), path.join(root, "history-ledger/bilibili.json"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, "directories/history-ledger/bilibili.json"))), { items: [{id:"one"}] });
  for (const row of manifest.coreFiles) {
    const raw = fs.readFileSync(path.join(output, row.snapshotFile));
    assert.equal(raw.length, row.bytes); assert.equal(hash(raw), row.sha256);
  }
  fs.writeFileSync(path.join(root, "current.json"), '{"changed":true}');
  assert.equal(fs.readFileSync(path.join(output, "core/current.json"), "utf8"), "{}");
  assert.equal(manifest.fullStoreComplete, false);
  assert.equal(fs.existsSync(path.join(root, ".growth-store-mutation.lock")), false);
});

for (const [label, body] of [["zero", Buffer.alloc(0)], ["gzip", Buffer.from("not gzip")], ["json", gzipSync("{")], ["schema", gzipSync('{"collection":{"items":null}}')]]) {
  test(`real snapshot rejects ${label} current data without publishing a manifest`, t => {
    const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "platform-current/bilibili.current.json.gz"); fs.writeFileSync(source, body);
    const { result, output } = snapshot(root);
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stderr, /EPERM|ERR_MODULE_NOT_FOUND|Cannot find module/); assert.equal(fs.existsSync(path.join(output, "snapshot-manifest.json")), false);
    assert.deepEqual(fs.readFileSync(source), body);
  });
}

test("missing required core is explicit and blocks snapshot; missing optional counts remain null", async t => {
  const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = path.join(root, "manifest.json");
  execFileSync(process.execPath, ["scripts/build-growth-backup-manifest.mjs", root, manifest]);
  const value = JSON.parse(fs.readFileSync(manifest));
  assert.equal(value.platforms.bilibili.currentTotal, null);
  assert.equal(value.totals.currentItems, null);
  assert.equal(value.fullStoreComplete, false);
  fs.unlinkSync(path.join(root, "runtime-meta.json"));
  const coverage = await inventoryGrowthCoverage(root);
  assert(coverage.missingRequired.includes("runtime-meta.json"));
  assert.notEqual(snapshot(root).result.status, 0);
  assert.notEqual(spawnSync(process.execPath, ["scripts/build-growth-backup-manifest.mjs", root, manifest]).status, 0);
});

test("corrupt optional JSON must not masquerade as missing or zero", t => {
  const root = fixture(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "weixin-channels-miner.json"), "{");
  assert.notEqual(snapshot(root).result.status, 0);
  const result = spawnSync(process.execPath, ["scripts/build-growth-backup-manifest.mjs", root, path.join(root, "manifest.json")]);
  assert.notEqual(result.status, 0);
});

for (const kind of ["missing-directory", "symlink-directory", "symlink-file"]) {
  test(`directory snapshot rejects ${kind} instead of publishing incomplete data`, t => {
    const root = fixture(); t.after(() => fs.rmSync(root, {recursive:true, force:true}));
    if (kind === "missing-directory") fs.rmdirSync(path.join(root,"history-ledger"));
    if (kind === "symlink-directory") { fs.rmdirSync(path.join(root,"history-ledger")); fs.symlinkSync(path.join(root,"platforms"),path.join(root,"history-ledger")); }
    if (kind === "symlink-file") fs.symlinkSync(path.join(root,"current.json"),path.join(root,"platforms/alias.json"));
    const {result,output} = snapshot(root);
    assert.notEqual(result.status,0); assert.doesNotMatch(result.stderr,/EPERM|ERR_MODULE_NOT_FOUND/);
    assert.equal(fs.existsSync(path.join(output,"snapshot-manifest.json")),false);
  });
}
test("required directory roots may be genuinely empty", t => {
  const root=fixture(); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const {result,output}=snapshot(root); assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(output,"snapshot-manifest.json")));
  assert.deepEqual(manifest.directoryRoots,["platforms","history-ledger","paid-research/guaikei"]); assert.equal(manifest.directoryFiles.filter(f=>!f.relativePath.startsWith("paid-research/")).length,0);
});

test("TikTok receipts and shared ledgers are backed up; excluded paid platform receipts and AppleDouble stay only in source", t => {
  const root=fixture(); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const paid=path.join(root,"paid-research/guaikei"), index=JSON.parse(fs.readFileSync(path.join(paid,"index.json")));
  const excludedId="22222222-2222-4222-8222-222222222222";
  index.jobs.push({id:excludedId,input:{platform:"kuaishou"},status:"completed",items:[{id:"keep-only"}]});
  fs.writeFileSync(path.join(paid,"index.json"),JSON.stringify(index));
  fs.writeFileSync(path.join(paid,`${excludedId}.raw.json`),"{}");
  fs.writeFileSync(path.join(root,"platforms/._douyin.json"),"not JSON; AppleDouble metadata");
  const {result,output}=snapshot(root); assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(output,"snapshot-manifest.json")));
  assert.equal(manifest.paidResearch.tiktokJobIds.length,1);
  assert.equal(manifest.paidResearch.receiptFiles.length,2);
  assert.equal(manifest.paidResearch.sharedLedgersMayContainExcludedPlatformMetadata,true);
  assert(!manifest.directoryFiles.some(f=>f.relativePath.includes(excludedId)||f.relativePath.includes("._")));
  const report=JSON.parse(fs.readFileSync(path.join(output,"coverage.json")));
  assert(report.excluded.some(f=>f.path.includes(excludedId)));
  assert.equal(report.excludedFilesystemMetadata.length,1);
  assert(fs.existsSync(path.join(paid,`${excludedId}.raw.json`))); assert(fs.existsSync(path.join(root,"platforms/._douyin.json")));
});
test("missing TikTok source or completed receipt never becomes an empty successful backup", t => {
  const root=fixture(); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.unlinkSync(path.join(root,"paid-research/guaikei/11111111-1111-4111-8111-111111111111.raw.json"));
  const {result,output}=snapshot(root); assert.notEqual(result.status,0); assert.match(result.stderr,/completed_receipt_missing/);
  assert(!fs.existsSync(path.join(output,"snapshot-manifest.json")));
});
test("missing actual paid-research source is an explicit TikTok coverage gap", async t => {
  const root=fixture(); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.rmSync(path.join(root,"paid-research/guaikei"),{recursive:true});
  const coverage=await inventoryGrowthCoverage(root);
  assert(coverage.missingRequired.includes("paid-research/guaikei/index.json"));
  assert(coverage.missingRequired.includes("paid-research/guaikei/automation.json"));
  assert(coverage.missingRequired.includes("paid-research/guaikei"));
  assert.equal(coverage.status,"required-data-unavailable");
  const {result,output}=snapshot(root); assert.notEqual(result.status,0);
  assert(!fs.existsSync(path.join(output,"snapshot-manifest.json")));
});

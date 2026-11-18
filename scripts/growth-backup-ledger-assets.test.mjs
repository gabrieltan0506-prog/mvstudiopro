import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";

const repository = process.cwd();
const script = path.join(repository, "scripts/growth-backup-ledger-assets.mjs");

function entry(key, bucket, labels, firstSeenAt, lastSeenAt) {
  return { key, bucket, industryLabels: labels, ageLabels: [], contentLabels: [], firstSeenAt, lastSeenAt };
}

const gzLedger = {
  updatedAt: "2026-11-18T10:00:00+08:00", platform: "douyin",
  items: {
    "douyin:only-gz": entry("douyin:only-gz", "feed", ["美食"], "2026-01-01", "2026-01-02"),
    "douyin:shared": entry("douyin:shared", "feed", ["美食"], "2026-02-01", "2026-03-01"),
  },
};
const plainLedger = {
  updatedAt: "2026-11-17T10:00:00+08:00", platform: "douyin",
  items: {
    "douyin:only-plain": entry("douyin:only-plain", "drama", ["短剧"], "2026-04-01", "2026-04-02"),
    "douyin:shared": entry("douyin:shared", "drama", ["短剧", "美食"], "2026-01-15", "2026-02-15"),
  },
};
// 服务端规则：plain 作 remote，同键 bucket 取 remote、标签并集、firstSeen 取早、lastSeen 取晚。
const expectedUnion = {
  "douyin:only-gz": gzLedger.items["douyin:only-gz"],
  "douyin:shared": entry("douyin:shared", "drama", ["美食", "短剧"], "2026-01-15", "2026-03-01"),
  "douyin:only-plain": plainLedger.items["douyin:only-plain"],
};

async function tempDir(prefix) { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function run(ledgerDir, outputDir) {
  return spawnSync(process.execPath, [script, ledgerDir, outputDir], { encoding: "utf8" });
}

/** 走应用真实读取入口（tsx 加载 trendStore）：恢复包解到 history-ledger/ 后线上即按此读取。 */
function appReadLedger(storeDir, platform) {
  const program = `const m = await import(${JSON.stringify(path.join(repository, "server/growth/trendStore.ts"))});
process.stdout.write(JSON.stringify(await m.readLocalHistoryLedgerForStats(${JSON.stringify(platform)})));`;
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
    cwd: repository, encoding: "utf8",
    env: { ...process.env, GROWTH_STORE_DIR: storeDir, GROWTH_DISABLE_STORE_LAYOUT_MIGRATE: "1" },
  });
  return JSON.parse(out);
}

test("并存时资产为按服务端规则合并的并集，恢复后应用读到的正是并集", async () => {
  const root = await tempDir("growth-ledger-assets-");
  try {
    const ledgerDir = path.join(root, "store/history-ledger");
    const outputDir = path.join(root, "out");
    await fs.mkdir(ledgerDir, { recursive: true });
    await fs.writeFile(path.join(ledgerDir, "douyin.json.gz"), gzipSync(JSON.stringify(gzLedger)));
    await fs.writeFile(path.join(ledgerDir, "douyin.json"), JSON.stringify(plainLedger, null, 2));
    const result = run(ledgerDir, outputDir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await fs.readdir(outputDir), ["history-ledger-douyin.json.gz"]);
    const asset = await fs.readFile(path.join(outputDir, "history-ledger-douyin.json.gz"));
    // 冷存读取（readHistoryLedgerFromColdStoreOnly / readJsonWithGzipFallback）即 gunzip + JSON.parse 取 items
    const decoded = JSON.parse(gunzipSync(asset).toString("utf8"));
    assert.deepEqual(decoded.items, expectedUnion);
    assert.equal(decoded.platform, "douyin");
    // 线上并存读取与资产一致（同一份合并代码）
    assert.deepEqual(appReadLedger(path.join(root, "store"), "douyin"), expectedUnion);
    // 资产恢复进新的 store 后，应用读到并集
    const restored = path.join(root, "restored");
    await fs.mkdir(path.join(restored, "history-ledger"), { recursive: true });
    await fs.writeFile(path.join(restored, "history-ledger/douyin.json.gz"), asset);
    assert.deepEqual(appReadLedger(restored, "douyin"), expectedUnion);
    assert.doesNotMatch(result.stdout, /美食|短剧|only-gz/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("仅 .json → gzip 原文；仅 .json.gz → 原样复制", async () => {
  const root = await tempDir("growth-ledger-assets-single-");
  try {
    const ledgerDir = path.join(root, "history-ledger");
    const outputDir = path.join(root, "out");
    await fs.mkdir(ledgerDir, { recursive: true });
    const plainBytes = Buffer.from(JSON.stringify(plainLedger, null, 2));
    const gzBytes = gzipSync(JSON.stringify({ ...gzLedger, platform: "bilibili" }));
    await fs.writeFile(path.join(ledgerDir, "douyin.json"), plainBytes);
    await fs.writeFile(path.join(ledgerDir, "bilibili.json.gz"), gzBytes);
    const result = run(ledgerDir, outputDir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await fs.readdir(outputDir)).sort(), ["history-ledger-bilibili.json.gz", "history-ledger-douyin.json.gz"]);
    assert.deepEqual(gunzipSync(await fs.readFile(path.join(outputDir, "history-ledger-douyin.json.gz"))), plainBytes);
    assert.deepEqual(await fs.readFile(path.join(outputDir, "history-ledger-bilibili.json.gz")), gzBytes);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("任一输入损坏 → 非零退出，且不写出任何资产", async () => {
  for (const broken of [
    ["douyin.json.gz", Buffer.from("not-gzip")],
    ["douyin.json", Buffer.from(JSON.stringify(plainLedger).slice(0, -5))],
    ["douyin.json", Buffer.from(JSON.stringify({ updatedAt: "x", platform: "douyin" }))],
  ]) {
    const root = await tempDir("growth-ledger-assets-broken-");
    try {
      const ledgerDir = path.join(root, "history-ledger");
      const outputDir = path.join(root, "out");
      await fs.mkdir(ledgerDir, { recursive: true });
      await fs.writeFile(path.join(ledgerDir, "bilibili.json"), JSON.stringify(gzLedger));
      await fs.writeFile(path.join(ledgerDir, broken[0]), broken[1]);
      const result = run(ledgerDir, outputDir);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /growth_backup_ledger_/);
      assert.deepEqual(await fs.readdir(outputDir).catch(() => []), []);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
});

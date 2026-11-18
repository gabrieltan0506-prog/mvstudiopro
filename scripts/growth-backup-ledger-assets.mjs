#!/usr/bin/env node
// 冷备 runner：把已解出的 history-ledger 目录生成每平台一个 `history-ledger-<platform>.json.gz` 发布资产。
// 规则与线上 readLocalHistoryLedger 一致：仅 .json → gzip；仅 .json.gz → 原样复制；两者并存 → 按键合并
// （mergeHistoryLedgerEntries，与服务端同一份代码），绝不让后一份覆盖前一份。
// 任一输入读不出/损坏 → 非零退出且不写出任何资产。日志只含名称、条数、字节数。
// 用法：node scripts/growth-backup-ledger-assets.mjs <history-ledger 目录> <输出目录>
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";
import { mergeHistoryLedgerEntries, readGrowthJsonItemsStream } from "../server/growth/growthJsonStreamLedger.mjs";

async function readLedger(file, gzip) {
  const items = {};
  let result;
  try {
    result = await readGrowthJsonItemsStream(file, { gzip, onItem: (key, value) => { items[key] = value; } });
  } catch (error) {
    // 解析错误信息可能带原文片段；日志只留文件名与错误类别。
    throw new Error(`growth_backup_ledger_unreadable:${path.basename(file)}:${error?.code || error?.name || "Error"}`);
  }
  if (!result.hasItems) throw new Error(`growth_backup_ledger_items_missing:${path.basename(file)}`);
  return { fields: result.fields, items, count: Object.keys(items).length };
}

/** 逐条分块序列化，避免把整份账本拼成一个字符串。 */
function* ledgerChunks(fields, items) {
  let head = "{";
  for (const [key, value] of Object.entries(fields)) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) continue;
    head += `${JSON.stringify(key)}:${encoded},`;
  }
  yield `${head}"items":{`;
  let chunk = "";
  let separator = "";
  for (const [key, value] of Object.entries(items)) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) continue;
    chunk += `${separator}${JSON.stringify(key)}:${encoded}`;
    separator = ",";
    if (chunk.length >= 64 * 1024) { yield chunk; chunk = ""; }
  }
  if (chunk) yield chunk;
  yield "}}";
}

export async function buildLedgerAssets(ledgerDir, outputDir) {
  const names = (await fs.readdir(ledgerDir)).sort();
  const platforms = new Map();
  const skipped = [];
  for (const name of names) {
    const match = /^(.+?)\.json(\.gz)?$/.exec(name);
    if (!match || name.startsWith("._")) { skipped.push(name); continue; }
    const entry = platforms.get(match[1]) || {};
    entry[match[2] ? "gz" : "plain"] = path.join(ledgerDir, name);
    platforms.set(match[1], entry);
  }
  await fs.mkdir(outputDir, { recursive: true });
  const staged = [];
  const report = [];
  try {
    for (const [platform, sources] of platforms) {
      if (!/^[0-9a-z_]+$/.test(platform)) throw new Error(`growth_backup_ledger_platform_invalid:${platform}`);
      const target = path.join(outputDir, `history-ledger-${platform}.json.gz`);
      const temp = `${target}.${process.pid}.partial`;
      staged.push({ temp, target });
      const gz = sources.gz ? await readLedger(sources.gz, true) : null;
      const plain = sources.plain ? await readLedger(sources.plain, false) : null;
      let expected;
      let mode;
      if (gz && plain) {
        // 与 readLocalHistoryLedger 相同：gz 为 local、plain 为 remote。
        const items = mergeHistoryLedgerEntries(gz.items, plain.items);
        expected = Object.keys(items).length;
        mode = "merged";
        await pipeline(Readable.from(ledgerChunks({ ...plain.fields, ...gz.fields }, items)), createGzip({ level: 6 }), createWriteStream(temp, { flags: "wx" }));
      } else if (gz) {
        expected = gz.count;
        mode = "copied";
        await fs.copyFile(sources.gz, temp, fs.constants.COPYFILE_EXCL);
      } else {
        expected = plain.count;
        mode = "gzipped";
        await pipeline(createReadStream(sources.plain), createGzip(), createWriteStream(temp, { flags: "wx" }));
      }
      const written = await readLedger(temp, true);
      if (written.count !== expected) {
        throw new Error(`growth_backup_ledger_asset_count_mismatch:${platform}:expected=${expected}:written=${written.count}`);
      }
      report.push({
        platform, mode, asset: path.basename(target),
        gzItems: gz?.count ?? null, plainItems: plain?.count ?? null, assetItems: written.count,
        bytes: (await fs.stat(temp)).size,
      });
    }
    for (const { temp, target } of staged) await fs.rename(temp, target);
  } catch (error) {
    await Promise.all(staged.map(({ temp }) => fs.rm(temp, { force: true })));
    throw error;
  }
  return { assets: report, skipped };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [ledgerDir, outputDir] = process.argv.slice(2);
  if (!ledgerDir || !outputDir) {
    console.error("usage: growth-backup-ledger-assets.mjs <history-ledger dir> <output dir>");
    process.exit(64);
  }
  buildLedgerAssets(ledgerDir, outputDir).then((result) => {
    console.log(JSON.stringify(result));
  }, (error) => {
    console.error(`history-ledger 冷备资产生成失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

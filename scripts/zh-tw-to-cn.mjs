#!/usr/bin/env node
// Convert Traditional Chinese (TW) text to Simplified Chinese (CN) across the
// repository. This script is designed to be safe and idempotent:
//   * Uses opencc-js `twp -> cn` (Taiwan phrase variants + Mainland vocabulary).
//   * Post-processes a small fix-up dictionary to correct OpenCC's known
//     overreach on the character `著`/`着` (Mainland still keeps `著` in words
//     like 显著, 卓著, 著称, 著述, 著录, 著者).
//   * Skips files where conversion would produce no diff.
//   * Avoids `node_modules`, build artifacts, lock files, and binary blobs.
//
// Usage:
//   node scripts/zh-tw-to-cn.mjs                # convert default roots
//   node scripts/zh-tw-to-cn.mjs --dry          # preview only, no writes
//   node scripts/zh-tw-to-cn.mjs path/to/file   # convert specific files

import { Converter } from "opencc-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const SELF_PATH = path.resolve(__filename);

const DRY_RUN = process.argv.includes("--dry");
const argPaths = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"))
  .map((p) => path.resolve(p));

const DEFAULT_ROOTS = ["client/src", "server", "shared", "scripts"];

const ALLOWED_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".md", ".mdx", ".json",
  ".html", ".css", ".yml", ".yaml",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out",
  "coverage", ".turbo", ".cache", "downloads", "uploads",
]);
const SKIP_FILE_BASENAMES = new Set([
  "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "tsconfig.tsbuildinfo",
]);

// `twp -> cn` includes Taiwan-specific vocabulary mappings (滑鼠→鼠标, 螢幕→屏幕,
// 軟體→软件, etc) on top of standard `tw -> cn` character conversion. This
// produces text that reads natural to Mainland users.
const converter = Converter({ from: "twp", to: "cn" });

// OpenCC's `twp -> cn` over-aggressively maps the bare character `著` to `着`.
// Mainland Simplified Chinese keeps `著` in a small set of formal compounds.
// We post-process those compounds back to `著`. Order matters: list more
// specific phrases first so they don't get overwritten by single-char rules.
const FIXUPS = [
  // Words where Mainland Simplified preserves 著 (formal compounds):
  ["显着", "显著"],
  ["卓着", "卓著"],
  ["昭着", "昭著"],
  ["着称", "著称"],
  ["着述", "著述"],
  ["着录", "著录"],
  ["着者", "著者"],
  ["编着", "编著"],
  ["原着", "原著"],
  ["合着", "合著"],
  ["着有", "著有"],
  ["论着", "论著"],
  // OpenCC twp over-translates 核心→内核 (in Mainland 核心 is the canonical
  // term for business "core/core competence"; 内核 is reserved for OS kernel
  // semantics, which this codebase never invokes). Restore everywhere.
  ["内核", "核心"],
  // 序列 ⇄ 串行: Taiwan uses 序列 for sequence and serial both; opencc maps
  // 序列→串行 which collides with electrical/computer "serial" semantics in
  // Mainland. We never refer to serial communication, so restore.
  ["时间串行", "时间序列"],
  ["串行号", "序列号"],
  ["数据串行", "数据序列"],
  ["生成串行", "生成序列"],
  ["事件串行", "事件序列"],
  ["镜头串行", "镜头序列"],
  ["分镜串行", "分镜序列"],
  ["DNA串行", "DNA序列"],
  ["基因串行", "基因序列"],
  // 文档 vs 文件: Mainland keeps 文件 for OS files / lock files / config files.
  // OpenCC twp force-rewrites 文件→文档 (which is "document" in Mainland).
  // Targeted phrases that are clearly OS/file-system context:
  ["锁文档", "锁文件"],
  ["文档锁", "文件锁"],
  ["JSON 文档", "JSON 文件"],
  ["JSON文档", "JSON文件"],
  ["读取文档", "读取文件"],
  ["写入文档", "写入文件"],
  ["上传文档", "上传文件"],
  ["下载文档", "下载文件"],
  ["文档系统", "文件系统"],
  ["文档路径", "文件路径"],
  ["文档大小", "文件大小"],
  ["文档名", "文件名"],
  ["临时文档", "临时文件"],
  ["二进制文档", "二进制文件"],
  ["配置文档", "配置文件"],
  ["磁盘文档", "磁盘文件"],
  ["日志文档", "日志文件"],
  // 文字 vs 文本: 文字 (words/text) is universally used in Mainland. opencc
  // twp's blanket 文字→文本 is wrong in human-language contexts.
  // ORDER MATTERS: longest phrases first so they don't get eaten by shorter
  // generic rules (e.g. 文本数→字数 would otherwise consume 全文本数).
  ["每章正文本数", "每章正文字数"],
  ["全文本数", "全文字数"],
  ["正文本数", "正文字数"],
  ["文本小结", "文字小结"],
  ["其他文本", "其他文字"],
  ["任何文本", "任何文字"],
  ["小段文本", "小段文字"],
  ["这段文本", "这段文字"],
  ["此段文本", "此段文字"],
  ["文本数", "字数"],
];

function applyFixups(input) {
  let out = input;
  for (const [from, to] of FIXUPS) {
    if (from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      if (SKIP_FILE_BASENAMES.has(entry.name)) continue;
      if (path.resolve(full) === SELF_PATH) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) continue;
      yield full;
    }
  }
}

async function collectFiles() {
    if (argPaths.length > 0) {
    const out = [];
    for (const p of argPaths) {
      let stat;
      try { stat = await fs.stat(p); } catch { continue; }
      if (stat.isDirectory()) {
        for await (const f of walk(p)) out.push(f);
      } else if (stat.isFile()) {
        if (path.resolve(p) === SELF_PATH) continue;
        out.push(p);
      }
    }
    return out;
  }
  const out = [];
  for (const rel of DEFAULT_ROOTS) {
    const abs = path.join(repoRoot, rel);
    for await (const f of walk(abs)) out.push(f);
  }
  return out;
}

let changed = 0;
let scanned = 0;
let skippedBinary = 0;

const files = await collectFiles();
for (const file of files) {
  scanned += 1;
  let buf;
  try { buf = await fs.readFile(file); } catch { continue; }
  if (buf.includes(0)) { skippedBinary += 1; continue; }
  const original = buf.toString("utf8");
  const stage1 = converter(original);
  const converted = applyFixups(stage1);
  if (converted === original) continue;
  changed += 1;
  if (!DRY_RUN) {
    await fs.writeFile(file, converted, "utf8");
  }
  const rel = path.relative(repoRoot, file);
  console.log(`${DRY_RUN ? "[dry] " : ""}converted ${rel}`);
}

console.log(
  `\nDone. scanned=${scanned} changed=${changed} skipped_binary=${skippedBinary}${
    DRY_RUN ? " (dry run, no writes)" : ""
  }`,
);

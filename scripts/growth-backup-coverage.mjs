#!/usr/bin/env node
// Metadata only. Run locally or `node --input-type=module - ROOT < this-file`.
// This report neither reads external symlink targets nor certifies a remote backup.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_CORE_FILES = ["current.json", "runtime-meta.json", "archive-index.json", "history-summary.json"];
export const OPTIONAL_CORE_FILES = ["backups/growth-debug-summary.json", "weixin-channels-miner.json", "platform-current-manifest.json"];
export const EXCLUDED_PLATFORMS = ["kuaishou", "toutiao"];
export const REQUIRED_CURRENT_PLATFORMS = ["douyin", "xiaohongshu", "bilibili", "weixin_channels"];

function category(relative, type) {
  if (path.basename(relative).startsWith("._")) return "excluded-filesystem-metadata";
  if (/^(?:platform-current\/(?:kuaishou|toutiao)\.current\.json(?:\.gz)?|(?:platforms|history-ledger)\/(?:kuaishou|toutiao)\.json(?:\.gz)?)$/.test(relative)) return "user-excluded-platform";
  if (REQUIRED_CORE_FILES.includes(relative)) return "required-core";
  if (OPTIONAL_CORE_FILES.includes(relative)) return "optional-core";
  if (/^platform-current\/(?:douyin|xiaohongshu|bilibili|weixin_channels)\.current\.json\.gz$/.test(relative)) return "platform-current";
  if (relative.startsWith("archive/")) return "separate-archive-chain";
  if (/^(platforms|history-ledger)\//.test(relative)) return "required-directory-snapshot";
  if (type === "symlink") return "external-target-uncovered";
  if (/^(?:\.growth-[^/]*\.lock|runtime-interactive-workloads\/)/.test(relative)) return "transient-lock";
  if (/^backups\/(?:current-batches|archive-offload)\//.test(relative)) return "temporary-backup-snapshot";
  if (/\.(?:tmp|next)(?:-|$)/.test(path.basename(relative))) return "temporary-writer-file";
  return "business-data-uncovered";
}

export async function inventoryGrowthCoverage(rootArg) {
  const root = path.resolve(rootArg), entries = [], errors = [], directories = [];
  const paidJobs = new Map();
  try {
    const index = JSON.parse(await fs.readFile(path.join(root,"paid-research/guaikei/index.json"),"utf8"));
    if (index.version !== 1 || !Array.isArray(index.jobs)) throw new Error("invalid_ledger");
    for (const job of index.jobs) if (typeof job.id === "string" && typeof job.input?.platform === "string") paidJobs.set(job.id,job.input.platform);
  } catch (error) { errors.push({path:"paid-research/guaikei/index.json",error:error.code || error.message}); }
  const startedAt = new Date().toISOString();
  async function walk(relative = "") {
    const absolute = path.join(root, relative);
    let names;
    try { names = await fs.readdir(absolute); }
    catch (error) { errors.push({ path: relative || ".", error: error.code || error.message }); return; }
    for (const name of names.sort()) {
      const child = relative ? `${relative}/${name}` : name;
      let st;
      try { st = await fs.lstat(path.join(root, child)); }
      catch (error) { errors.push({ path: child, error: error.code || error.message }); continue; }
      if (st.isDirectory()) {
        directories.push(child);
        // Temporary hardlinks are not additional source data and can be very large.
        if (/^backups\/(?:current-batches|archive-offload)$/.test(child)) {
          entries.push({ path: child, type: "directory", category: "temporary-backup-snapshot", bytes: null });
        } else await walk(child);
        continue;
      }
      const type = st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "special";
      const row = { path: child, type, category: category(child, type), bytes: st.size, mtimeMs: st.mtimeMs };
      if (child === "paid-research/guaikei/index.json" || child === "paid-research/guaikei/automation.json") row.category = "required-shared-paid-ledger";
      else if (child.startsWith("paid-research/guaikei/")) {
        const platform = paidJobs.get(path.basename(child).slice(0,36));
        if (["douyin","xiaohongshu","wechat","tiktok"].includes(platform) && child.endsWith(".json")) row.category = "required-paid-platform-receipt";
        else if (["kuaishou","toutiao"].includes(platform)) row.category = "user-excluded-platform";
      }
      if (type === "symlink") row.target = await fs.readlink(path.join(root, child));
      if (type === "special") row.anomaly = "unsupported-type";
      else if (type === "file" && st.size === 0 && /\.json(?:\.gz)?$/.test(child)) row.anomaly = "zero-bytes";
      entries.push(row);
    }
  }
  await walk();
  const byPath = new Map(entries.map(row => [row.path, row]));
  const required = ["paid-research/guaikei/index.json", "paid-research/guaikei/automation.json", ...REQUIRED_CORE_FILES, ...REQUIRED_CURRENT_PLATFORMS.map(p => `platform-current/${p}.current.json.gz`)];
  const requiredDirectories = ["platforms", "history-ledger", "paid-research/guaikei"];
  const missingRequired = [...required.filter(name => byPath.get(name)?.type !== "file" || !(byPath.get(name).bytes > 0)), ...requiredDirectories.filter(name => !directories.includes(name))];
  const uncovered = entries.filter(row => ["business-data-uncovered", "external-target-uncovered"].includes(row.category));
  const separate = entries.filter(row => ["separate-archive-chain", "required-directory-snapshot"].includes(row.category));
  return {
    schemaVersion: 1, scope: "growth-source-metadata-inventory", startedAt, finishedAt: new Date().toISOString(),
    contentVerified: false, remoteBackupVerified: false,
    // Metadata cannot certify a full backup; separate archive/directory receipts are required.
    fullStoreComplete: false,
    status: missingRequired.length || errors.length ? "required-data-unavailable" : "partial-coverage",
    requiredFiles: required, requiredDirectories, missingRequired, uncovered, separate,
    dataPlatforms: ["douyin","xiaohongshu","bilibili","weixin_channels","tiktok"], sharedLedgersMayContainExcludedPlatformMetadata: true,
    excludedFilesystemMetadata: entries.filter(row => row.category === "excluded-filesystem-metadata"),
    excluded: entries.filter(row => row.category === "user-excluded-platform"), excludedPlatforms: EXCLUDED_PLATFORMS,
    anomalies: entries.filter(row => row.anomaly), errors, directories, entries,
  };
}

if (process.argv[1] === "-" || (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)) {
  const root = process.argv[2] || process.env.GROWTH_STORE_DIR;
  if (!root) throw new Error("Usage: node growth-backup-coverage.mjs ROOT");
  console.log(JSON.stringify(await inventoryGrowthCoverage(root)));
}

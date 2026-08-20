/**
 * 所有权登记簿存量引导 CLI(五审 P0-4)。部署新鉴权前必须跑一遍,否则老图 403。
 *
 * 用法(Fly 生产机上执行,需 DATABASE_URL 与 GCS 凭据):
 *   npx tsx scripts/backfill-canvas-media-owners.mts --dry-run
 *   npx tsx scripts/backfill-canvas-media-owners.mts \
 *     --checkpoint /data/backfill-owners.ckpt.json --report /data/backfill-owners.report.json
 *
 * 断点续跑:每页处理完就写 checkpoint 文件;中断后重跑同命令自动续。
 * 幂等:登记走 createIfAbsent,重复跑不覆盖任何已有记录。
 */
import fs from "node:fs/promises";
import {
  backfillCanvasMediaOwnersPage,
  type BackfillCheckpoint,
  type BackfillConflict,
} from "../server/services/canvasMediaOwnershipBackfill.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
}
const dryRun = process.argv.includes("--dry-run");
const checkpointPath = arg("--checkpoint");
const reportPath = arg("--report");
const pageSize = Number(arg("--page-size")) || 200;

async function loadCheckpoint(): Promise<BackfillCheckpoint | null> {
  if (!checkpointPath) return null;
  try {
    const raw = JSON.parse(await fs.readFile(checkpointPath, "utf8")) as BackfillCheckpoint;
    return Number.isFinite(raw?.afterCreatedAtMs) ? raw : null;
  } catch {
    return null;
  }
}

const totals = {
  scannedJobs: 0,
  created: 0,
  alreadyOwned: 0,
  conflict: 0,
  invalid: 0,
  errors: 0,
  pages: 0,
};
const conflicts: BackfillConflict[] = [];
const errorSamples: string[] = [];

let checkpoint = await loadCheckpoint();
if (checkpoint) console.log(`[backfill] 续跑自 checkpoint: ${JSON.stringify(checkpoint)}`);
if (dryRun) console.log("[backfill] DRY-RUN:只统计,不写任何登记");

for (;;) {
  const page = await backfillCanvasMediaOwnersPage({ checkpoint, pageSize, dryRun });
  totals.pages += 1;
  totals.scannedJobs += page.scannedJobs;
  totals.created += page.created;
  totals.alreadyOwned += page.alreadyOwned;
  totals.conflict += page.conflict;
  totals.invalid += page.invalid;
  totals.errors += page.errors;
  conflicts.push(...page.conflicts);
  errorSamples.push(...page.errorSamples);
  console.log(
    `[backfill] 页${totals.pages}: 扫${page.scannedJobs} 登${page.created} 已在册${page.alreadyOwned} 冲突${page.conflict} 无效${page.invalid} 错${page.errors}`,
  );
  checkpoint = page.nextCheckpoint;
  if (checkpointPath && checkpoint && !dryRun) {
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint));
  }
  if (page.done) break;
}

const report = { finishedAt: new Date().toISOString(), dryRun, totals, conflicts, errorSamples };
console.log(`[backfill] 完成: ${JSON.stringify(totals)}`);
if (conflicts.length) {
  console.warn(`[backfill] ⚠️ 冲突 ${conflicts.length} 条(他人已在册,未覆盖),见报告`);
}
if (reportPath) {
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`[backfill] 报告已写 ${reportPath}`);
}
if (totals.errors > 0) process.exitCode = 2;

import "dotenv/config";
import { runGrowthTrendBackfillStep } from "../server/growth/trendBackfill";

async function main() {
  await runGrowthTrendBackfillStep();
}

main().catch((error) => {
  console.error("[backfill] failed", error);
  updateTrendBackfillProgress({
    active: false,
    finishedAt: new Date().toISOString(),
    status: "failed",
    note: error instanceof Error ? error.message : String(error),
  }).catch(() => {});
  process.exitCode = 1;
});

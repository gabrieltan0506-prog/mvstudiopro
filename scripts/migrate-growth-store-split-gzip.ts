import {
  detectGrowthStoreMigrationNeeds,
  migrateGrowthStoreSplitGzipLayout,
} from "../server/growth/trendStore";

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const migrateArchives = args.has("--archives") || args.has("--archives-batch");
  const archiveBatch = args.has("--archives-batch");

  const before = await detectGrowthStoreMigrationNeeds();
  console.log(JSON.stringify({ phase: "detect", ...before }, null, 2));

  const report = await migrateGrowthStoreSplitGzipLayout({
    dryRun,
    migrateArchives: migrateArchives ? (archiveBatch ? "batch" : true) : false,
    archiveBatchLimit: Number(process.env.GROWTH_ARCHIVE_MIGRATE_BATCH || 500) || 500,
  });
  console.log(JSON.stringify({ phase: "migrate", ...report }, null, 2));

  const after = await detectGrowthStoreMigrationNeeds();
  console.log(JSON.stringify({ phase: "detect-after", ...after }, null, 2));

  if (!dryRun && after.needed) {
    console.error("Migration finished but store still reports pending work. Re-run with --archives-batch until plain_archives clears.");
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

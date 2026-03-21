import { refreshTrendDebugSummary } from "../server/growth/trendStore";

async function main() {
  const summary = await refreshTrendDebugSummary();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

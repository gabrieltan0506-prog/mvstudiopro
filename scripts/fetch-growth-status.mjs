#!/usr/bin/env node

import fs from "node:fs/promises";

const [baseUrl, outputPath] = process.argv.slice(2);

if (!baseUrl || !outputPath) {
  console.error("Usage: node scripts/fetch-growth-status.mjs <base-url> <output-path>");
  process.exit(1);
}

const endpoint = `${baseUrl.replace(/\/$/, "")}/api/trpc/mvAnalysis.getGrowthSystemStatus?batch=1&input=%7B%7D`;

async function main() {
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch growth status: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  const json = body?.[0]?.result?.data?.json;
  const sourcePlatforms =
    (Array.isArray(json?.truthStore?.platforms) && json.truthStore.platforms)
    || (Array.isArray(json?.backfillLive?.platforms) && json.backfillLive.platforms)
    || (Array.isArray(json?.backfillHistory?.platforms) && json.backfillHistory.platforms)
    || (Array.isArray(json?.backfill?.platforms) && json.backfill.platforms);
  if (!sourcePlatforms) {
    throw new Error("Growth status response missing truthStore/backfill platforms");
  }
  const platforms = Object.fromEntries(
    sourcePlatforms.map((item) => [
      String(item.platform),
      {
        currentTotal: Number(item.currentTotal || item.currentItems || 0),
        archivedTotal: Number(item.archivedTotal || item.archivedItems || 0),
      },
    ]),
  );
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        endpoint,
        platforms,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(platforms, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

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
  if (!json?.backfill?.platforms) {
    throw new Error("Growth status response missing backfill.platforms");
  }
  const platforms = Object.fromEntries(
    json.backfill.platforms.map((item) => [
      String(item.platform),
      {
        currentTotal: Number(item.currentTotal || 0),
        archivedTotal: Number(item.archivedTotal || 0),
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

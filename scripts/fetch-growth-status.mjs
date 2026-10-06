#!/usr/bin/env node

import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function fetchGrowthStatus(baseUrl, outputPath, { fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/trpc/mvAnalysis.getGrowthSystemStatus?batch=1&input=%7B%7D`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let body;
  try {
    const response = await fetchImpl(endpoint, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`Failed to fetch growth status: ${response.status} ${response.statusText}`);
    body = await response.json();
  } finally { clearTimeout(timeout); }
  const json = body?.[0]?.result?.data?.json;
  if (json?.truthStore?.ready === false) throw new Error("Growth status summary is not ready");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baseUrl, outputPath] = process.argv.slice(2);
  if (!baseUrl || !outputPath) {
    console.error("Usage: node scripts/fetch-growth-status.mjs <base-url> <output-path>");
    process.exitCode = 1;
  } else fetchGrowthStatus(baseUrl, outputPath).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

#!/usr/bin/env tsx
import fs from "node:fs/promises";
import {
  createWeixinChannelsProbeJob,
  ensureWeixinChannelsProbeCandidate,
  ingestWeixinChannelsObservations,
  processWeixinChannelsAggregationJob,
} from "../server/growth/weixinChannelsMinerStore";
import type { WeixinChannelsObservation } from "../server/growth/weixinChannelsMiner";

async function main() {
  const args = process.argv.slice(2);
  const inputArg = args.find((item) => item.startsWith("--input="));
  if (!inputArg || !args.includes("--execute-paid-probe")) {
    throw new Error("usage: --input=/path/observations.json --execute-paid-probe");
  }
  const observations = JSON.parse(await fs.readFile(inputArg.slice("--input=".length), "utf8")) as WeixinChannelsObservation[];
  if (observations.length !== 5 || observations.some((item) => item.runKind !== "probe" || item.evidence !== "capture")) {
    throw new Error("paid_probe_requires_exactly_5_captured_probe_records");
  }
  const taskId = observations[0]?.taskId;
  if (!taskId || observations.some((item) => item.taskId !== taskId)) throw new Error("paid_probe_task_mismatch");
  await ensureWeixinChannelsProbeCandidate({ taskId, queries: observations.map((item) => item.query) });
  for (const observation of observations) {
    const result = await ingestWeixinChannelsObservations({ taskId, observations: [observation] });
    if (!result.persisted || !result.qualified || result.modelCalls !== 0) {
      throw new Error(`probe_ingest_rejected:${observation.observationId}:${result.qualificationReason}`);
    }
  }
  const { job } = await createWeixinChannelsProbeJob();
  const completed = job.status === "completed" ? job : await processWeixinChannelsAggregationJob(job.jobId);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    jobId: completed.jobId,
    status: completed.status,
    rawCount: completed.rawCount,
    locallyDedupedCount: completed.locallyDedupedCount,
    terraProvider: completed.terraProvider,
    usage: completed.usage,
    finalResult: completed.finalResult,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

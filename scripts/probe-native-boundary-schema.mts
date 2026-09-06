import {
  buildBoundaryEvidenceBundle,
  deduplicateBoundaryEvidence,
  buildBoundaryCleanStructuringInput,
  prepareBoundaryStructuringBatch,
  auditBoundaryEvidenceOutput,
} from "../server/services/manhuaNativeBoundaryExperiment.ts";
import {
  buildNativeDeepReadGlmStructuringPrompt,
  invokeNativeDeepReadGlmStructuring,
  NATIVE_DEEP_READ_GLM_STRUCTURING_CONFIG,
  assertNativeDeepReadShotObservationsPreserved,
  measureNativeDeepReadSegmentCoverage,
} from "../server/services/manhuaNativeDeepReadRunner.ts";
import { assertNativeStructuringAnalysis } from "../shared/manhuaNativeStructuringAnalysis.ts";
import { assertNativeRequiredSummary } from "../shared/manhuaNativeRequiredSummary.ts";
const clean = (e: any) =>
    String(e?.message || e)
      .split("https:")[0]
      .slice(0, 1800),
  probeId = "pull-split-0906-007";
async function main() {
  if (process.env.FLY_APP_NAME !== "mvstudiopro") throw Error("仅允许Fly执行");
  const ioModule: string = "/app/.codex-probes/gcs-probe-io-0906.mjs";
  const io = await import(ioModule);
  const prefix = "manhua-template-learn/probe-audit/pull-split-0906-007/";
  const outputPrefix =
    "manhua-template-learn/probe-audit/pull-split-0906-007-schema-v1/";
  const save = (name: string, value: unknown) =>
    io.writeJson(outputPrefix + name, value);
  const manifest = await io.readJson(prefix + "source-manifest.json");
  const summary = await io.readJson(prefix + "read-summary-resumed.json");
  const attempts = summary.results.flatMap((r: any) =>
    r.status === "fulfilled" ? r.value.attempts : []
  );
  if (new Set(attempts.map((a: any) => a.segmentIndex)).size !== 4)
    throw Error("四段读片证据未齐，停止本次全片整形");
  const functionStarted = performance.now();
  const bundle = buildBoundaryEvidenceBundle(attempts);
  const batch = prepareBoundaryStructuringBatch(bundle);
  const functionComputeMs = performance.now() - functionStarted;
  await save("function-evidence-bundle.json", bundle);
  await save("function-batch-input.json", batch);
  await save("function-timing.json", {
    functionComputeMs,
    unchangedSegments: batch.unchangedSegments,
    processedSegments: batch.processed.map(p => p.segmentIndex),
    glmCalls: 1,
  });
  const prompt = buildNativeDeepReadGlmStructuringPrompt({
    episodeIndex: 1,
    durationSec: manifest.durationSec,
    segments: manifest.segments,
    hasAudio: true,
    rawSegments: batch.rawSegments,
  });
  await save("glm-request.json", {
    probeId,
    prompt,
    config: NATIVE_DEEP_READ_GLM_STRUCTURING_CONFIG,
    gatewayOrder: ["openrouter"],
    sourceDigest: bundle.sourceDigest,
  });
  if (!process.argv.includes("--execute")) return;
  await io.writeJson(
    outputPrefix + "glm-started.json",
    {
      startedAt: new Date().toISOString(),
      sourceDigest: bundle.sourceDigest,
    },
    { exclusive: true }
  );
  const start = Date.now();
  console.log("GLM_STARTED", new Date().toISOString());
  const result = await invokeNativeDeepReadGlmStructuring(
    { ...prompt, boundaryEvidence: bundle },
    undefined,
    {
      seriesKey: probeId,
      sourceDigest: manifest.sourceDigest,
      episodeIndex: 1,
      batchRequestId: probeId,
      callId: probeId + "-glm-function-schema-v1",
      preferredGlmGateway: "openrouter",
      gatewayOrder: ["openrouter"],
      onStreamProgress: info => console.log("GLM_STREAM", JSON.stringify(info)),
    }
  );
  await save("glm-result.json", result);
  const expandedRaw = result.raw;
  await save("glm-expanded-result.json", { ...result, raw: expandedRaw });
  const provenance = auditBoundaryEvidenceOutput(bundle, expandedRaw);
  await save("glm-provenance-audit.json", provenance);
  const gates: any[] = [];
  for (const [name, fn] of [
    [
      "observations",
      () =>
        assertNativeDeepReadShotObservationsPreserved(
          batch.rawSegments,
          expandedRaw
        ),
    ],
    [
      "analysis",
      () =>
        assertNativeStructuringAnalysis(expandedRaw, {
          requireGeneratedAnalysis: true,
        }),
    ],
    ["summary", () => assertNativeRequiredSummary(expandedRaw)],
  ] as const) {
    try {
      fn();
      gates.push({ name, status: "passed" });
    } catch (e) {
      gates.push({ name, status: "failed", error: clean(e) });
    }
  }
  const audit = {
    probeId,
    status: "等待真实画面质量核对",
    elapsedMs: Date.now() - start,
    readCalls: attempts.length,
    readCostEquivalentCny: attempts.reduce(
      (n: number, a: any) => n + a.audit.priceEquivalentCny,
      0
    ),
    functionStats: batch.processed.map(p => ({
      segmentIndex: p.segmentIndex,
      ...p.facts.stats,
    })),
    functionComputeMs,
    inputShots: batch.rawSegments.reduce(
      (n, r) => n + (Array.isArray(r.shots) ? r.shots.length : 0),
      0
    ),
    outputShots: Array.isArray(expandedRaw.shots)
      ? expandedRaw.shots.length
      : 0,
    provenance,
    gates,
    coverage: measureNativeDeepReadSegmentCoverage({
      shots: Array.isArray(expandedRaw.shots) ? expandedRaw.shots : [],
      startSec: 0,
      endSec: manifest.durationSec,
    }),
    gateway: result.gateway,
    model: result.model,
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    costUsd: result.costUsd,
    evidence: result.evidence,
    finishedAt: new Date().toISOString(),
  };
  await save("final-program-audit.json", audit);
  console.log("STRUCTURING_FINISHED", JSON.stringify(audit));
}
main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error("STRUCTURING_FAILED", clean(e));
    process.exit(1);
  });

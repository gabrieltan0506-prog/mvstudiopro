/**
 * 0906 探针：007 四片（GCS 已留 mp4）真读片（Flash，生产重试链）→ 重试片过 mergeNativeDeepReadRetryDrafts → GLM 一次整形（OpenRouter Z.AI → EvoLink，json_object）→ 导出 HTML。
 * 只在 Fly 容器内跑。缺省只打印计划（¥0）；--execute 才真烧钱。
 *   node_modules/.bin/tsx scripts/probe-retry-merge-0906.mts [--execute] [--series=probe-retrymerge-0906-007]
 */
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcsIfAbsent } from "../server/services/gcs.js";
import {
  createNativeDeepReadRunnerDeps,
  runManhuaNativeDeepReadBatch,
  type PreparedNativeVideo,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import { mergeNativeDeepReadRetryDrafts } from "../server/services/manhuaNativeDeepReadRetryDraftMerge.js";
import { renderNativeEvidenceReportFromObjectNames } from "../server/services/manhuaNativeReportRender.js";

if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("只允许在 Fly 容器内运行");
const arg = (k: string) => String(process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) || "").trim();
const EXECUTE = process.argv.includes("--execute");
const SERIES = arg("series") || "probe-retrymerge-0906-007";
const bucket = getGcsBucketName();
const SRC = "manhua-template-learn/probe-audit/pull-split-0906-007/";
const OUT = `manhua-template-learn/probes/${SERIES}/`;
const dl = async (name: string) => JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` })).buffer.toString("utf8"));
const put = async (name: string, value: unknown) => uploadBufferToGcsIfAbsent({ objectName: `${OUT}${name}`, buffer: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
const t0 = Date.now();
const clock = () => `${Math.round((Date.now() - t0) / 1000)}s`;

async function main() {
  const run = await dl(`${SRC}read-run-manifest.json`) as { sourceDigest: string };
  const manifests = await Promise.all([0, 1, 2, 3].map((i) => dl(`${SRC}seg${i}-manifest.json`) as Promise<{ segmentIndex: number; startSec: number; endSec: number; objectName: string; bytes: number; gcsUri: string; actualMedia?: { streams?: Array<{ codec_type: string }> } }>));
  const segments = manifests.map((m) => ({ startSec: m.startSec, endSec: m.endSec }));
  const durationSec = Math.max(...segments.map((s) => s.endSec));
  const prepared: PreparedNativeVideo[] = manifests.map((m) => ({
    gsUri: m.gcsUri, startSec: m.startSec, endSec: m.endSec, bytes: m.bytes,
    temporaryGcs: { bucket, objectName: m.objectName },
    hasAudio: (m.actualMedia?.streams || []).some((s) => s.codec_type === "audio"),
  }));
  console.info(`[probe] 007 四片：${segments.map((s) => `${s.startSec}-${s.endSec}`).join(" | ")} · 时长 ${durationSec}s · 系列键 ${SERIES}`);
  console.info(`[probe] 读片 Flash（生产重试链 0.7→0.65→0.6，503 兜底照旧）· 重试片走 mergeNativeDeepReadRetryDrafts · 整形 GLM-5.3 OpenRouter(Z.AI)→EvoLink json_object · 导出 HTML`);
  if (!EXECUTE) { console.info("[probe] 计划模式，未发任何付费调用。加 --execute 真跑（预估读片 4×¥0.8 + 重试 + 整形约 ¥7）。"); return; }

  const receipts: Array<Record<string, unknown>> = [];
  const merges: string[] = [];
  const origInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => { const s = args.map(String).join(" "); if (s.includes("稿合并：")) merges.push(s); origInfo(...args); };
  const deps = createNativeDeepReadRunnerDeps({
    prepareVideos: async () => prepared,
    // 007 的 mp4 是永久证据，探针结束不得删
    remove: async (target: { objectName: string }) => { origInfo(`[probe] 跳过清理 ${target.objectName}`); },
    mergeRetryDrafts: mergeNativeDeepReadRetryDrafts,
  });
  const batch = await runManhuaNativeDeepReadBatch({
    episodes: [{ episodeIndex: 1, resolveNodes: async () => [], segments, sourceDurationSec: durationSec, cacheSourceDigest: run.sourceDigest }],
    segmentCacheSeriesKey: SERIES,
    readModel: "gemini-3.8-flash",
    structuringModel: "glm-5.3",
    preservePreparedVideos: true,
    onModelReceipt: (r) => {
      receipts.push(r as unknown as Record<string, unknown>);
      const seg = typeof r.chunkIndex === "number" ? ` 片${r.chunkIndex + 1}` : "";
      const att = r.attemptNumber ? ` 第${r.attemptNumber}发` : "";
      const err = r.errorZh ? ` · ${String(r.errorZh).slice(0, 140)}` : "";
      origInfo(`[receipt ${clock()}] ${r.stage}/${r.status}${seg}${att} · ${String(r.model).slice(0, 90)} · ${r.route}${err}`);
    },
  }, deps);
  const ep = batch.episodes[0]!.result;
  const attemptsBySeg = new Map<number, number>();
  for (const r of receipts) if (r.stage === "visual_model" && r.status === "completed" && typeof r.chunkIndex === "number") attemptsBySeg.set(r.chunkIndex as number, Math.max(attemptsBySeg.get(r.chunkIndex as number) ?? 0, Number(r.attemptNumber) || 1));
  const summary = {
    series: SERIES, elapsedSec: Math.round((Date.now() - t0) / 1000),
    usage: batch.usage, model: batch.model, visualRoutes: ep.visualRoutes,
    attemptsPerSegment: Array.from(attemptsBySeg.entries()).sort((a, b) => a[0] - b[0]).map(([i, n]) => `片${i + 1}:${n}发`),
    merges,
    structuring: { gateway: ep.glmEvidence ? "见 glmEvidence" : "local_fallback?", structuredCardObjectName: ep.structuredCardObjectName, evidenceCallId: ep.glmEvidence?.callId },
    shots: Array.isArray((ep as Record<string, unknown>).shots) ? ((ep as Record<string, unknown>).shots as unknown[]).length : undefined,
    segmentEvidenceObjectNames: ep.segmentEvidenceObjectNames,
    advisories: (ep as { advisories?: unknown }).advisories,
  };
  console.info(`\n[probe] 结果 ${JSON.stringify({ ...summary, segmentEvidenceObjectNames: undefined, advisories: undefined }, null, 1)}`);
  await put("summary.json", summary);
  await put("receipts.json", receipts);
  await put("episode-result.json", ep);
  const names = ep.segmentEvidenceObjectNames || [];
  const report = await renderNativeEvidenceReportFromObjectNames({
    labelZh: `${SERIES} 第 1 集（探针：重试稿合并 + GLM 一次整形）`,
    evidenceObjectNames: names, expectEpisodeIndex: 1, expectSeriesKey: SERIES,
    expectSourceDigest: String(ep.sourceDigest || run.sourceDigest), expectSegmentCount: names.length, segmentSpans: segments.slice(0, names.length),
    glmCardObjectName: ep.structuredCardObjectName,
    reportObjectName: `${OUT}report.html`,
  } as never);
  console.info(`[probe] 导出 HTML ${(report.bytes / 1024).toFixed(0)}KB · ${report.shots} 镜 · ${report.frames} 帧 · ${report.frameSource}`);
  console.info(`[probe] REPORT_URL=${report.reportUrl}`);
}
main().catch((e) => { console.error("[probe] 失败：", e instanceof Error ? e.stack : e); process.exit(1); });

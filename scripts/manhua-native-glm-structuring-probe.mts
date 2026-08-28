/**
 * GLM 5.3 整形合并探针：把一次两段探针的 parsed 段卡送生产同款整形提示词（v9 含广告剔除
 * 硬规则），合成整集卡永久存 GCS。只读段卡原件，不改动任何生产对象。
 * 用法：--run=probe_full_20260828142350
 */
import { createHash } from "node:crypto";
import { buildNativeDeepReadGlmStructuringPrompt } from "../server/services/manhuaNativeDeepReadRunner.js";
import { invokeGlmJsonChatWithGatewayFallback } from "../server/services/bailianChat.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const RUN = String(process.argv.find((arg) => arg.startsWith("--run="))?.slice("--run=".length) || "").trim();
if (!RUN) throw new Error("缺少 --run=<probe seriesKey>");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

const bucket = getGcsBucketName();
const parsedPrefix = `manhua-template-learn/segment-evidence/tpl_native_${RUN}_ep001/`;

function describeErrorChain(error: unknown): Array<Record<string, string>> {
  const chain: Array<Record<string, string>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== "object" && typeof current !== "string") break;
    const row: Record<string, string> = {};
    const source = typeof current === "string" ? { message: current } : current as {
      name?: unknown; code?: unknown; message?: unknown; cause?: unknown;
    };
    for (const key of ["name", "code", "message"] as const) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).replace(/[\r\n\t]+/g, " ").replace(/https?:\/\/\S+/g, "<URL>").trim().slice(0, 200);
      if (text) row[key] = text;
    }
    if (Object.keys(row).length > 0) chain.push(row);
    current = (source as { cause?: unknown }).cause;
  }
  return chain;
}

function countAdShots(card: Record<string, unknown>): { total: number; ad: number } {
  const shots = Array.isArray(card.shots) ? card.shots as Array<Record<string, unknown>> : [];
  return { total: shots.length, ad: shots.filter((s) => s.evidenceRole === "non_story_ad").length };
}

async function main() {
  console.info(`[glm-probe] 阶段：读取 ${RUN} 的 parsed 段卡`);
  const names = await listGcsObjectNamesByPrefix({ prefix: parsedPrefix, literalPrefix: true, maxResults: 20 });
  if (names.length < 1) throw new Error(`未找到 parsed 段卡：${parsedPrefix}`);
  const entries = await Promise.all(names.sort().map(async (name) => {
    const { buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` });
    return JSON.parse(buffer.toString("utf8")) as {
      segmentIndex: number; startSec: number; endSec: number; raw: Record<string, unknown>;
    };
  }));
  entries.sort((a, b) => a.segmentIndex - b.segmentIndex);
  const segments = entries.map((entry) => ({ startSec: entry.startSec, endSec: entry.endSec }));
  const durationSec = Math.max(...entries.map((entry) => entry.endSec));
  const inputStats = entries.map((entry) => ({ segmentIndex: entry.segmentIndex, ...countAdShots(entry.raw) }));
  console.info(`[glm-probe] 段卡 ${entries.length} 份 · 覆盖至 ${durationSec}s · 输入镜头统计 ${JSON.stringify(inputStats)}`);

  const prompt = buildNativeDeepReadGlmStructuringPrompt({
    episodeIndex: 1,
    durationSec,
    segments,
    hasAudio: true,
    rawSegments: entries.map((entry) => entry.raw),
  });

  console.info("[glm-probe] 阶段：调用 GLM 5.3（openrouter_only · 30 分钟上限 · 单次不重发）");
  let card: Record<string, unknown> | undefined;
  const startedAt = Date.now();
  const response = await invokeGlmJsonChatWithGatewayFallback({
    system: prompt.system,
    user: prompt.user,
    maxTokens: 131_072,
    gatewayPolicy: "openrouter_only",
    timeoutMs: 30 * 60_000,
    requireParameters: true,
    requireFinishReasonStop: true,
    validateContent: (content: string) => {
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("GLM 产物不是 JSON 对象");
      card = parsed as Record<string, unknown>;
    },
  } as Parameters<typeof invokeGlmJsonChatWithGatewayFallback>[0]);
  if (!card) throw new Error("GLM 未返回可解析产物");

  const outputStats = countAdShots(card);
  const receipt: Record<string, unknown> = { ...response as unknown as Record<string, unknown> };
  delete receipt.content;
  const summary = {
    schemaVersion: 1,
    runId: RUN,
    stage: "glm_structuring",
    elapsedMs: Date.now() - startedAt,
    inputStats,
    outputStats,
    subtitles: Array.isArray(card.subtitles) ? card.subtitles.length : 0,
    audioChunks: Array.isArray(card.audioResolution) ? card.audioResolution.length : 0,
    receipt,
  };
  const cardBuffer = Buffer.from(`${JSON.stringify(card, null, 2)}\n`, "utf8");
  const cardObject = `manhua-template-learn/probes/${RUN}/glm-episode-card.json`;
  const savedCard = await uploadBufferToGcsIfAbsent({
    bucket, objectName: cardObject, contentType: "application/json", buffer: cardBuffer,
  });
  if (!savedCard.created) throw new Error("整集卡对象已存在，拒绝覆盖");
  const summaryBuffer = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: `manhua-template-learn/probes/${RUN}/glm-structuring-summary.json`,
    contentType: "application/json",
    buffer: summaryBuffer,
  });
  console.info(JSON.stringify({
    ...summary,
    cardEvidence: { objectName: cardObject, bytes: cardBuffer.byteLength, sha256: createHash("sha256").update(cardBuffer).digest("hex") },
  }, null, 2));
}

main().catch((error) => {
  console.error(`[glm-probe] 失败：${error instanceof Error ? error.message : String(error)}`);
  console.error(`[glm-probe] 根因链：${JSON.stringify(describeErrorChain(error))}`);
  process.exitCode = 1;
});

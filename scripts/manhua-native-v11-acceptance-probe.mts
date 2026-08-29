/**
 * v11 验收探针：**整集**实弹跑一遍 v10/v11 的门禁与参数改动，逐项出 PASS/FAIL/未观察。
 *
 * 与 v10 版探针的三处要害差异（v10 版有这三个坑，跑了也是假验收）：
 *  1. **读 canonical 段证据**，不读 `result.rawSegments`——`NativeDeepReadOutput` 上
 *     根本没有那个字段，v10 版因此 P2–P7 六项从未真正执行过，却照样输出 passCount。
 *  2. **片源走抖音解析器**（页面法优先，失败回退匿名 yt-dlp），不再错接 0996 站解析器。
 *  3. **整集分片**：复用生产的 `splitNativeDeepReadSegments(真实时长)`，一集 4–8 片，
 *     不再写死 600 秒两片。集级门禁、尾片豁免这些只有整集才暴露得出来。
 *
 * 参数零硬编码：temperature / thinkingBudget / 门禁阈值 / 分片长度全部 import 生产常量，
 * 探针跑的就是生产会跑的那一套；改了生产参数，探针自动跟着改。
 *
 * 三态判定（v10 版把 P3/P4/P5/P7/P8 写死 true，等于「没观察到」冒充「通过」）：
 *   pass / fail / not_observed —— 只要有任何一项不是 pass，就不许声称九项全通过。
 *
 * 只允许在 Fly 内执行：凭证从服务端环境读取，绝不落本机。
 * 视频分片仅供本轮调用，结束即删并复查残留；上游原始响应与段证据永久留 GCS。
 *
 * 用法：MANHUA_NATIVE_DEEP_READ=1 pnpm exec tsx scripts/manhua-native-v11-acceptance-probe.mts --url=<抖音链接>
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  runManhuaNativeDeepRead,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import {
  probeNativeDeepReadDurationSec,
  splitNativeDeepReadSegments,
} from "../server/services/manhuaNativeDeepReadPlan.js";
import { resolveDouyinMediaUrl } from "../server/services/manhuaDouyinMediaResolve.js";
import { fetchManhua0996EpisodePlayback } from "../server/services/manhuaLearn0996Source.js";
import { sanitizeSensitiveText } from "../server/services/manhuaMediaSanitize.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const run = promisify(execFile);
const SOURCE = String(
  process.argv.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) || "",
).trim();
if (!SOURCE) throw new Error("缺少 --url=");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

/**
 * 两条片源解析器按链接自动分流——**不是只有抖音一条**：
 *   · 抖音（漫剧，如《剑宗团宠》）→ 页面法解析，失败回退匿名 yt-dlp
 *   · 0996 第三方播放页（真人剧，如《花开锦绣》）→ 站内 API 取播放地址
 * 时长两条都走生产的 ffprobe 读头（不下片），再交生产切段函数分片。
 */
const DOUYIN_VIDEO_ID = /douyin\.com/i.test(SOURCE)
  ? (SOURCE.match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "")
  : "";
const IS_DOUYIN = Boolean(DOUYIN_VIDEO_ID);
if (/douyin\.com/i.test(SOURCE) && !IS_DOUYIN) {
  throw new Error("抖音链接里没找到视频号（需要 /video/<id> 或 modal_id=<id>）");
}
const VIDEO_ID = DOUYIN_VIDEO_ID || "0996";
const PAGE_URL = IS_DOUYIN ? `https://www.douyin.com/video/${DOUYIN_VIDEO_ID}` : SOURCE;

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesKey = `probe_v11_${runStamp}`;
const bucket = getGcsBucketName();
const rawPrefix = `manhua-template-learn/segment-evidence-raw/tpl_native_${seriesKey}_ep001/`;
const parsedPrefix = `manhua-template-learn/segment-evidence/tpl_native_${seriesKey}_ep001/`;
const videoPrefix = "manhua-template-learn/tmp/native-deep-read/";

type CheckStatus = "pass" | "fail" | "not_observed";
type CheckId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9";
type Check = { id: CheckId; nameZh: string; status: CheckStatus; actualZh: string };

const checks: Check[] = [];
const record = (id: CheckId, nameZh: string, status: CheckStatus, actualZh: string) => {
  checks.push({ id, nameZh, status, actualZh });
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "未观察";
  console.info(`[v11] ${tag} ${id} ${nameZh} —— ${actualZh}`);
};

/* ───────────────── 片源解析（与既有抖音探针同口径） ───────────────── */

function pickMedia(info: Record<string, unknown>): string {
  const formats = Array.isArray(info.formats) ? info.formats as Array<Record<string, unknown>> : [];
  const candidates = formats
    .filter((row) => String(row.url || "")
      && String(row.vcodec || "none") !== "none"
      && String(row.acodec || "none") !== "none")
    .sort((a, b) =>
      Number(a.filesize || a.filesize_approx || 9e15) - Number(b.filesize || b.filesize_approx || 9e15));
  const url = String(candidates[0]?.url || info.url || "");
  if (!/^https:\/\//.test(url)) throw new Error("未解析到带音画的抖音媒体流");
  return url;
}

/** 匿名 yt-dlp（零 Cookie/凭证 argv）：页面法失败时的兜底与时长补齐。 */
async function fetchInfoAnonymously(): Promise<Record<string, unknown>> {
  const { stdout } = await run("yt-dlp", ["-J", "--no-warnings", PAGE_URL], {
    timeout: 150_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

type SourceMedia = { mediaUrl: string; referer: string; durationSec: number; kindZh: string };

/** 抖音（漫剧）：页面法优先，失败回退匿名 yt-dlp。 */
async function resolveDouyinSource(): Promise<SourceMedia> {
  const referer = "https://www.douyin.com/";
  try {
    const resolved = await resolveDouyinMediaUrl(PAGE_URL);
    const hinted = Number(resolved.durationSec) || 0;
    return {
      mediaUrl: resolved.mediaUrl,
      referer,
      durationSec: hinted > 0
        ? Math.max(1, Math.floor(hinted))
        : await probeNativeDeepReadDurationSec(resolved.mediaUrl, undefined, undefined, referer),
      kindZh: "抖音（漫剧）",
    };
  } catch (pageError) {
    console.error(`[v11] 页面解析失败，回退匿名 yt-dlp：${sanitizeSensitiveText(pageError)}`);
    const info = await fetchInfoAnonymously();
    const mediaUrl = pickMedia(info);
    const hinted = Math.floor(Number(info.duration) || 0);
    return {
      mediaUrl,
      referer,
      durationSec: hinted > 0
        ? hinted
        : await probeNativeDeepReadDurationSec(mediaUrl, undefined, undefined, referer),
      kindZh: "抖音（漫剧 · yt-dlp 兜底）",
    };
  }
}

/** 0996 第三方播放页（真人剧）：站内 API 取播放地址；该源不回时长，走 ffprobe 读头。 */
async function resolve0996Source(): Promise<SourceMedia> {
  const playback = await fetchManhua0996EpisodePlayback(SOURCE);
  const mediaUrl = playback.playbackUrls[0] || playback.playbackUrl;
  if (!mediaUrl) throw new Error("0996 播放页未解析到媒体地址");
  return {
    mediaUrl,
    referer: playback.referer,
    durationSec: await probeNativeDeepReadDurationSec(
      mediaUrl, undefined, undefined, playback.referer,
    ),
    kindZh: "0996 播放页（真人剧）",
  };
}

async function resolveSourceMedia(): Promise<SourceMedia> {
  return IS_DOUYIN ? resolveDouyinSource() : resolve0996Source();
}

/* ───────────────── 证据读取（canonical，不读不存在的字段） ───────────────── */

function segmentIndexFromName(name: string): number {
  const match = /\/seg(\d+)(?:\/|-)/.exec(name);
  return Number(match?.[1] ?? -1);
}

async function downloadJson(objectName: string): Promise<unknown> {
  const downloaded = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
  return JSON.parse(downloaded.buffer.toString("utf8")) as unknown;
}

/** 段证据信封 → 段卡本体。信封形状由 runner 落盘时决定，这里只认 raw 字段。 */
function segmentCardOf(payload: unknown): Record<string, unknown> {
  const envelope = (payload || {}) as Record<string, unknown>;
  const raw = envelope.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return envelope;
}

/* ───────────────── 九项验收 ───────────────── */

function checkFrozenParams(): void {
  const cfg = NATIVE_DEEP_READ_GENERATION_CONFIG as Record<string, unknown>;
  const thinking = (cfg.thinkingConfig ?? {}) as Record<string, unknown>;
  const ok = cfg.temperature === 0.7
    && cfg.maxOutputTokens === 65_536
    && thinking.thinkingBudget === 18_000
    && thinking.includeThoughts === false
    && !("thinkingLevel" in thinking)
    && NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(",") === "0.7,0.65,0.6";
  record(
    "P1",
    "冻结参数与代码常量一致",
    ok ? "pass" : "fail",
    `temperature=${String(cfg.temperature)} · thinkingBudget=${String(thinking.thinkingBudget)}`
    + ` · includeThoughts=${String(thinking.includeThoughts)}`
    + ` · thinkingLevel=${"thinkingLevel" in thinking ? "存在（不合规）" : "无"}`
    + ` · 梯度=[${NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(", ")}] · plan=${NATIVE_DEEP_READ_VISUAL_PLAN_VERSION}`,
  );
}

function inspectSegments(
  cards: Array<{ segmentIndex: number; card: Record<string, unknown> }>,
  rawTexts: string[],
  segments: Array<{ startSec: number; endSec: number }>,
): void {
  // P2 思考不得混进输出：查上游**原始响应**，不是查解析后的段卡。
  const thoughtLeaks = rawTexts.filter(
    (text) => /"thought"\s*:\s*true/.test(text) || /<think>/i.test(text),
  ).length;
  record(
    "P2",
    "思考未混进输出 JSON",
    rawTexts.length === 0 ? "not_observed" : thoughtLeaks === 0 ? "pass" : "fail",
    rawTexts.length === 0 ? "本轮没有可读的原始响应" : `${rawTexts.length} 份原始响应中残留 ${thoughtLeaks} 处`,
  );

  const advisorySegments: string[] = [];
  const truncatedSegments: string[] = [];
  const overlong: string[] = [];
  const audioThin: string[] = [];
  const tailSegments: string[] = [];

  for (const { segmentIndex, card } of cards) {
    const advisories = Array.isArray(card.advisories)
      ? card.advisories as Array<Record<string, unknown>>
      : [];
    if (advisories.length) {
      advisorySegments.push(
        `第${segmentIndex + 1}段[${advisories.map((row) => String(row.code)).join(",")}]`,
      );
    }
    if (card.truncated === true) truncatedSegments.push(`第${segmentIndex + 1}段`);

    const shots = Array.isArray(card.shots) ? card.shots as Array<Record<string, unknown>> : [];
    for (const shot of shots) {
      const len = Number(shot.endSec) - Number(shot.startSec);
      if (Number.isFinite(len) && len > NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC) {
        overlong.push(`第${segmentIndex + 1}段 ${len.toFixed(1)}秒`);
      }
    }

    const span = segments[segmentIndex];
    const lenSec = span ? span.endSec - span.startSec : 0;
    const tracks = (Array.isArray(card.audioResolution) ? card.audioResolution : [])
      .flatMap((chunk) => {
        const analysis = (chunk as { analysis?: { audioTrack?: unknown[] } }).analysis;
        return Array.isArray(analysis?.audioTrack) ? analysis!.audioTrack! : [];
      });
    const audioFloor = Math.max(1, Math.ceil(lenSec / NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC));
    if (lenSec > 0 && tracks.length < audioFloor) {
      audioThin.push(`第${segmentIndex + 1}段 ${tracks.length}/${audioFloor} 段`);
    }
    if (lenSec > 0 && lenSec < NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC) {
      tailSegments.push(`第${segmentIndex + 1}段 ${Math.round(lenSec)}秒 ${shots.length}镜`);
    }
  }

  record(
    "P3",
    "advisory 通路可读",
    advisorySegments.length ? "pass" : "not_observed",
    advisorySegments.length
      ? `${advisorySegments.length}/${cards.length} 段带建议：${advisorySegments.join("、")}`
      : "本轮没有任何段产生 advisory（通路未被触发，不等于可用）",
  );
  record(
    "P4",
    "截断段保留并标记",
    truncatedSegments.length ? "pass" : "not_observed",
    truncatedSegments.length
      ? `已入库并标记：${truncatedSegments.join("、")}`
      : "本轮未发生 MAX_TOKENS 截断",
  );
  record(
    "P5",
    "音轨低于地板不再拒收",
    audioThin.length ? "pass" : "not_observed",
    audioThin.length
      ? `低于地板但已入库：${audioThin.join("、")}`
      : "本轮无低于地板的段",
  );
  record(
    "P6",
    "🔒 30 秒硬上限生效",
    cards.length === 0 ? "not_observed" : overlong.length === 0 ? "pass" : "fail",
    cards.length === 0
      ? "没有可检的段卡"
      : overlong.length === 0
        ? `${cards.length} 段全部无超长证据段`
        : `超长证据段 ${overlong.length} 条：${overlong.join("、")}`,
  );
  record(
    "P7",
    "尾片豁免",
    tailSegments.length ? "pass" : "not_observed",
    tailSegments.length
      ? `尾片已入库：${tailSegments.join("、")}`
      : "本轮分片被整除，没有不足整片的尾片",
  );
}

async function main() {
  checkFrozenParams();

  console.info(`[v11] 阶段：片源解析（${IS_DOUYIN ? "抖音" : "0996 播放页"}）标识 ${VIDEO_ID}`);
  const { mediaUrl, referer, durationSec, kindZh } = await resolveSourceMedia();
  // 复用生产切段函数：整集 4–8 片，末片天然是尾片（P7 只有整集才验得到）。
  const segments = splitNativeDeepReadSegments(durationSec);
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify({ sourceVideoId: VIDEO_ID, durationSec, version: 11 }))
    .digest("hex");
  console.info(
    `[v11] 阶段：${kindZh} 解析成功 真实时长 ${durationSec} 秒 → ${segments.length} 片`
    + `（${segments.map((s) => `${s.startSec}–${s.endSec}`).join(" / ")}）`,
  );

  const videosBefore = new Set(await listGcsObjectNamesByPrefix({
    prefix: videoPrefix, literalPrefix: true, maxResults: 1_000,
  }));

  let runError: unknown;
  let result: Awaited<ReturnType<typeof runManhuaNativeDeepRead>> | undefined;
  const modelReceipts: Array<Record<string, unknown>> = [];
  try {
    result = await runManhuaNativeDeepRead({
      seriesKey,
      episodeIndex: 1,
      sourceDigest,
      resolveNodes: async () => [{ url: mediaUrl, referer }],
      segments,
      sourceDurationSec: durationSec,
      hintZh: "v11 验收探针：整集门禁转建议与参数冻结实弹",
      onModelReceipt: (receipt) => {
        modelReceipts.push(receipt as unknown as Record<string, unknown>);
      },
    });
  } catch (error) {
    runError = error;
  }

  // P8 重试语义：统计每段真实发起的付费调用次数。
  const attemptsBySegment = new Map<number, number>();
  for (const receipt of modelReceipts) {
    if (String(receipt.stage || "") !== "visual_model") continue;
    if (String(receipt.status || "") !== "started") continue;
    const chunkIndex = Number(receipt.chunkIndex);
    if (!Number.isInteger(chunkIndex)) continue;
    attemptsBySegment.set(chunkIndex, (attemptsBySegment.get(chunkIndex) || 0) + 1);
  }
  const retried = Array.from(attemptsBySegment.entries()).filter(([, n]) => n > 1);
  record(
    "P8",
    "门禁类不再触发重试",
    modelReceipts.length === 0
      ? "not_observed"
      : retried.length === 0 ? "pass" : "fail",
    modelReceipts.length === 0
      ? "没有收到任何模型回执（回执通路本身可疑）"
      : retried.length === 0
        ? `${attemptsBySegment.size} 段全部一发过`
        : `发生重试：${retried.map(([i, n]) => `第${i + 1}段×${n}`).join("、")}（需核对拒因是否属真失败）`,
  );

  // 段卡与原始响应都从 GCS canonical 位置读，不依赖 result 上的任何私有字段。
  const [rawNames, parsedNames, videosAfter] = await Promise.all([
    listGcsObjectNamesByPrefix({ prefix: rawPrefix, literalPrefix: true, maxResults: 200 }),
    listGcsObjectNamesByPrefix({ prefix: parsedPrefix, literalPrefix: true, maxResults: 200 }),
    listGcsObjectNamesByPrefix({ prefix: videoPrefix, literalPrefix: true, maxResults: 1_000 }),
  ]);
  const cards = (await Promise.all(parsedNames.map(async (objectName) => ({
    segmentIndex: segmentIndexFromName(objectName),
    card: segmentCardOf(await downloadJson(objectName)),
  })))).filter((row) => row.segmentIndex >= 0)
    .sort((a, b) => a.segmentIndex - b.segmentIndex);
  const rawTexts = await Promise.all(rawNames.map(async (objectName) =>
    JSON.stringify(await downloadJson(objectName))));

  inspectSegments(cards, rawTexts, segments);

  const leaked = videosAfter.filter((name) => !videosBefore.has(name));
  record(
    "P9",
    "临时视频零残留",
    leaked.length === 0 ? "pass" : "fail",
    `残留 ${leaked.length} 个`,
  );

  // 结束门：九个 ID 恰好各一条，任何非 pass 都不许算「全通过」。
  const ids = checks.map((row) => row.id).sort();
  const expectedIds: CheckId[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"];
  const idsComplete = JSON.stringify(ids) === JSON.stringify([...expectedIds].sort());
  const failCount = checks.filter((row) => row.status === "fail").length;
  const notObserved = checks.filter((row) => row.status === "not_observed").length;
  const status = runError || failCount > 0 || !idsComplete
    ? "failed"
    : notObserved > 0 ? "incomplete" : "passed";

  const summary = {
    schemaVersion: 2,
    runId: seriesKey,
    planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
    sourceKindZh: kindZh,
    sourceVideoId: VIDEO_ID,
    durationSec,
    segmentPlan: segments,
    status,
    error: runError
      ? sanitizeSensitiveText(runError instanceof Error ? runError.message : String(runError))
      : undefined,
    checks,
    passCount: checks.filter((row) => row.status === "pass").length,
    failCount,
    notObservedCount: notObserved,
    idsComplete,
    resultCounts: result
      ? {
        shotCount: result.shotCount,
        segmentCount: result.segmentCount,
        droppedCount: result.droppedCount,
        truncated: result.truncated,
        advisories: (result as { advisories?: unknown[] }).advisories?.length ?? 0,
      }
      : undefined,
    evidenceCounts: { rawObjects: rawNames.length, parsedObjects: parsedNames.length },
    leakedObjectNames: leaked,
  };
  await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: `manhua-template-learn/probes/${seriesKey}/v11-acceptance.json`,
    contentType: "application/json",
    buffer: Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  });
  console.info(JSON.stringify(summary, null, 2));
  if (runError) throw runError;
  if (!idsComplete) throw new Error(`v11 验收项不齐：只产出 ${ids.join(",")}`);
  if (failCount > 0) throw new Error(`v11 验收未通过：${failCount} 项 FAIL`);
  if (notObserved > 0) {
    console.warn(`[v11] ${notObserved} 项未观察到，**不得据此宣称九项全通过**`);
  }
}

main().catch((error) => {
  console.error(`[v11] 失败：${sanitizeSensitiveText(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});

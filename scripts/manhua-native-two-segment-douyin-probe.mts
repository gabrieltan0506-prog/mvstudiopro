/**
 * 抖音单集 0–300 / 300–600 秒真实精读探针（与 manhua-native-two-segment-evidence-probe.mts
 * 同 schema、同门禁、同保存策略；唯一差异是片源解析层走抖音 yt-dlp）。
 *
 * 只允许在 Fly 内执行：凭证从服务端环境读取。视频 MP4 仅供本轮模型调用，
 * 任务结束立即删除并复查无残留；上游完整响应、解析后段证据与本次核对摘要永久保存在 GCS。
 * 分段按真实时长收口：不足 300 秒只跑一段，不足 600 秒第二段到真实终点为止。
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC,
  NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  runManhuaNativeDeepRead,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import {
  probeNativeDeepReadDurationSec,
  splitNativeDeepReadSegments,
} from "../server/services/manhuaNativeDeepReadPlan.js";
import { fetchDouyinAwemeDetailViaWebApi } from "../server/services/manhuaLearnDouyinWebApi.js";
import {
  describeErrorChain,
  sanitizeSensitiveText,
} from "../server/services/manhuaMediaSanitize.js";
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
const VIDEO_ID = SOURCE.match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "";
const PAGE_URL = VIDEO_ID ? `https://www.douyin.com/video/${VIDEO_ID}` : "";
if (!PAGE_URL) throw new Error("缺少 --url=（抖音 /video/<id> 或带 modal_id 的链接）");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

/** 🔓 并发上限由命令行给，不写死（用户令「上限应该是我来定的」）。省略＝走生产默认。 */
const numArg = (name: string): number | undefined => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const value = Math.floor(Number(hit.slice(name.length + 3)));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};
const cutConcurrency = numArg("cut-concurrency");
const uploadConcurrency = numArg("upload-concurrency");
const modelConcurrency = numArg("model-concurrency");

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesKey = `probe_douyin_${runStamp}`;
/**
 * 身份串按**真实整集范围**算。旧版写死 `range:[0,600]`——那是两段探针时代的遗留，
 * 现在跑整集 4–8 片，写死 600 会让证据溯源上的「范围」与实际覆盖对不上。
 * 真实时长要 ffprobe 之后才知道，所以这里只给一个工厂，main 里拿到时长再算。
 */
const makeSourceDigest = (durationSec: number): string => createHash("sha256")
  .update(JSON.stringify({
    sourceVideoId: VIDEO_ID,
    range: [0, Math.round(durationSec)],
    version: 2,
  }))
  .digest("hex");
const bucket = getGcsBucketName();
const rawPrefix = `manhua-template-learn/segment-evidence-raw/tpl_native_${seriesKey}_ep001/`;
const parsedPrefix = `manhua-template-learn/segment-evidence/tpl_native_${seriesKey}_ep001/`;

function pickMedia(info: Record<string, unknown>): string {
  const formats = Array.isArray(info.formats) ? info.formats as Array<Record<string, unknown>> : [];
  const candidates = formats
    .filter((row) => String(row.url || "") && String(row.vcodec || "none") !== "none" && String(row.acodec || "none") !== "none")
    .sort((a, b) => Number(a.filesize || a.filesize_approx || 9e15) - Number(b.filesize || b.filesize_approx || 9e15));
  const url = String(candidates[0]?.url || info.url || "");
  if (!/^https:\/\//.test(url)) throw new Error("未解析到带音画的抖音媒体流");
  return url;
}

type EvidenceCounts = {
  shots: number;
  subtitles: number;
  audioResolution: number;
  audioTracks: number;
  audioCues: number;
};

function countsOf(raw: Record<string, unknown>): EvidenceCounts {
  const audioResolution = Array.isArray(raw.audioResolution) ? raw.audioResolution : [];
  const analyses = audioResolution
    .map((row) => (row && typeof row === "object" ? (row as { analysis?: unknown }).analysis : null))
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  const tracks = analyses.flatMap((analysis) => (
    Array.isArray(analysis.audioTrack) ? analysis.audioTrack : []
  ));
  return {
    shots: Array.isArray(raw.shots) ? raw.shots.length : 0,
    subtitles: Array.isArray(raw.subtitles) ? raw.subtitles.length : 0,
    audioResolution: audioResolution.length,
    audioTracks: tracks.length,
    audioCues: tracks.reduce((sum, row) => (
      sum + (row && typeof row === "object" && Array.isArray((row as { cues?: unknown }).cues)
        ? (row as { cues: unknown[] }).cues.length
        : 0)
    ), 0),
  };
}

function extractModelJsonFromRawEvidence(payload: unknown): Record<string, unknown> {
  const stored = payload && typeof payload === "object" ? payload as { responseText?: unknown } : null;
  const envelope = JSON.parse(String(stored?.responseText || "")) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (envelope.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => String(part.text || ""))
    .join("");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("原始响应候选正文不是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function segmentIndexFromName(name: string): number {
  const match = /\/seg(\d+)(?:\/|-)/.exec(name);
  return Number(match?.[1] ?? -1);
}

async function objectFact(objectName: string) {
  const downloaded = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
  return {
    objectName,
    bytes: downloaded.buffer.byteLength,
    sha256: createHash("sha256").update(downloaded.buffer).digest("hex"),
    payload: JSON.parse(downloaded.buffer.toString("utf8")) as unknown,
  };
}

/** 匿名 yt-dlp（零 Cookie/凭证 argv）：页面法失败时的兜底与时长补齐。 */
async function fetchInfoAnonymously(): Promise<Record<string, unknown>> {
  const { stdout } = await run("yt-dlp", [
    "-J", "--no-warnings", PAGE_URL,
  ], { timeout: 150_000, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

/**
 * 片源解析：**走抖音 web api**（与生产同一条路）。
 *
 * 视频页是客户端渲染的壳，HTML 里没有 play_addr——0829 实测 814KB 页面零个播放地址，
 * 且验证页特征全为 0（不是 Cookie 失效）。web api 一次拿到全部可信播放地址。
 * 时长该接口不回，走生产 ffprobe 读远端头部（不下片）。
 * 匿名 yt-dlp 只作最后兜底（它自身要求 fresh cookies，通常也过不去）。
 */
async function resolveSourceMedia(): Promise<{ mediaUrl: string; durationSec: number; kindZh: string }> {
  const referer = "https://www.douyin.com/";
  try {
    const detail = await fetchDouyinAwemeDetailViaWebApi(VIDEO_ID);
    const mediaUrl = detail?.playbackUrl || "";
    if (!mediaUrl) throw new Error("web api 未返回可信播放地址");
    if (detail?.access === "paid_locked") throw new Error("该集为付费锁定内容，探针不越过付费边界");
    return {
      mediaUrl,
      durationSec: await probeNativeDeepReadDurationSec(mediaUrl, undefined, undefined, referer),
      kindZh: `抖音 web api（access=${detail?.access ?? "unknown"}）`,
    };
  } catch (apiError) {
    console.error(`[probe] web api 解析失败，回退匿名 yt-dlp：${sanitizeSensitiveText(apiError)}`);
    const info = await fetchInfoAnonymously();
    const mediaUrl = pickMedia(info);
    const hinted = Math.floor(Number(info.duration) || 0);
    return {
      mediaUrl,
      durationSec: hinted > 0
        ? hinted
        : await probeNativeDeepReadDurationSec(mediaUrl, undefined, undefined, referer),
      kindZh: "抖音（yt-dlp 兜底）",
    };
  }
}

/* ─────────── v11 验收：三态判定，「未观察到」不许冒充「通过」 ─────────── */

type CheckStatus = "pass" | "fail" | "not_observed";
type CheckId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10";
type Check = { id: CheckId; nameZh: string; status: CheckStatus; actualZh: string };
const checks: Check[] = [];
const record = (id: CheckId, nameZh: string, status: CheckStatus, actualZh: string) => {
  checks.push({ id, nameZh, status, actualZh });
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "未观察";
  console.info(`[probe] ${tag} ${id} ${nameZh} —— ${actualZh}`);
};

async function main() {
  // P1 冻结参数：在任何付费动作之前先核对，参数不对就别烧钱。
  {
    const cfg = NATIVE_DEEP_READ_GENERATION_CONFIG as Record<string, unknown>;
    const thinking = (cfg.thinkingConfig ?? {}) as Record<string, unknown>;
    const ok = cfg.temperature === 0.7
      && cfg.maxOutputTokens === 65_536
      && thinking.thinkingBudget === 18_000
      && thinking.includeThoughts === false
      && !("thinkingLevel" in thinking)
      && NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(",") === "0.7,0.65,0.6";
    record("P1", "冻结参数与代码常量一致", ok ? "pass" : "fail",
      `temperature=${String(cfg.temperature)} · thinkingBudget=${String(thinking.thinkingBudget)}`
      + ` · includeThoughts=${String(thinking.includeThoughts)}`
      + ` · thinkingLevel=${"thinkingLevel" in thinking ? "存在（不合规）" : "无"}`
      + ` · 梯度=[${NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(", ")}] · plan=${NATIVE_DEEP_READ_VISUAL_PLAN_VERSION}`);
  }

  console.info(`[probe] 阶段：抖音片源解析（web api）视频 ${VIDEO_ID}`);
  const { mediaUrl, durationSec, kindZh } = await resolveSourceMedia();
  console.info(`[probe] 阶段：${kindZh} 解析成功，真实时长 ${durationSec} 秒`);

  // 整集分片：复用生产切段函数。集级门禁与尾片豁免只有整集才验得到。
  const segments = splitNativeDeepReadSegments(durationSec);
  const coveredEnd = segments[segments.length - 1]!.endSec;
  const sourceDigest = makeSourceDigest(coveredEnd);
  console.info(`[probe] 建单：series=${seriesKey} · 分段 ${segments.map((s) => `${s.startSec}–${s.endSec}`).join(" / ")} · 原始 JSON 永久保留`);

  const videoPrefix = "manhua-template-learn/tmp/native-deep-read/";
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
      resolveNodes: async () => [{ url: mediaUrl, referer: "https://www.douyin.com/" }],
      segments,
      sourceDurationSec: coveredEnd,
      hintZh: "抖音漫剧完整视听证据探针；按真实镜头、表演、光影、声音和叙事变化记录",
      // 🔓 并发上限：命令行给了就用命令行的，没给就走生产默认（切段 10 / 上传 4 / 扇出 10）。
      mediaCutConcurrency: cutConcurrency,
      mediaUploadConcurrency: uploadConcurrency,
      segmentModelConcurrency: modelConcurrency,
      onModelReceipt: (receipt) => {
        // 回执带时间戳才算得出「峰值同时在飞几发」——P10 的唯一依据。
        modelReceipts.push({
          ...(receipt as unknown as Record<string, unknown>),
          observedAtMs: Date.now(),
        });
      },
    });
  } catch (error) {
    runError = error;
  }

  const [rawNames, parsedNames, videosAfter] = await Promise.all([
    listGcsObjectNamesByPrefix({ prefix: rawPrefix, literalPrefix: true, maxResults: 100 }),
    listGcsObjectNamesByPrefix({ prefix: parsedPrefix, literalPrefix: true, maxResults: 100 }),
    listGcsObjectNamesByPrefix({ prefix: videoPrefix, literalPrefix: true, maxResults: 1_000 }),
  ]);
  const temporaryVideoLeaks = videosAfter.filter((name) => !videosBefore.has(name));
  const rawFacts = await Promise.all(rawNames.map(objectFact));
  const parsedFacts = await Promise.all(parsedNames.map(objectFact));
  const rawBySegment = new Map<number, ReturnType<typeof countsOf>>();
  const parsedBySegment = new Map<number, ReturnType<typeof countsOf>>();

  for (const fact of rawFacts) {
    const segmentIndex = segmentIndexFromName(fact.objectName);
    // 同段重试可能有多份原始响应；最后一份是最终接受/拒绝判断的输入。
    // 坏 JSON 的失败尝试同样是合法证据（重试梯度的存在理由），不得让它阻断摘要落盘。
    try {
      rawBySegment.set(segmentIndex, countsOf(extractModelJsonFromRawEvidence(fact.payload)));
    } catch {
      console.error(`[probe] 原始证据不可解析（不阻断摘要）：${fact.objectName}`);
    }
  }
  for (const fact of parsedFacts) {
    const entry = fact.payload && typeof fact.payload === "object"
      ? fact.payload as { raw?: unknown }
      : null;
    if (!entry?.raw || typeof entry.raw !== "object" || Array.isArray(entry.raw)) {
      throw new Error(`解析后证据缺少 raw：${fact.objectName}`);
    }
    parsedBySegment.set(segmentIndexFromName(fact.objectName), countsOf(entry.raw as Record<string, unknown>));
  }

  const reconciliations = segments.map((_, segmentIndex) => {
    const rawCounts = rawBySegment.get(segmentIndex);
    const parsedCounts = parsedBySegment.get(segmentIndex);
    const countsEqual = Boolean(rawCounts && parsedCounts
      && JSON.stringify(rawCounts) === JSON.stringify(parsedCounts));
    return { segmentIndex, rawCounts, parsedCounts, countsEqual };
  });
  // 关键帧抽取（¥0，模型无关）：每个 story 镜头中点一帧，画面证据永久保留，
  // 供面板与审片报告展示引用；广告镜头不抽。单帧失败只记错，不阻断摘要。
  const frameEvidence: Array<{
    segmentIndex: number; shotIndex: number; atSec: number; objectName: string; bytes: number;
  }> = [];
  const frameErrors: string[] = [];
  for (const fact of parsedFacts) {
    const segmentIndex = segmentIndexFromName(fact.objectName);
    const entry = fact.payload as { raw?: { shots?: Array<Record<string, unknown>> } };
    const shots = Array.isArray(entry.raw?.shots) ? entry.raw.shots : [];
    for (let shotIndex = 0; shotIndex < shots.length && frameEvidence.length < 240; shotIndex += 1) {
      const shot = shots[shotIndex]!;
      if (shot.evidenceRole === "non_story_ad") continue;
      const startSec = Number(shot.startSec) || 0;
      const endSec = Math.max(startSec, Number(shot.endSec) || startSec);
      const atSec = Math.round(((startSec + endSec) / 2) * 10) / 10;
      const local = `/tmp/probe-frame-${segmentIndex}-${shotIndex}.jpg`;
      try {
        await run("ffmpeg", [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "-headers", "Referer: https://www.douyin.com/\r\n",
          "-ss", String(atSec), "-i", mediaUrl, "-frames:v", "1", "-q:v", "4", local,
        ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
        const buffer = await readFile(local);
        const objectName = `manhua-template-learn/probes/${seriesKey}/frames/seg${segmentIndex}/shot${String(shotIndex).padStart(3, "0")}-${Math.round(atSec * 10)}ds.jpg`;
        await uploadBufferToGcsIfAbsent({ bucket, objectName, contentType: "image/jpeg", buffer });
        frameEvidence.push({ segmentIndex, shotIndex, atSec, objectName, bytes: buffer.byteLength });
        await rm(local, { force: true });
        if (frameEvidence.length % 20 === 0) console.info(`[probe] 阶段：关键帧已抽 ${frameEvidence.length} 帧`);
      } catch (error) {
        frameErrors.push(`seg${segmentIndex}#${shotIndex}@${atSec}s ${sanitizeSensitiveText(error)}`.slice(0, 120));
        await rm(local, { force: true }).catch(() => {});
      }
    }
  }
  console.info(`[probe] 阶段：关键帧抽取完成 ${frameEvidence.length} 帧，失败 ${frameErrors.length}`);

  /* ─────────── 失败台账：每条失败给全文原因，不许只留「截断」「error」 ─────────── */
  const failures = modelReceipts
    .filter((row) => String(row.status || "") === "failed")
    .map((row) => {
      const providerError = (row.providerError ?? {}) as Record<string, unknown>;
      const chunkIndex = Number(row.chunkIndex);
      return {
        段: Number.isInteger(chunkIndex) ? `第${chunkIndex + 1}段` : "整集/装配层",
        stage: String(row.stage || ""),
        route: String(row.route || ""),
        第几次尝试: row.attemptNumber ?? null,
        温度: row.temperature ?? null,
        finishReason: row.finishReason ?? null,
        httpStatus: providerError.httpStatus ?? null,
        上游错误正文: providerError.bodyZh ?? providerError.messageZh ?? providerError.message ?? null,
        providerRequestId: row.providerRequestId ?? null,
        失败原因全文: sanitizeSensitiveText(String(row.errorZh || "")) || "（回执未带 errorZh，见上游错误正文）",
        用量: {
          inputTokens: row.inputTokens ?? null,
          outputTokens: row.outputTokens ?? null,
          reasoningTokens: row.reasoningTokens ?? null,
          audioInputTokens: row.audioInputTokens ?? null,
        },
        本次计费人民币: row.priceEquivalentCny ?? null,
      };
    });
  if (failures.length) {
    console.error(`[probe] 失败台账 ${failures.length} 条（逐条全文）：`);
    for (const row of failures) console.error(JSON.stringify(row, null, 2));
  }

  /* ─────────── P2–P9 验收：全部读已落盘的证据，不读 result 上的私有字段 ─────────── */
  const parsedCards = parsedFacts.map((fact) => ({
    segmentIndex: segmentIndexFromName(fact.objectName),
    card: (fact.payload as { raw: Record<string, unknown> }).raw,
  })).sort((a, b) => a.segmentIndex - b.segmentIndex);

  const thoughtLeaks = rawFacts.filter((fact) => {
    const text = JSON.stringify(fact.payload);
    return /"thought"\s*:\s*true/.test(text) || /<think>/i.test(text);
  }).length;
  record("P2", "思考未混进输出 JSON",
    rawFacts.length === 0 ? "not_observed" : thoughtLeaks === 0 ? "pass" : "fail",
    rawFacts.length === 0 ? "没有可读的原始响应" : `${rawFacts.length} 份原始响应中残留 ${thoughtLeaks} 处`);

  const advisoriesDetail: Array<{ 段: string; code: string; detailZh: string }> = [];
  const truncatedSegments: string[] = [];
  const overlong: string[] = [];
  const audioThin: string[] = [];
  const tailSegments: string[] = [];
  for (const { segmentIndex, card } of parsedCards) {
    for (const row of (Array.isArray(card.advisories) ? card.advisories as Array<Record<string, unknown>> : [])) {
      advisoriesDetail.push({
        段: `第${segmentIndex + 1}段`,
        code: String(row.code ?? ""),
        detailZh: String(row.detailZh ?? ""),
      });
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
    const tracks = (Array.isArray(card.audioResolution) ? card.audioResolution : []).flatMap((chunk) => {
      const analysis = (chunk as { analysis?: { audioTrack?: unknown[] } }).analysis;
      return Array.isArray(analysis?.audioTrack) ? analysis!.audioTrack! : [];
    });
    const audioFloor = Math.max(1, Math.ceil(lenSec / NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC));
    if (lenSec > 0 && tracks.length < audioFloor) audioThin.push(`第${segmentIndex + 1}段 ${tracks.length}/${audioFloor} 段`);
    if (lenSec > 0 && lenSec < NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC) {
      tailSegments.push(`第${segmentIndex + 1}段 ${Math.round(lenSec)}秒 ${shots.length}镜`);
    }
  }

  record("P3", "advisory 通路可读", advisoriesDetail.length ? "pass" : "not_observed",
    advisoriesDetail.length ? `${advisoriesDetail.length} 条：${advisoriesDetail.map((r) => `${r.段}${r.code}`).join("、")}` : "本轮无任何段产生 advisory");
  record("P4", "截断段保留并标记", truncatedSegments.length ? "pass" : "not_observed",
    truncatedSegments.length ? `已入库并标记：${truncatedSegments.join("、")}` : "本轮未发生 MAX_TOKENS 截断");
  record("P5", "音轨低于地板不再拒收", audioThin.length ? "pass" : "not_observed",
    audioThin.length ? `低于地板但已入库：${audioThin.join("、")}` : "本轮无低于地板的段");
  record("P6", "🔒 30 秒硬上限生效",
    parsedCards.length === 0 ? "not_observed" : overlong.length === 0 ? "pass" : "fail",
    parsedCards.length === 0 ? "没有可检段卡" : overlong.length === 0
      ? `${parsedCards.length} 段全部无超长证据段` : `超长 ${overlong.length} 条：${overlong.join("、")}`);
  record("P7", "尾片豁免", tailSegments.length ? "pass" : "not_observed",
    tailSegments.length ? `尾片已入库：${tailSegments.join("、")}` : "本轮分片被整除，无尾片");

  const attemptsBySegment = new Map<number, number>();
  for (const receipt of modelReceipts) {
    if (String(receipt.stage || "") !== "visual_model") continue;
    if (String(receipt.status || "") !== "started") continue;
    const chunkIndex = Number(receipt.chunkIndex);
    if (Number.isInteger(chunkIndex)) attemptsBySegment.set(chunkIndex, (attemptsBySegment.get(chunkIndex) || 0) + 1);
  }
  const retried = Array.from(attemptsBySegment.entries()).filter(([, n]) => n > 1);
  // 🔧 P8 口径已订正（v11）。旧版写的是「门禁类不再触发重试，>1 发即 FAIL」——
  // 那是 v10「门禁转 advisory」时代的口径。v11 用户拍板改成**门禁贴标记＋照常重试**
  // （「我就是要让所有的产出都进 GLM」），重试是**设计行为**，不是缺陷。
  // 拿旧口径跑这一轮，会把正常行为判成 FAIL——花一轮钱换一个错结论。
  // 新口径：重试本身只报不判；只有「三档温度用尽仍然没有落地的段」才是真失败。
  const landedSegments = new Set(parsedCards.map((row) => row.segmentIndex));
  // 0830 审查修正：旧判据只看「发满三档还没落地」的段，会漏掉两类真失败——
  // ① 关闭式失败（schema 错误直接抛，不进重试，发数 <3）
  // ② 压根没发出 started 回执的段（切段/上传阶段就挂了，attemptsBySegment 里没有它）
  // 判据改成对**全量段**遍历「有没有落地」，attempts 只进说明文字。
  const exhausted = segments
    .map((_, index) => index)
    .filter((index) => !landedSegments.has(index))
    .map((index) => {
      const attempts = attemptsBySegment.get(index) || 0;
      return attempts === 0
        ? `第${index + 1}段未发出任何模型请求即失败（切段/上传阶段）`
        : `第${index + 1}段发了${attempts}发仍未落地`;
    });
  record("P8", "重试收敛（门禁标记后重试属设计行为，只看最终有没有落地）",
    modelReceipts.length === 0 ? "not_observed" : exhausted.length === 0 ? "pass" : "fail",
    modelReceipts.length === 0 ? "没有收到任何模型回执（回执通路可疑）"
      : exhausted.length > 0 ? exhausted.join("、")
        : retried.length === 0
          ? `${attemptsBySegment.size} 段全部一发过，零重试`
          : `${attemptsBySegment.size} 段全部落地；其中发生重试：`
            + `${retried.map(([i, n]) => `第${i + 1}段×${n}发`).join("、")}`
            + `（温度梯度 [${NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(", ")}]）`);

  // 🆕 P10：实测并发峰值。0829 晚把扇出上限从 4 改成 10，不实测＝改了等于没验证。
  // 依据是回执时间戳：visual_model 的 started +1 / completed|failed −1，走一遍取峰值。
  const inFlightEvents = modelReceipts
    .filter((row) => String(row.stage || "") === "visual_model")
    .map((row) => ({
      at: Number(row.observedAtMs) || 0,
      delta: String(row.status || "") === "started" ? 1 : -1,
    }))
    .sort((a, b) => (a.at - b.at) || (b.delta - a.delta));
  let inFlight = 0;
  let peakInFlight = 0;
  for (const event of inFlightEvents) {
    inFlight += event.delta;
    peakInFlight = Math.max(peakInFlight, inFlight);
  }
  // 0830 审查修正：期望值必须扣掉缓存命中的段。旧版拿 min(cap, 总片数) 当期望，
  // 缓存命中多时必判 FAIL，而它自己的说明文字却写着「属正常」——文案与判定打架，
  // 还会把整体 acceptanceStatus 拉成 failed。改成按**实际发出请求的段数**算期望。
  const dispatchedSegments = attemptsBySegment.size;
  const expectedFanOut = Math.min(
    modelConcurrency || NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
    dispatchedSegments,
  );
  record("P10", "模型扇出真并发（不是 4 路批次串行）",
    dispatchedSegments === 0 ? "not_observed"
      : peakInFlight >= expectedFanOut ? "pass" : "fail",
    dispatchedSegments === 0 ? "本轮全部命中缓存，未发出任何模型请求"
      : `峰值同时在飞 ${peakInFlight} 发 · 期望 ${expectedFanOut} 发`
        + ` · 实际发出请求 ${dispatchedSegments} 段 / 本集 ${segments.length} 片`);
  record("P9", "临时视频零残留", temporaryVideoLeaks.length === 0 ? "pass" : "fail",
    `残留 ${temporaryVideoLeaks.length} 个`);

  const checkIds = checks.map((row) => row.id).sort();
  const idsComplete = JSON.stringify(checkIds)
    === JSON.stringify(["P1", "P10", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]);
  const failCount = checks.filter((row) => row.status === "fail").length;
  const notObserved = checks.filter((row) => row.status === "not_observed").length;
  const acceptanceStatus = runError || failCount > 0 || !idsComplete
    ? "failed" : notObserved > 0 ? "incomplete" : "passed";
  console.info(`[probe] 验收结论 ${acceptanceStatus}：pass ${checks.length - failCount - notObserved} · fail ${failCount} · 未观察 ${notObserved}`);

  const summary = {
    schemaVersion: 2,
    acceptanceStatus,
    checks,
    idsComplete,
    failCount,
    notObservedCount: notObserved,
    failures,
    failureCount: failures.length,
    advisoriesDetail,
    episodeAdvisoriesDetail: ((result as { advisories?: Array<Record<string, unknown>> } | undefined)?.advisories ?? [])
      .map((row) => ({
        段: Number.isInteger(row.segmentIndex) ? `第${Number(row.segmentIndex) + 1}段` : "整集",
        code: String(row.code ?? ""),
        detailZh: String(row.detailZh ?? ""),
      })),
    planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
    runId: seriesKey,
    sourceDigest,
    sourceVideoId: VIDEO_ID,
    sourceDurationSec: durationSec,
    ranges: segments.map((s) => [s.startSec, s.endSec]),
    status: runError ? "failed" : "completed",
    error: runError ? sanitizeSensitiveText(runError) : undefined,
    errorCauseChain: runError ? describeErrorChain(runError) : undefined,
    resultCounts: result ? {
      beatGrid: result.beatGrid.length,
      subtitles: result.subtitleTrack.length,
      resolvedAudioChunks: result.resolvedAudioChunks.length,
      segmentCount: result.segmentCount,
      shotCount: result.shotCount,
      droppedCount: result.droppedCount,
      truncated: result.truncated,
    } : undefined,
    rawEvidence: rawFacts.map(({ objectName, bytes, sha256 }) => ({ objectName, bytes, sha256 })),
    parsedEvidence: parsedFacts.map(({ objectName, bytes, sha256 }) => ({ objectName, bytes, sha256 })),
    frameEvidence,
    frameErrors: frameErrors.length ? frameErrors : undefined,
    videoRetention: {
      policy: "delete_on_settle",
      maximumHours: 24,
      leakedObjectNames: temporaryVideoLeaks,
    },
    reconciliations,
  };
  const summaryObjectName = `manhua-template-learn/probes/${seriesKey}/summary.json`;
  const summaryBuffer = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const saved = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: summaryObjectName,
    contentType: "application/json",
    buffer: summaryBuffer,
  });
  if (!saved.created) throw new Error("探针摘要对象已存在，拒绝覆盖");

  console.info(JSON.stringify({
    ...summary,
    summaryEvidence: {
      objectName: summaryObjectName,
      bytes: summaryBuffer.byteLength,
      sha256: createHash("sha256").update(summaryBuffer).digest("hex"),
    },
  }, null, 2));

  if (runError) throw runError;
  if (temporaryVideoLeaks.length > 0) {
    throw new Error(`测试视频清理不完整：leaked=${temporaryVideoLeaks.length}`);
  }
  if (rawFacts.length < segments.length || parsedFacts.length !== segments.length) {
    throw new Error(`证据不完整：raw=${rawFacts.length} parsed=${parsedFacts.length}`);
  }
  if (reconciliations.some((row) => !row.countsEqual)) {
    throw new Error("原始响应与解析后证据条数不一致，已阻断");
  }
  if (result?.truncated || result?.droppedCount) {
    throw new Error(`消费层仍丢证据：truncated=${result?.truncated} dropped=${result?.droppedCount}`);
  }
}

main().catch((error) => {
  console.error(`[probe] 失败：${sanitizeSensitiveText(error)}`);
  console.error(`[probe] 根因链：${JSON.stringify(describeErrorChain(error))}`);
  process.exitCode = 1;
});

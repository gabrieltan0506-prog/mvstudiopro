/**
 * 原生精读发车入口（20 集就跑这个）。
 *
 * 这是 runner + 入库之间那条链路的**唯一可执行出口**。此前两端都写完了，
 * 中间没有任何生产调用点，`MANHUA_NATIVE_DEEP_READ=1` 打开也不改变任何路径。
 *
 * ⚠️ **这条命令会花钱**（模型按 token 计费）。三道保险：
 *   1. `MANHUA_NATIVE_DEEP_READ=1` 不开就直接退出
 *   2. 默认 `--dry-run`：只解析、只列已入库集、打印计划，**不发任何模型请求**
 *   3. 真跑必须显式 `--go`
 *
 * 断点续跑：每集跑完立刻入库，重跑先列 GCS 已入库集并跳过。
 * 列不动时会抛错停手 —— 把「未知」当成「没跑过」等于重烧一遍。
 *
 * 用法：
 *   # 计划（零成本，永远先跑这个）
 *   MANHUA_NATIVE_DEEP_READ=1 npx tsx scripts/manhua-native-deep-read-batch.mts \
 *     --series=<key> --list=<episodes.json> --dry-run
 *
 *   # 真发车
 *   MANHUA_NATIVE_DEEP_READ=1 npx tsx scripts/manhua-native-deep-read-batch.mts \
 *     --series=<key> --list=<episodes.json> --go
 *
 * episodes.json 形状：
 *   [{ "episodeIndex": 1, "sourceUrl": "https://…", "durationSec": 1080,
 *      "segments": [{ "startSec": 0, "endSec": 1080 }] }]
 */
import { config } from "dotenv";
import fs from "node:fs/promises";
import process from "node:process";
import {
  isManhuaNativeDeepReadEnabled,
  resolveNativeDeepReadNodeUrls,
} from "../server/services/manhuaNativeDeepReadRunner.ts";
import { listIngestedNativeDeepReadEpisodes } from "../server/services/manhuaNativeDeepReadIngest.ts";
import {
  NATIVE_DEEP_READ_BATCH_HARD_CEILING,
  NATIVE_DEEP_READ_DEFAULT_BATCH_EPISODES,
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
  runNativeDeepReadBatch,
  validateNativeDeepReadBatchPlan,
  type NativeDeepReadBatchEpisode,
  type NativeDeepReadModelCheckpoint,
} from "../server/services/manhuaNativeDeepReadExecution.ts";
import { listNativeDeepReadEpisodeClaims } from "../server/services/manhuaNativeDeepReadClaim.ts";
import {
  appendManhuaNativeModelReceipt,
  type ManhuaNativeModelReceipt,
} from "../shared/manhuaNativeModelReceipt.ts";

config();

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k!, rest.join("=") || "1"];
  }),
);

function fail(msgZh: string): never {
  console.error(`✗ ${msgZh}`);
  process.exit(1);
}

if (!isManhuaNativeDeepReadEnabled()) {
  fail("MANHUA_NATIVE_DEEP_READ 未开启，拒绝执行（这是防误触发付费调用的第一道闸）");
}

const seriesKey = String(args.get("series") || "").trim();
if (!seriesKey) fail("缺 --series=<合集标识>");
const listPath = String(args.get("list") || "").trim();
if (!listPath) fail("缺 --list=<episodes.json>");

/** 默认干跑：不加 --go 一律不发模型请求 */
const isGo = args.get("go") === "1";
/**
 * 跑几集由你定：`--limit=N`。省略时取默认值，避免手滑把整份清单一口气跑了
 * （原来默认 999，等于「有多少跑多少」）。
 * 真正拦住误发的不是这个数，是下面的确认码 ＋ --max-calls。
 */
const limit = Number(args.get("limit") || NATIVE_DEEP_READ_DEFAULT_BATCH_EPISODES);
if (!Number.isInteger(limit) || limit < 1) fail("--limit 必须是正整数");
if (limit > NATIVE_DEEP_READ_BATCH_HARD_CEILING) {
  fail(`--limit 不能超过失控保险 ${NATIVE_DEEP_READ_BATCH_HARD_CEILING}`);
}

type EpisodeInput = {
  episodeIndex: number;
  sourceUrl: string;
  durationSec: number;
  laneHintZh?: string;
  segments: Array<{ startSec: number; endSec: number; hintZh?: string }>;
};

const raw = JSON.parse(await fs.readFile(listPath, "utf8")) as EpisodeInput[];
if (!Array.isArray(raw) || !raw.length) fail(`${listPath} 里没有可执行的集`);
const wanted = raw.slice(0, limit);

/**
 * 解析该集的 CDN 节点副本：只拿地址，不下载 —— 模型自己去 CDN 拉流。
 *
 * 实现已抽到 `manhuaNativeDeepReadRunner.resolveNativeDeepReadNodeUrls`，
 * 生产链（learnOneEpisodeChunk 的 flag 分支）与本脚本共用同一份：
 * 「挑 format 按体积不按 height」这个口径只能有一处实现。
 */
const resolveNodeUrls = (sourceUrl: string, signal: AbortSignal): Promise<string[]> =>
  resolveNativeDeepReadNodeUrls(sourceUrl, signal);

const controller = new AbortController();
const stop = () => controller.abort(new Error("用户已停止学习"));
process.once("SIGINT", () => {
  console.log("\n收到中断，停止后续集（已入库的集保留）…");
  stop();
});
process.once("SIGTERM", stop);

const MODEL_STAGE_ZH: Record<NativeDeepReadModelCheckpoint["stage"], string> = {
  audio_model: "音轨分析",
  visual_model: "视频精读",
  visual_parse: "视频结构校验",
  series_aggregation_model: "系列结构整理",
};

const MODEL_STATUS_ZH: Record<NativeDeepReadModelCheckpoint["status"], string> = {
  started: "已开始",
  completed: "已完成",
  failed: "失败",
};

let modelReceipts: ManhuaNativeModelReceipt[] = [];

/**
 * 每次真实模型外呼都即时输出一条中性回执。这里只打印供应商回传的诊断字段，
 * 不打印请求载荷、密钥、Cookie 或媒体签名地址。
 */
function printModelCheckpoint(checkpoint: NativeDeepReadModelCheckpoint): void {
  modelReceipts = appendManhuaNativeModelReceipt(modelReceipts, checkpoint);
  const upstream = checkpoint.providerError;
  const fields = [
    `[模型回执] ${MODEL_STAGE_ZH[checkpoint.stage]} · ${MODEL_STATUS_ZH[checkpoint.status]}`,
    `调用=${checkpoint.callId}`,
    checkpoint.episodeIndexes.length
      ? `集数=${checkpoint.episodeIndexes.map((value) => `ep${String(value).padStart(3, "0")}`).join(",")}`
      : undefined,
    checkpoint.chunkIndex !== undefined ? `分片=${checkpoint.chunkIndex}` : undefined,
    checkpoint.variant ? `声道=${checkpoint.variant}` : undefined,
    checkpoint.videoCount !== undefined ? `视频=${checkpoint.videoCount}` : undefined,
    checkpoint.batchRequestId ? `批次=${checkpoint.batchRequestId}` : undefined,
    checkpoint.providerRequestId ? `上游单号=${checkpoint.providerRequestId}` : undefined,
    checkpoint.finishReason ? `结束原因=${checkpoint.finishReason}` : undefined,
    checkpoint.inputTokens !== undefined ? `输入=${checkpoint.inputTokens} tokens` : undefined,
    checkpoint.audioInputTokens !== undefined ? `音频=${checkpoint.audioInputTokens} tokens` : undefined,
    checkpoint.outputTokens !== undefined ? `输出=${checkpoint.outputTokens} tokens` : undefined,
    checkpoint.reasoningTokens !== undefined ? `推理=${checkpoint.reasoningTokens} tokens` : undefined,
    checkpoint.costUsd !== undefined ? `费用=$${checkpoint.costUsd.toFixed(6)}` : undefined,
    checkpoint.priceEquivalentCny !== undefined
      ? `套餐等值=¥${checkpoint.priceEquivalentCny.toFixed(6)}`
      : undefined,
    checkpoint.elapsedMs !== undefined ? `耗时=${Math.round(checkpoint.elapsedMs / 1000)}s` : undefined,
    upstream?.httpStatus !== undefined ? `HTTP=${upstream.httpStatus}` : undefined,
    upstream?.code ? `错误码=${upstream.code}` : undefined,
    upstream?.requestId ? `错误单号=${upstream.requestId}` : undefined,
    upstream?.param ? `参数=${upstream.param}` : undefined,
    upstream?.type ? `类型=${upstream.type}` : undefined,
    upstream?.message ? `上游说明=${upstream.message}` : undefined,
    checkpoint.errorZh ? `本地说明=${checkpoint.errorZh}` : undefined,
  ].filter((value): value is string => Boolean(value));
  console.log(fields.join(" · "));
  if (upstream?.responseBody) console.log(`[模型回执] 上游响应=${upstream.responseBody}`);

  // 回执已明确失败时立即中止后续模型调用；不由脚本自动重试，也不清理占位。
  if (checkpoint.status === "failed" && !controller.signal.aborted) {
    controller.abort(new Error(`${MODEL_STAGE_ZH[checkpoint.stage]}失败，已停止后续模型调用`));
  }
}

const toBatchEpisode = (e: EpisodeInput): NativeDeepReadBatchEpisode => ({
  episodeIndex: e.episodeIndex,
  sourceUrl: e.sourceUrl,
  durationSec: e.durationSec,
  laneHintZh: e.laneHintZh,
  segments: e.segments,
  resolveNodes: () => resolveNodeUrls(e.sourceUrl, controller.signal),
});

// 预检在列 GCS 之前：清单里写两次同一集、集号非法、单段超 1000s 都在这里拒
try {
  validateNativeDeepReadBatchPlan(wanted.map(toBatchEpisode), {
    maxEpisodes: limit,
    seriesKey,
  });
} catch (e) {
  fail(`发车清单预检未过：${e instanceof Error ? e.message : String(e)}`);
}

const alreadyIngested = await listIngestedNativeDeepReadEpisodes(seriesKey);
const existingClaims = await listNativeDeepReadEpisodeClaims(seriesKey);
const todo = wanted.filter((e) => !alreadyIngested.has(e.episodeIndex));
const pendingClaims = todo.filter((episode) => existingClaims.has(episode.episodeIndex));
const plan = todo.length
  ? validateNativeDeepReadBatchPlan(todo.map(toBatchEpisode), { maxEpisodes: limit, seriesKey })
  : null;

console.log("──────── 原生精读发车计划 ────────");
console.log(`合集        ${seriesKey}`);
console.log(`清单        ${listPath} · 共 ${raw.length} 集，本次取前 ${wanted.length} 集（--limit=${limit}）`);
console.log(`已入库      ${alreadyIngested.size} 集 [${[...alreadyIngested].sort((a, b) => a - b).join(",") || "—"}]`);
console.log(`本次要跑    ${todo.length} 集 [${todo.map((e) => e.episodeIndex).join(",") || "—"}]`);
console.log(`总时长      ${Math.round((plan?.totalDurationSec || 0) / 60)} 分钟`);
console.log(`视觉视频分片  ${plan?.totalSegments || 0}`);
console.log(`视觉模型请求  ${plan?.totalVisualCalls || 0}   ← 多集/多分片按输入预算装入同一次请求`);
console.log(`音频模型请求  ${(plan?.totalAudioChunks || 0) * 2}   ← 每个音频分片分别分析单声道与立体声`);
console.log(`模型API总数   ${plan?.totalModelCalls || 0}   ← 视觉 + 双路音频 + 系列聚合`);
console.log(`单段上限    ${NATIVE_DEEP_READ_MAX_SEGMENT_SEC}s（自适应 ≤10fps · 目标约1800帧）`);
console.log(`计划确认码   ${plan?.planHash || "—"}`);
console.log(`待核对占位   ${pendingClaims.length} 集 [${pendingClaims.map((e) => e.episodeIndex).join(",") || "—"}]`);
console.log(`模式        ${isGo ? "🔴 真跑（会花钱）" : "🟢 干跑（不发任何模型请求）"}`);
console.log("──────────────────────────────");

if (!isGo) {
  console.log(
    plan
      ? `干跑结束。确认无误后：--go --confirm=${plan.planHash} --max-calls=${plan.totalModelCalls}`
      : "干跑结束，没有待执行集。",
  );
  process.exit(0);
}

if (!todo.length) {
  console.log("没有要跑的集，退出。");
  process.exit(0);
}
if (pendingClaims.length) {
  fail(`第${pendingClaims.map((e) => e.episodeIndex).join("、")}集存在待核对占位，禁止自动重跑`);
}

// 真跑必须带上扣除已入库集后的实际计划，保证最大调用数与干跑所见一致。
const confirmed = String(args.get("confirm") || "");
const maxCalls = Number(args.get("max-calls"));
if (!plan || confirmed !== plan.planHash || maxCalls !== plan.totalModelCalls) {
  fail(`真跑必须携带 --confirm=${plan?.planHash || "<确认码>"} --max-calls=${plan?.totalModelCalls || 0}`);
}

const episodes: NativeDeepReadBatchEpisode[] = todo.map(toBatchEpisode);

const result = await runNativeDeepReadBatch({
  seriesKey,
  episodes,
  abortSignal: controller.signal,
  onProgress: (o) => {
    const mark = o.status === "ingested"
      ? "✅"
      : o.status === "skipped"
        ? "⏭"
        : o.status === "aborted"
          ? "⏹"
          : "✗";
    const cost = o.costCny ? ` · ¥${o.costCny.toFixed(4)}` : "";
    const took = o.elapsedMs ? ` · ${Math.round(o.elapsedMs / 1000)}s` : "";
    console.log(`${mark} 第${o.episodeIndex}集 · ${o.status}${cost}${took}${o.gcsUri ? ` · ${o.gcsUri}` : ""}${o.errorZh ? ` · ${o.errorZh}` : ""}`);
  },
  onModelCheckpoint: printModelCheckpoint,
});

const unfinishedReceipts = modelReceipts.filter((receipt) => receipt.status === "started");
const failedReceipts = modelReceipts.filter((receipt) => receipt.status === "failed");
const completedStages = new Set(modelReceipts
  .filter((receipt) => receipt.status === "completed")
  .map((receipt) => receipt.stage));
const receiptAuditErrors: string[] = [];
if (!modelReceipts.length) receiptAuditErrors.push("没有收到任何模型调用回执");
if (!completedStages.has("visual_model")) receiptAuditErrors.push("缺少视频精读完成回执");
if (!completedStages.has("visual_parse")) receiptAuditErrors.push("缺少视频结构校验完成回执");
if (
  result.outcomes.some((outcome) => Number(outcome.usage?.audioInputTokens) > 0)
  && !completedStages.has("audio_model")
) {
  receiptAuditErrors.push("已有音频 token，但缺少音轨分析完成回执");
}
if (
  result.seriesAggregation
  && !result.seriesAggregation.reused
  && !completedStages.has("series_aggregation_model")
) {
  receiptAuditErrors.push("系列结构已重新生成，但缺少模型完成回执");
}
let postRunIngested: Set<number> | undefined;
let storageAuditErrorZh: string | undefined;
try {
  postRunIngested = await listIngestedNativeDeepReadEpisodes(seriesKey);
} catch (error) {
  storageAuditErrorZh = (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
const missingStoredEpisodes = result.outcomes
  .filter((outcome) => outcome.status === "ingested")
  .filter((outcome) => !outcome.gcsUri || !postRunIngested?.has(outcome.episodeIndex));

console.log("──────── 结果 ────────");
console.log(`入库 ${result.ingestedCount} · 跳过 ${result.skippedCount} · 失败 ${result.failedCount}${result.aborted ? " · 被中止" : ""}`);
// 只报成功卡会把「花了钱没入库」那部分算漏
console.log(`实际成本    ¥${result.totalCostCny.toFixed(4)}`);
console.log(`总耗时      ${Math.round(result.totalElapsedMs / 1000)} 秒`);
console.log(`模型回执    ${modelReceipts.length} 条 · 失败 ${failedReceipts.length} · 未终结 ${unfinishedReceipts.length}`);
if (receiptAuditErrors.length) console.error(`✗ 模型回执复核未通过：${receiptAuditErrors.join("；")}`);
if (result.seriesAggregationErrorZh) {
  console.error(`✗ 系列结构整理未完成：${result.seriesAggregationErrorZh}`);
}
if (missingStoredEpisodes.length) {
  console.error(`✗ GCS 入库复核未通过：第${missingStoredEpisodes.map((row) => row.episodeIndex).join("、")}集`);
}
if (storageAuditErrorZh) console.error(`✗ GCS 入库复核未完成：${storageAuditErrorZh}`);
console.log(
  `⚠️ 失败或中止的集会留下占位对象（native-claims/），不会自动清理也不会自动重跑，请人工核对`,
);
// 中止不是失败集，但批次没有完整结束，不能向自动化返回成功码。
process.exit(
  result.failedCount > 0
  || result.aborted
  || failedReceipts.length > 0
  || unfinishedReceipts.length > 0
  || receiptAuditErrors.length > 0
  || missingStoredEpisodes.length > 0
  || Boolean(storageAuditErrorZh)
  || Boolean(result.seriesAggregationErrorZh)
    ? 1
    : 0,
);

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
} from "../server/services/manhuaNativeDeepReadExecution.ts";
import { listNativeDeepReadEpisodeClaims } from "../server/services/manhuaNativeDeepReadClaim.ts";

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
});

console.log("──────── 结果 ────────");
console.log(`入库 ${result.ingestedCount} · 跳过 ${result.skippedCount} · 失败 ${result.failedCount}${result.aborted ? " · 被中止" : ""}`);
// 只报成功卡会把「花了钱没入库」那部分算漏
console.log(`实际成本    ¥${result.totalCostCny.toFixed(4)}`);
console.log(`总耗时      ${Math.round(result.totalElapsedMs / 1000)} 秒`);
console.log(
  `⚠️ 失败或中止的集会留下占位对象（native-claims/），不会自动清理也不会自动重跑，请人工核对`,
);
// 中止不是失败集，但批次没有完整结束，不能向自动化返回成功码。
process.exit(result.failedCount > 0 || result.aborted ? 1 : 0);

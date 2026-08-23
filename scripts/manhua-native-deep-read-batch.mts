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
  pickSmallestVideoFormat,
} from "../server/services/manhuaNativeDeepReadRunner.ts";
import { listIngestedNativeDeepReadEpisodes } from "../server/services/manhuaNativeDeepReadIngest.ts";
import {
  runNativeDeepReadBatch,
  type NativeDeepReadBatchEpisode,
} from "../server/services/manhuaNativeDeepReadExecution.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

config();
const execFileAsync = promisify(execFile);

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
const limit = Math.max(1, Math.floor(Number(args.get("limit")) || 999));

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

/** 解析该集的 CDN 节点副本：只拿地址，不下载 —— 模型自己去 CDN 拉流 */
async function resolveNodeUrls(sourceUrl: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "yt-dlp",
    ["-J", "--no-warnings", ...(process.env.DOUYIN_COOKIE ? ["--add-header", `Cookie:${process.env.DOUYIN_COOKIE}`] : []), sourceUrl],
    { maxBuffer: 1 << 28 },
  );
  const info = JSON.parse(stdout) as { formats?: Array<Record<string, unknown>> };
  const best = pickSmallestVideoFormat(info.formats || []);
  if (!best) throw new Error("未解析到可用的 540p 档");
  return [best.url];
}

const alreadyIngested = await listIngestedNativeDeepReadEpisodes(seriesKey);
const todo = wanted.filter((e) => !alreadyIngested.has(e.episodeIndex));

console.log("──────── 原生精读发车计划 ────────");
console.log(`合集        ${seriesKey}`);
console.log(`清单        ${listPath} · 共 ${raw.length} 集，本次取前 ${wanted.length} 集`);
console.log(`已入库      ${alreadyIngested.size} 集 [${[...alreadyIngested].sort((a, b) => a - b).join(",") || "—"}]`);
console.log(`本次要跑    ${todo.length} 集 [${todo.map((e) => e.episodeIndex).join(",") || "—"}]`);
console.log(`总时长      ${Math.round(todo.reduce((s, e) => s + (e.durationSec || 0), 0) / 60)} 分钟`);
console.log(`模式        ${isGo ? "🔴 真跑（会花钱）" : "🟢 干跑（不发任何模型请求）"}`);
console.log("──────────────────────────────");

if (!isGo) {
  console.log("干跑结束。确认无误后加 --go 发车。");
  process.exit(0);
}
if (!todo.length) {
  console.log("没有要跑的集，退出。");
  process.exit(0);
}

const episodes: NativeDeepReadBatchEpisode[] = todo.map((e) => ({
  episodeIndex: e.episodeIndex,
  sourceUrl: e.sourceUrl,
  durationSec: e.durationSec,
  laneHintZh: e.laneHintZh,
  segments: e.segments,
  resolveNodes: () => resolveNodeUrls(e.sourceUrl),
}));

const controller = new AbortController();
process.on("SIGINT", () => {
  console.log("\n收到中断，停止后续集（已入库的集保留）…");
  controller.abort();
});

const result = await runNativeDeepReadBatch({
  seriesKey,
  episodes,
  abortSignal: controller.signal,
  onProgress: (o) => {
    const mark = o.status === "ingested" ? "✅" : o.status === "skipped" ? "⏭" : "✗";
    console.log(`${mark} 第${o.episodeIndex}集 · ${o.status}${o.gcsUri ? ` · ${o.gcsUri}` : ""}${o.errorZh ? ` · ${o.errorZh}` : ""}`);
  },
});

console.log("──────── 结果 ────────");
console.log(`入库 ${result.ingestedCount} · 跳过 ${result.skippedCount} · 失败 ${result.failedCount}${result.aborted ? " · 被中止" : ""}`);
process.exit(result.failedCount > 0 ? 1 : 0);

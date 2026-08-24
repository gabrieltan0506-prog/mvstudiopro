/**
 * 原生精读**发车清单**生成器：抖音链接 → episodes.json（零模型调用、零花费）。
 *
 * 为什么需要它：`manhua-native-deep-read-batch.mts` 只吃 `--list=episodes.json`，
 * 而素材接入层（剧名解析／合集展开／付费边界／cookie 轮换）产出的东西没有命令行出口。
 * 缺的从来不是解析能力，是这一段管道。本文件不新写任何解析逻辑，只做串接。
 *
 * 用法：
 *   npx tsx scripts/manhua-native-plan.mts --url "https://www.douyin.com/..." \
 *     --limit=10 --out=downloads/manhua-native/episodes.json
 *
 * 两条纪律（都是花过学费的）：
 *   1. **读到付费集就停**：只认逐集 access==="paid_locked"，
 *      合集"含付费内容"的总标记不能冒充逐集锁定。付费集绝不写进清单。
 *   2. **合集没展开全就不出清单**：`complete === false` 说明分页没拉到底，
 *      此时集号可能整体错位（第 10 集其实是第 12 集），
 *      「列不全＝无法证明完整」。要强行出清单必须显式 --allow-partial。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { config } from "dotenv";
import {
  extractDouyinVideoIdFromUrl,
  extractDouyinMixIdFromUrl,
  type DouyinListedEpisode,
} from "../shared/manhuaLearnDouyinWebApi.js";
import {
  listDouyinMixEpisodesViaWebApi,
  fetchDouyinAwemeDetailViaWebApi,
} from "../server/services/manhuaLearnDouyinWebApi.js";
import {
  buildManhuaLearnYtdlpMetadataArgs,
  parseManhuaLearnRemoteDurationSec,
} from "../shared/manhuaLearnVideoSegments.js";
import {
  listDouyinCookieCandidatesFromEnv,
  buildNetscapeCookiesFromHeader,
  mapManhuaLearnFetchError,
} from "../shared/manhuaLearnYtdlp.js";
import {
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
  NATIVE_DEEP_READ_BATCH_HARD_CEILING,
  validateNativeDeepReadBatchPlan,
} from "../server/services/manhuaNativeDeepReadExecution.js";

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

const url = String(args.get("url") || "").trim();
if (!url) fail("缺 --url=<抖音链接>（合集页／成片页／带 modal_id 的搜索页都行）");
const limit = Number(args.get("limit") || 10);
if (!Number.isInteger(limit) || limit < 1 || limit > NATIVE_DEEP_READ_BATCH_HARD_CEILING) {
  fail(`--limit 必须是 1..${NATIVE_DEEP_READ_BATCH_HARD_CEILING} 的整数`);
}
const outPath = String(args.get("out") || "downloads/manhua-native/episodes.json").trim();
const allowPartial = args.get("allow-partial") === "1";

/** 只拿时长，不下片：yt-dlp 读元数据，免费。 */
async function probeDurationSec(pageUrl: string): Promise<number> {
  const header = listDouyinCookieCandidatesFromEnv()[0] || "";
  let cookieArgs: string[] = [];
  let tmpDir = "";
  if (header) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "manhua-plan-"));
    const jar = path.join(tmpDir, "cookies.txt");
    await fs.writeFile(jar, buildNetscapeCookiesFromHeader(header), "utf8");
    cookieArgs = ["--cookies", jar];
  }
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      buildManhuaLearnYtdlpMetadataArgs({ url: pageUrl, cookieArgs }),
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const sec = parseManhuaLearnRemoteDurationSec(JSON.parse(stdout));
    if (!(sec > 0)) throw new Error("时长为 0");
    return sec;
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 按模型单段上限均分：不让任何一段超过 1000s，否则模型看不完整。 */
function splitSegments(durationSec: number): Array<{ startSec: number; endSec: number }> {
  const total = Math.max(1, Math.round(durationSec));
  const parts = Math.max(1, Math.ceil(total / NATIVE_DEEP_READ_MAX_SEGMENT_SEC));
  const per = Math.ceil(total / parts);
  const out: Array<{ startSec: number; endSec: number }> = [];
  for (let i = 0; i < parts; i += 1) {
    const startSec = i * per;
    const endSec = Math.min(total, startSec + per);
    if (endSec > startSec) out.push({ startSec, endSec });
  }
  return out;
}

async function main() {
  // ── 1. 链接 → 合集 id（搜索页的 modal_id 由 extractDouyinVideoIdFromUrl 处理）
  let mixId = extractDouyinMixIdFromUrl(url) || "";
  let mixNameZh = "";
  if (!mixId) {
    const awemeId = extractDouyinVideoIdFromUrl(url);
    if (!awemeId) fail("这个链接里没有 modal_id / 视频 id / 合集 id，认不出是哪一部");
    console.log(`解析视频 ${awemeId} …`);
    const detail = await fetchDouyinAwemeDetailViaWebApi(awemeId);
    if (!detail?.mixId) fail("这条视频不属于任何合集（拿不到 mix_info），无法按集发车");
    mixId = detail.mixId;
    mixNameZh = detail.mixNameZh || "";
  }

  // ── 2. 合集展开
  console.log(`展开合集 ${mixId} …`);
  const listed = await listDouyinMixEpisodesViaWebApi(mixId);
  if (!listed?.episodes?.length) fail("合集展开失败或没有分集；换一个 DOUYIN_COOKIE 再试");
  mixNameZh = listed.mixNameZh || mixNameZh;

  if (!listed.complete && !allowPartial) {
    fail(
      `合集只展开了 ${listed.episodes.length} 集且未拉到底——集号可能整体错位，拒绝出清单。\n`
      + `  列不全＝无法证明完整。确认要用这份不完整清单请加 --allow-partial`,
    );
  }

  // ── 3. 读到付费集就停（只认逐集信号）
  const sorted = [...listed.episodes].sort((a, b) => a.index - b.index);
  const paidAt = sorted.findIndex((e) => e.access === "paid_locked");
  const free: DouyinListedEpisode[] = paidAt >= 0 ? sorted.slice(0, paidAt) : sorted;
  if (paidAt >= 0) {
    console.log(`⚠ 第 ${sorted[paidAt]!.index} 集起为付费集，已在此停住（免费段 ${free.length} 集）`);
  }
  if (!free.length) fail("这部剧第一集就是付费集，没有可学的免费集");
  const unknown = free.filter((e) => e.access !== "free").map((e) => e.index);
  if (unknown.length) {
    console.log(`⚠ 付费状态未知的集：${unknown.join(", ")}（接口没给逐集信号，非"已确认免费"）`);
  }

  const wanted = free.slice(0, limit);

  // ── 4. 逐集探时长（免费）
  const episodes = [];
  for (const e of wanted) {
    process.stdout.write(`  第${e.index}集 探时长…`);
    const durationSec = await probeDurationSec(e.url);
    const segments = splitSegments(durationSec);
    console.log(` ${Math.round(durationSec)}s · ${segments.length} 段`);
    episodes.push({ episodeIndex: e.index, sourceUrl: e.url, durationSec, segments });
  }

  // ── 5. 用发车脚本同一个校验器验一遍，不合格就别写文件
  const seriesKey = `douyin${mixId}`;
  const plan = validateNativeDeepReadBatchPlan(
    episodes.map((e) => ({ ...e, resolveNodes: async () => [] })),
    { maxEpisodes: limit, seriesKey },
  );

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(episodes, null, 2)}\n`, "utf8");

  console.log("──────── 发车清单已生成 ────────");
  console.log(`剧名        ${mixNameZh || "（接口未给）"}`);
  console.log(`合集标识    ${seriesKey}`);
  console.log(`本次集数    ${episodes.length}（合集免费段共 ${free.length} 集）`);
  console.log(`总时长      ${Math.round(episodes.reduce((s, e) => s + e.durationSec, 0) / 60)} 分钟`);
  console.log(`模型请求数  ${plan.totalSegments} 次  ← 成本按这个数算`);
  console.log(`清单        ${outPath}`);
  console.log("");
  console.log("下一步（仍不花钱）：");
  console.log(`  MANHUA_NATIVE_DEEP_READ=1 npx tsx scripts/manhua-native-deep-read-batch.mts \\`);
  console.log(`    --series=${seriesKey} --list=${outPath} --limit=${episodes.length} --dry-run`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));

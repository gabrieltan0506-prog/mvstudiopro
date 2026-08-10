/**
 * 漫剧节奏模板 · 单集或合集学习。
 * 每轮按剧集顺序采（短合集有几集采几集；长合集约 8–10）→ 语音+抽帧+读帧 → 立刻删本地视频；
 * 学满 4 集或合集学完即出草版提案（约 16 集更准）；不足也可先看分集学习结果。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildAdaptiveFramePlan,
  speechRegionsFromSilenceDetectLog,
} from "../../shared/manhuaTemplateLearnFramePlan.js";
import {
  applyFrameVisionToProposal,
  resolveManhuaTemplateLearnLlmProvider,
  selectFramesForVisionAnalysis,
} from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  MANHUA_LEARN_ANALYSIS_DRAFT_MIN,
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
  MANHUA_LEARN_BATCH_DEFAULT,
  MANHUA_LEARN_CHECKPOINT_SEC,
  MANHUA_LEARN_CONSECUTIVE_FAIL_STOP,
  MANHUA_LEARN_EPISODE_RETRY_MAX,
  MANHUA_LEARN_MAX_DURATION_SEC,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  isManhuaLearnListComplete,
  classifyManhuaLearnTitle,
  isManhuaLearnEpisodeComplete,
  mergeEpisodeDigestsIntoProposal,
  mergeManhuaLearnChunkIntoDigest,
  pickNextEpisodeIndexes,
  type ManhuaLearnEpisodeChunk,
  type ManhuaLearnEpisodeDigest,
  type ManhuaLearnSeriesProgress,
} from "../../shared/manhuaTemplateLearnSeries.js";
import {
  MANHUA_LEARN_STAGE,
  formatManhuaLearnEpisodeDetail,
  manhuaLearnStageLabelZh,
} from "../../shared/manhuaTemplateLearnPipeline.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../../shared/manhuaViralTemplateBank.js";
import {
  analyzeManhuaDramaAudioWithGemini,
  isGeminiAudioAvailable,
  type ManhuaDramaAudioScanResult,
} from "../gemini-audio.js";
import { analyzeManhuaTemplateFramesWithTerra } from "../manhuaTemplateFrameVision.js";
import {
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
  signGsUriV4ReadUrl,
} from "./gcs.js";
import {
  buildDouyinMixCandidateUrls,
  isDouyinHostUrl,
  isDouyinSingleVideoUrl,
  normalizeDouyinVideoUrl,
  listedSingleEpisodeFromUrl,
  mapManhuaLearnFetchError,
  MANHUA_LEARN_FETCH_ERR,
} from "../../shared/manhuaLearnYtdlp.js";
import {
  extractDouyinMixIdFromUrl,
  extractDouyinVideoIdFromUrl,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  fetchDouyinAwemeDetailViaWebApi,
  listDouyinMixEpisodesViaWebApi,
} from "./manhuaLearnDouyinWebApi.js";
import {
  assertYtdlpCookieReadyForUrl,
  execYtdlpJson,
  openYtdlpCookieSession,
  runYtdlp,
  throwMappedYtdlpFailure,
} from "./manhuaLearnYtdlpRuntime.js";

const execFileAsync = promisify(execFile);

export type ManhuaTemplateLearnInput = {
  url?: string;
  title?: string;
  mixId?: string;
  rank?: number;
  /** 本轮采几集：8–10 */
  batchSize?: number;
  onProgress?: (phase: string, detailZh: string) => void | Promise<void>;
};

export type ManhuaLearnDigestPreview = {
  episodeIndex: number;
  title: string;
  hookNoteZh: string;
  transcriptPreview: string;
  durationSec: number;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
};

export type ManhuaTemplateLearnResult = {
  seriesKey: string;
  analysisReady: boolean;
  learnedCount: number;
  analysisMin: number;
  analysisTarget: number;
  batchLearned: number;
  batchIndexes: number[];
  listedEpisodeCount: number;
  /** 网页即时展示：已学分集摘要（视频已删，只留结构化结果） */
  digestsPreview: ManhuaLearnDigestPreview[];
  /** 与飙升榜同源：类别 / 题材标签（前台中文） */
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  /** 仅 analysisReady 时有值 */
  proposal: ManhuaViralTemplateCard | null;
  proposalGcsUri: string | null;
  proposalReadUrl?: string;
  visionFilled: boolean;
  messageZh: string;
  workId: string;
};

/** 读帧 provenance 跨集聚合（attempted/success 按块累计；model 取最近一集） */
function aggregateDigestFrameVision(
  digests: ManhuaLearnEpisodeDigest[],
): NonNullable<ManhuaViralTemplateCard["provenance"]>["frameVision"] {
  const rows = digests
    .map((d) => d.frameVision)
    .filter(Boolean) as NonNullable<ManhuaLearnEpisodeDigest["frameVision"]>[];
  if (!rows.length) return undefined;
  const last = rows[rows.length - 1];
  return {
    provider: last.provider,
    model: last.model,
    attemptedChunks: rows.reduce((a, r) => a + r.attemptedChunks, 0),
    successChunks: rows.reduce((a, r) => a + r.successChunks, 0),
  };
}

function toDigestPreview(d: ManhuaLearnEpisodeDigest): ManhuaLearnDigestPreview {
  return {
    episodeIndex: d.episodeIndex,
    title: d.title,
    hookNoteZh: d.hookNoteZh,
    transcriptPreview: d.transcriptPreview.slice(0, 800),
    durationSec: d.durationSec,
    categoryLabelZh: d.categoryLabelZh,
    tagLabelsZh: d.tagLabelsZh,
  };
}

/** 供网页查询合集学习进度与分集摘要 */
export async function getManhuaSeriesLearnSnapshot(seriesKey: string): Promise<{
  progress: ManhuaLearnSeriesProgress | null;
  digestsPreview: ManhuaLearnDigestPreview[];
  /** 已整集学完的数量（digestsPreview 含未学完的检查点，勿拿其长度当完成数） */
  completedCount: number;
  analysisReady: boolean;
  proposal: ManhuaViralTemplateCard | null;
}> {
  const key = String(seriesKey || "").trim();
  if (!key) {
    return { progress: null, digestsPreview: [], completedCount: 0, analysisReady: false, proposal: null };
  }
  const progress = await loadSeriesProgress(key);
  if (progress) {
    // 存量被占位词写脏的 titleHint，读路径也洗（不等下次学习才修复面板显示）
    progress.titleHint = cleanManhuaLearnTitle(progress.titleHint) || "未命名合集";
  }
  const digestsAll = await loadAllDigests(key);
  const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
  const digestsPreview = digestsAll.map(toDigestPreview);
  const completeIndexes = digests.map((d) => d.episodeIndex);
  // 集合包含判定（审查必须修11）：只认可靠索引集合。存量 progress 无
  // listedEpisodeIndexes 时不做总数比较——历史接口抖动曾把 count 缩成 1，
  // 「learned>=count」会把伪单集判成合集学完；旧数据只走 4/16 集门槛。
  const allListedComplete = progress
    ? isManhuaLearnListComplete(progress.listedEpisodeIndexes, completeIndexes)
    : false;
  const analysisReady = canEmitManhuaLearnAnalysis(digests.length, { allListedComplete });
  let proposal: ManhuaViralTemplateCard | null = null;
  if (analysisReady && progress) {
    // 审查收紧：快照只回真实落盘的 proposed 提案（seriesKey 已带 provider 命名空间）。
    // 不再返回内存重建的启发式卡——批准端也只认落盘，杜绝「凭 env 伪造版本」整条链。
    const fromGcs = await readJsonGcs<ManhuaViralTemplateCard>(
      `manhua-template-learn/proposals/tpl_series_${key}.json`,
    );
    if (fromGcs && fromGcs.status === "proposed") {
      proposal = parseManhuaViralTemplateCard(fromGcs);
    }
    // status=approved：已入库，不再给可批准的提案（防重复批准循环）
  }
  return { progress, digestsPreview, completedCount: digests.length, analysisReady, proposal };
}

function gcsBucketHint(): string {
  return String(
    process.env.GCS_BUCKET_NAME
      || process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || "mv-studio-pro-vertex-video-temp",
  ).trim();
}

/**
 * 前端占位词不算剧名：旧版贴链接路径把「贴链接学习」当 title 传上来，
 * 会把详情接口回填的真剧名压住，且已写进存量 progress——这里统一洗掉。
 */
const MANHUA_LEARN_TITLE_PLACEHOLDERS = new Set(["未命名合集", "贴链接学习"]);

function cleanManhuaLearnTitle(raw?: string | null): string {
  const t = String(raw || "").trim();
  return MANHUA_LEARN_TITLE_PLACEHOLDERS.has(t) ? "" : t;
}

/**
 * 剥外层书名号（mix_name 常自带《》，进度行再包一层会变《《》》）。
 * 只在整体被一对《》包裹且内部不再含书名号时才剥——单侧剥会把
 * 「XXX《动态漫画》」「《XX》第二季」这类高频命名剥坏并写脏进度。
 */
function stripBookTitleMarks(raw?: string | null): string {
  const t = String(raw || "").trim();
  const m = /^《(.*)》$/.exec(t);
  return m && !m[1].includes("《") && !m[1].includes("》") ? m[1].trim() : t;
}

/**
 * A/B 隔离（审查必须修）：provider 进 seriesKey 命名空间。
 * GPT 档 key 与存量完全兼容；Claude 档独立 key = 独立 digest/progress/提案存储，
 * 两档互不复用互不覆盖（Claude 轮从头下片读帧，实验组干净），
 * 也不再需要 _claude 后缀 hack（快照/批准按 key 天然取对版本）。
 */
function seriesKeyFrom(input: {
  url: string;
  mixId?: string;
  title?: string;
  learnLlm?: "gpt" | "claude";
}): string {
  const ns = input.learnLlm === "claude" ? ":claude" : "";
  const mix = String(input.mixId || "").trim();
  if (mix) return createHash("sha1").update(`mix:${mix}${ns}`).digest("hex").slice(0, 12);
  return createHash("sha1")
    .update(`${String(input.url || input.title || "series")}${ns}`)
    .digest("hex")
    .slice(0, 12);
}

function guessLane(text: string): ManhuaViralTemplateLane {
  const t = text;
  if (/种田|边关|古言|开荒/.test(t)) return "古言种田";
  if (/系统|吞噬|进化|觉醒/.test(t)) return "系统觉醒";
  if (/电竞|游戏|操作|竞技/.test(t)) return "游戏竞技";
  if (/甜宠|恋爱|霸总/.test(t)) return "甜宠";
  if (/悬疑|权谋|宫斗/.test(t)) return "悬疑权谋";
  if (/沙雕|搞笑/.test(t)) return "搞笑沙雕";
  return "爽文逆袭";
}

async function ffprobeDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const n = Number(String(stdout).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("无法读取成片时长");
  return n;
}

async function extractAudioMp3(
  videoPath: string,
  audioPath: string,
  opts?: { startSec?: number; durationSec?: number },
): Promise<void> {
  const args: string[] = ["-y"];
  const start = Math.max(0, Number(opts?.startSec) || 0);
  const dur = Math.floor(Number(opts?.durationSec) || 0);
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k");
  if (dur > 0) args.push("-t", String(dur));
  args.push(audioPath);
  await execFileAsync("ffmpeg", args);
}

function episodeObjectName(seriesKey: string, episodeIndex: number): string {
  return `manhua-template-learn/series/${seriesKey}/episodes/ep_${String(episodeIndex).padStart(4, "0")}.json`;
}

async function silenceDetectLog(audioPath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-32dB:d=0.45",
      "-f",
      "null",
      "-",
    ]);
    return String(stderr || "");
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    return String(err.stderr || "");
  }
}

async function extractFrames(
  videoPath: string,
  timestamps: number[],
  framesDir: string,
): Promise<string[]> {
  await fs.mkdir(framesDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]!;
    const out = path.join(
      framesDir,
      `f${String(i).padStart(3, "0")}_${t.toFixed(2).replace(".", "p")}.jpg`,
    );
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      String(t),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      out,
    ]);
    paths.push(out);
  }
  return paths;
}

async function downloadVideo(url: string, workDir: string): Promise<string> {
  await fs.mkdir(workDir, { recursive: true });
  if (/douyin\.com\/search\//i.test(url)) {
    throw new Error("当前是搜索页链接，请改用成片/合集页地址后再学节奏");
  }
  assertYtdlpCookieReadyForUrl(url);
  const cookies = await openYtdlpCookieSession();
  try {
    const outTpl = path.join(workDir, "source.%(ext)s");
    const { code, stderr } = await runYtdlp([
      ...cookies.args,
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
      "--merge-output-format",
      "mp4",
      "-o",
      outTpl,
      "--no-playlist",
      "--max-filesize",
      "180M",
      "--no-warnings",
      url,
    ]);
    if (code !== 0) throwMappedYtdlpFailure(stderr);
  } finally {
    await cookies.cleanup();
  }
  const files = await fs.readdir(workDir);
  const vid = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f));
  if (!vid) throw new Error("下载完成但未找到视频文件");
  return path.join(workDir, vid);
}

type ListedEpisode = { index: number; url: string; title: string };

function parseFlatPlaylistEntries(
  data: {
    title?: string;
    entries?: Array<{
      playlist_index?: number;
      title?: string;
      url?: string;
      webpage_url?: string;
      id?: string;
    } | null>;
  },
  fallbackUrl: string,
  titleHint?: string,
): ListedEpisode[] {
  const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [];
  if (entries.length > 0) {
    const out: ListedEpisode[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const index = Math.max(1, Math.floor(Number(e.playlist_index) || i + 1));
      let epUrl = String(e.webpage_url || e.url || "").trim();
      if (!epUrl && e.id) {
        const id = String(e.id).trim();
        epUrl = /^https?:\/\//i.test(id)
          ? id
          : /^\d+$/.test(id)
            ? `https://www.douyin.com/video/${id}`
            : String(e.url || "").trim();
      }
      if (!epUrl || !/^https?:\/\//i.test(epUrl)) continue;
      out.push({
        index,
        url: epUrl,
        title: String(e.title || `第${index}集`).trim() || `第${index}集`,
      });
    }
    out.sort((a, b) => a.index - b.index);
    const seen = new Set<number>();
    return out.filter((e) => {
      if (seen.has(e.index)) return false;
      seen.add(e.index);
      return true;
    });
  }
  return listedSingleEpisodeFromUrl(
    fallbackUrl,
    String(data.title || titleHint || "第1集").trim() || "第1集",
  );
}

async function listPlaylistViaYtdlp(
  playlistUrl: string,
  titleHint?: string,
): Promise<{ listed: ListedEpisode[]; fromEntries: boolean }> {
  assertYtdlpCookieReadyForUrl(playlistUrl);
  const cookies = await openYtdlpCookieSession();
  try {
    const data = (await execYtdlpJson([
      ...cookies.args,
      "--flat-playlist",
      "-J",
      "--no-warnings",
      playlistUrl,
    ])) as {
      title?: string;
      entries?: Array<{
        playlist_index?: number;
        title?: string;
        url?: string;
        webpage_url?: string;
        id?: string;
      } | null>;
    };
    const fromEntries = Array.isArray(data.entries) && data.entries.filter(Boolean).length > 0;
    return { listed: parseFlatPlaylistEntries(data, playlistUrl, titleHint), fromEntries };
  } finally {
    await cookies.cleanup();
  }
}

type ListedEpisodesResult = {
  listed: ListedEpisode[];
  mixNameZh?: string;
  /**
   * 列表是否可靠：合集成功展开=可靠；**有 mixId 却展开失败回退单集=不可靠**
   * （接口抖动降级，不许参与「合集全学完」判定，也不许并进 progress 的可靠集合）
   */
  reliable: boolean;
};

/**
 * 有数字 mixId 时优先展开合集多集；失败再回退成片/单集 URL。
 * 展开首选趋势采集器同款抖音 web API——collection/mix 页改版后
 * yt-dlp flat-playlist 解析已死（生产日志实锤），老路只留作兜底。
 */
async function listOrderedEpisodes(
  sourceUrl: string,
  titleHint?: string,
  mixId?: string,
  single?: { titleZh?: string; episodeIndex?: number },
): Promise<ListedEpisodesResult> {
  const id = String(mixId || "").trim();
  if (/^\d{6,}$/.test(id)) {
    try {
      const viaApi = await listDouyinMixEpisodesViaWebApi(id);
      if (viaApi && viaApi.episodes.length > 0) {
        console.info(
          `[manhuaTemplateLearn] mix expand via web api: entries=${viaApi.episodes.length} mixId=${id}`,
        );
        return { listed: viaApi.episodes, mixNameZh: viaApi.mixNameZh, reliable: true };
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] mix web api expand failed:",
        id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  const mixCandidates = buildDouyinMixCandidateUrls(id);
  for (const mixUrl of mixCandidates) {
    try {
      const { listed } = await listPlaylistViaYtdlp(mixUrl, titleHint);
      if (listed.length > 1) {
        console.info(
          `[manhuaTemplateLearn] mix expand ok: mixId entries=${listed.length} via ${mixUrl.slice(0, 60)}`,
        );
        return { listed, reliable: true };
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] mix expand failed:",
        mixUrl.slice(0, 80),
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 单集成片页：不必 --flat-playlist（抖音常因此先撞登录态）。
  // modal_id 弹层链接归一化成 /video/ 标准形态——yt-dlp 只稳定认后者。
  // 详情接口给过真实集号/标题时带上，避免同剧多条单集链接都占第 1 集互相覆盖
  if (isDouyinSingleVideoUrl(sourceUrl)) {
    return {
      listed: listedSingleEpisodeFromUrl(
        normalizeDouyinVideoUrl(sourceUrl),
        single?.titleZh || titleHint,
        single?.episodeIndex,
      ),
      // 有 mixId 却走到单集回退 = 合集展开失败的降级列表，不可靠
      reliable: !/^\d{6,}$/.test(id),
    };
  }

  try {
    const { listed, fromEntries } = await listPlaylistViaYtdlp(sourceUrl, titleHint);
    // 审查必须修11：collection/mix 页没解出 entries 时 parse 会伪造「第1集」——
    // 那是降级列表，不许标可靠（否则学完 1 集就被判「合集全学完」提早出草案）
    return { listed, reliable: fromEntries };
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  }
}

async function readJsonGcs<T>(objectName: string): Promise<T | null> {
  const res = await readJsonGcsDetailed<T>(objectName);
  return res.status === "found" ? res.value : null;
}

/**
 * 三态读取（审查必须修12）：把 404 与「GCS 抖动/鉴权失败/坏 JSON」分开——
 * 只有确认不存在才允许补写，瞬时读取失败不许当「文件不存在」去覆盖落盘提案。
 */
async function readJsonGcsDetailed<T>(
  objectName: string,
): Promise<
  | { status: "found"; value: T }
  | { status: "not_found" }
  | { status: "error"; errorNote: string }
> {
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObject({
      gcsUri: `gs://${gcsBucketHint()}/${objectName}`,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: number | string })?.code;
    if (code === 404 || /No such object|does not exist|notFound|404/i.test(msg)) {
      return { status: "not_found" };
    }
    return { status: "error", errorNote: msg.slice(0, 200) };
  }
  try {
    return { status: "found", value: JSON.parse(buffer.toString("utf8")) as T };
  } catch (e) {
    // 坏 JSON = 存在但读不出：按 error 处理，不许覆盖
    return {
      status: "error",
      errorNote: `bad_json:${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
    };
  }
}

async function writeJsonGcs(objectName: string, value: unknown): Promise<string> {
  const uploaded = await uploadBufferToGcs({
    objectName,
    buffer: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
  return uploaded.gcsUri;
}

async function loadSeriesProgress(seriesKey: string): Promise<ManhuaLearnSeriesProgress | null> {
  return readJsonGcs<ManhuaLearnSeriesProgress>(
    `manhua-template-learn/series/${seriesKey}/progress.json`,
  );
}

async function loadAllDigests(seriesKey: string): Promise<ManhuaLearnEpisodeDigest[]> {
  const prefix = `manhua-template-learn/series/${seriesKey}/episodes/`;
  let names: string[] = [];
  try {
    names = await listGcsObjectNamesByPrefix({ prefix, maxResults: 80 });
  } catch {
    return [];
  }
  const digests: ManhuaLearnEpisodeDigest[] = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    const d = await readJsonGcs<ManhuaLearnEpisodeDigest>(name);
    if (d && d.episodeIndex >= 1) digests.push(d);
  }
  return digests.sort((a, b) => a.episodeIndex - b.episodeIndex);
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

async function learnOneEpisodeChunk(input: {
  ep: ListedEpisode;
  titleHint: string;
  videoPath: string;
  startSec: number;
  endSec: number;
  chunkDir: string;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
}): Promise<ManhuaLearnEpisodeChunk> {
  const chunkLen = Math.max(1, input.endSec - input.startSec);
  const rangeZh = `${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分`;

  await input.onProgress?.(
    MANHUA_LEARN_STAGE.audio,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.audio,
      input.ep.index,
      rangeZh,
    ),
  );
  const audioPath = path.join(input.chunkDir, "audio.mp3");
  await extractAudioMp3(input.videoPath, audioPath, {
    startSec: input.startSec,
    durationSec: chunkLen,
  });

  let geminiScan: ManhuaDramaAudioScanResult | null = null;
  if (isGeminiAudioAvailable()) {
    try {
      const buf = await fs.readFile(audioPath);
      if (buf.length <= 18 * 1024 * 1024) {
        geminiScan = await analyzeManhuaDramaAudioWithGemini({
          audioBase64: buf.toString("base64"),
          mimeType: "audio/mpeg",
        });
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] chunk audio failed:",
        input.ep.index,
        rangeZh,
        e instanceof Error ? e.message : e,
      );
    }
  }

  const silenceLog = await silenceDetectLog(audioPath);
  const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, chunkLen);
  const plan = buildAdaptiveFramePlan({
    durationSec: chunkLen,
    geminiSections: geminiScan?.sections,
    speechRegions,
  });
  // 分片内相对时间 → 成片绝对时间
  const timestamps = plan.timestamps
    .filter((t) => t >= 0 && t <= chunkLen)
    .slice(0, 12)
    .map((t) => t + input.startSec);

  await input.onProgress?.(
    MANHUA_LEARN_STAGE.frames,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.frames,
      input.ep.index,
      `${rangeZh} · ${timestamps.length} 张`,
    ),
  );
  const framesDir = path.join(input.chunkDir, "frames");
  const framePaths = await extractFrames(input.videoPath, timestamps, framesDir);

  const transcriptPreview = String(geminiScan?.transcriptSummary || "")
    .replace(/\s+/g, " ")
    .slice(0, 400);

  let hookNoteZh = "待补钩子";
  let beatHints = timestamps.slice(0, 8).map((t) => ({
    atSec: Math.round(t),
    conflictZh: "待视觉读帧补全",
    visualZh: `关键帧 @${t.toFixed(1)}s`,
  }));
  const sceneHints: string[] = [];

  await input.onProgress?.(
    MANHUA_LEARN_STAGE.vision,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.vision,
      input.ep.index,
      rangeZh,
    ),
  );
  // 读帧 provenance（审查必须修13）：真实尝试/成功分别记账，异常不再被吞成「像成功」
  const { MANHUA_TEMPLATE_FRAME_VISION_MODEL, MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL } = await import(
    "../../shared/manhuaTemplateLearnFrameVision.js"
  );
  const visionProvider =
    resolveManhuaTemplateLearnLlmProvider(process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER) === "claude"
      ? "anthropic"
      : "openai";
  const visionProvenance: NonNullable<ManhuaLearnEpisodeChunk["vision"]> = {
    provider: visionProvider,
    model:
      visionProvider === "anthropic"
        ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL
        : MANHUA_TEMPLATE_FRAME_VISION_MODEL,
    attempted: false,
    success: false,
  };
  try {
    const paired = framePaths.map((p, i) => ({
      path: p,
      atSec: Number(timestamps[i]) || 0,
    }));
    const selected = selectFramesForVisionAnalysis(paired, 10);
    const frames = [];
    for (const item of selected) {
      const buf = await fs.readFile(item.path);
      frames.push({
        atSec: item.atSec,
        dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
        mimeType: "image/jpeg",
      });
    }
    if (frames.length) {
      const draft = {
        id: `ep_tmp_${input.ep.index}_${Math.floor(input.startSec)}`,
        nameZh: "分集草案",
        laneZh: guessLane(`${input.titleHint} ${transcriptPreview}`) as ManhuaViralTemplateLane,
        summaryZh: "分集",
        hook3sZh: "待补",
        beatGrid: beatHints,
        scenePoolHints: [] as string[],
        castShape: { leadDesireZh: "待补", pressureZh: "待补" },
        densityHints: {
          minBodyChars: 280,
          minDialogueLines: 8,
          minLocationHits: 2,
        },
        sourceRefs: [{ url: input.ep.url, fetchedAt: new Date().toISOString().slice(0, 10) }],
        status: "proposed" as const,
      };
      visionProvenance.attempted = true;
      const vision = await analyzeManhuaTemplateFramesWithTerra({
        frames,
        titleHint: `${input.titleHint} · ${input.ep.title} · ${rangeZh}`,
        durationSec: chunkLen,
        transcriptPreview,
        climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
        fallbackLane: draft.laneZh,
      });
      visionProvenance.success = true;
      visionProvenance.model = String(vision.model || visionProvenance.model);
      const filled = applyFrameVisionToProposal(draft, vision);
      if (filled) {
        hookNoteZh = filled.hook3sZh;
        beatHints = filled.beatGrid.map((b) => ({
          ...b,
          // 读帧若返回相对秒，叠回绝对时间；已是绝对则保持
          atSec:
            Number(b.atSec) <= chunkLen + 1
              ? Math.round(Number(b.atSec) + input.startSec)
              : Math.round(Number(b.atSec) || 0),
        }));
        sceneHints.push(...(filled.scenePoolHints || []));
      }
    }
  } catch (e) {
    visionProvenance.errorNote = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    console.warn(
      "[manhuaTemplateLearn] chunk vision failed:",
      input.ep.index,
      rangeZh,
      e instanceof Error ? e.message : e,
    );
  }

  return {
    startSec: input.startSec,
    endSec: input.endSec,
    transcriptPreview,
    hookNoteZh,
    beatHints,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh).slice(0, 6),
    sceneHints: sceneHints.slice(0, 8),
    learnedAt: new Date().toISOString(),
    vision: visionProvenance,
  };
}

/**
 * 整集分段学：每满约 10 分钟合并写入分集 JSON（可续学）。
 * 视频保留到整集完成后再删。
 */
async function learnOneEpisode(input: {
  ep: ListedEpisode;
  titleHint: string;
  rootTmp: string;
  existing?: ManhuaLearnEpisodeDigest | null;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  onCheckpoint?: (digest: ManhuaLearnEpisodeDigest) => void | Promise<void>;
}): Promise<ManhuaLearnEpisodeDigest> {
  const epDir = path.join(input.rootTmp, `ep_${input.ep.index}`);
  await fs.mkdir(epDir, { recursive: true });
  try {
    if (input.existing && isManhuaLearnEpisodeComplete(input.existing)) {
      return input.existing;
    }

    await input.onProgress?.(
      MANHUA_LEARN_STAGE.download,
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.download, input.ep.index),
    );
    const videoPath = await downloadVideo(input.ep.url, epDir);
    const durationSec = await ffprobeDuration(videoPath);
    if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
      throw new Error(
        `第 ${input.ep.index} 集超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，已跳过策略外片`,
      );
    }

    const classify = classifyManhuaLearnTitle(input.titleHint, input.ep.title);
    let digest: ManhuaLearnEpisodeDigest | null = input.existing
      ? {
          ...input.existing,
          durationSec: Math.max(input.existing.durationSec || 0, durationSec),
          url: input.ep.url,
          title: input.ep.title || input.existing.title,
        }
      : null;

    let cursor = Math.max(0, Number(digest?.learnedThroughSec) || 0);
    // 若已有完整 chunks 覆盖，从末尾续
    if (Array.isArray(digest?.chunks) && digest!.chunks!.length) {
      cursor = Math.max(
        cursor,
        ...digest!.chunks!.map((c) => Number(c.endSec) || 0),
      );
    }

    const checkpoint = Math.max(60, MANHUA_LEARN_CHECKPOINT_SEC);
    const retryMax = Math.max(1, MANHUA_LEARN_EPISODE_RETRY_MAX);
    while (cursor < durationSec - 0.5) {
      const startSec = cursor;
      const endSec = Math.min(durationSec, startSec + checkpoint);
      const chunkDir = path.join(
        epDir,
        `chunk_${String(Math.floor(startSec)).padStart(5, "0")}`,
      );
      let chunk: ManhuaLearnEpisodeChunk | null = null;
      let lastErrZh = "";
      for (let attempt = 1; attempt <= retryMax; attempt++) {
        await rmrf(chunkDir);
        await fs.mkdir(chunkDir, { recursive: true });
        try {
          if (attempt > 1) {
            await input.onProgress?.(
              MANHUA_LEARN_STAGE.download,
              `第 ${input.ep.index} 集 ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} 分重试 ${attempt}/${retryMax}…`,
            );
          }
          chunk = await learnOneEpisodeChunk({
            ep: input.ep,
            titleHint: input.titleHint,
            videoPath,
            startSec,
            endSec,
            chunkDir,
            onProgress: input.onProgress,
          });
          break;
        } catch (e) {
          lastErrZh = mapManhuaLearnFetchError(e);
          await input.onProgress?.(
            MANHUA_LEARN_STAGE.failed,
            `第 ${input.ep.index} 集分片失败（${attempt}/${retryMax}）：${lastErrZh}`,
          );
        }
      }
      if (!chunk) {
        // 已写入的检查点保留在 GCS；停止本轮避免空跑
        throw new Error(
          `第 ${input.ep.index} 集 ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} 分连续 ${retryMax} 次失败：${lastErrZh || "未知错误"}。已保留此前检查点，可稍后续学。`,
        );
      }

      digest = mergeManhuaLearnChunkIntoDigest({
        prev: digest,
        chunk,
        episodeIndex: input.ep.index,
        url: input.ep.url,
        title: input.ep.title,
        durationSec,
        dramaKind: classify.dramaKind,
        categoryLabelZh: classify.categoryLabelZh,
        tagLabelsZh: classify.tagLabelsZh,
      });

      await input.onCheckpoint?.(digest);
      await input.onProgress?.(
        MANHUA_LEARN_STAGE.persist,
        `第 ${input.ep.index} 集检查点 ${Math.round(endSec / 60)}/${Math.round(durationSec / 60)} 分已写入`,
      );

      cursor = endSec;
      await rmrf(chunkDir);
    }

    if (!digest) {
      throw new Error(`第 ${input.ep.index} 集未能生成任何学习摘要`);
    }

    digest = {
      ...digest,
      complete: true,
      learnedThroughSec: Math.max(digest.learnedThroughSec || 0, durationSec),
      durationSec,
    };
    await input.onCheckpoint?.(digest);

    await fs.unlink(videoPath).catch(() => undefined);
    await input.onProgress?.(
      MANHUA_LEARN_STAGE.cleanup,
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.cleanup, input.ep.index),
    );
    return digest;
  } finally {
    await rmrf(epDir);
  }
}

export async function runManhuaTemplateLearn(
  input: ManhuaTemplateLearnInput,
): Promise<ManhuaTemplateLearnResult> {
  const title = stripBookTitleMarks(cleanManhuaLearnTitle(input.title));
  const url = String(input.url || "").trim();
  if (!url) {
    throw new Error("缺少合集或成片链接（榜单一点或粘贴链接）");
  }
  if (/douyin\.com\/search\//i.test(url)) {
    throw new Error("当前是搜索页链接，请改用合集/成片页地址");
  }

  // —— 抖音上下文解析：合集页 URL 直接提 mixId（榜单行有时只给链接不带 mixId）；
  //    单集（含 modal_id 弹层）查详情回填剧名；发现所属合集则升级为合集学习
  //    （榜单单集链接一次学一批的入口）——
  let mixId = String(input.mixId || "").trim();
  let dramaNameZh = "";
  let single: { titleZh?: string; episodeIndex?: number } | undefined;
  if (isDouyinHostUrl(url)) {
    if (!/^\d{6,}$/.test(mixId)) {
      const fromUrl = extractDouyinMixIdFromUrl(url);
      if (fromUrl) mixId = fromUrl;
    }
    const videoId = extractDouyinVideoIdFromUrl(url);
    if (videoId) {
      const detail = await fetchDouyinAwemeDetailViaWebApi(videoId).catch(() => null);
      if (detail) {
        single = { titleZh: detail.titleZh, episodeIndex: detail.episodeIndex };
        if (!/^\d{6,}$/.test(mixId) && detail.mixId && /^\d{6,}$/.test(detail.mixId)) {
          mixId = detail.mixId;
        }
        dramaNameZh = stripBookTitleMarks(detail.mixNameZh);
      }
    }
  }
  if (mixId && !String(input.mixId || "").trim()) {
    // 单集/裸链接升级为合集学习：留双 key 日志，排查「旧进度去哪了」用
    console.info(
      `[manhuaTemplateLearn] series upgraded to mix: mixKey=${seriesKeyFrom({ url, mixId, title, learnLlm: resolveManhuaTemplateLearnLlmProvider(process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER) })} urlKey=${seriesKeyFrom({ url, title })}`,
    );
  }

  const batchSize = clampManhuaLearnBatchSize(input.batchSize ?? MANHUA_LEARN_BATCH_DEFAULT);
  const learnLlm = resolveManhuaTemplateLearnLlmProvider(
    process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER,
  );
  const seriesKey = seriesKeyFrom({ url, mixId, title, learnLlm });
  const workId = `tpl_series_${seriesKey}`;
  const rootTmp = await fs.mkdtemp(path.join(os.tmpdir(), `manhua-learn-${seriesKey}-`));
  const progress = async (phase: string, detailZh: string) => {
    try {
      await input.onProgress?.(phase, detailZh);
    } catch {
      /* ignore */
    }
  };

  try {
    await progress(
      MANHUA_LEARN_STAGE.list,
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.list),
    );
    const listedRes = await listOrderedEpisodes(url, title || dramaNameZh, mixId, single);
    const listed = listedRes.listed;
    if (!listed.length) {
      throw new Error("无法解析任何可学剧集，请换合集页或成片链接重试");
    }
    if (!dramaNameZh && listedRes.mixNameZh) {
      dramaNameZh = stripBookTitleMarks(listedRes.mixNameZh);
    }
    // 剧名口径：用户手填 > 详情/合集接口回填的剧名（后者是单集路径「剧名恒空」的修复）
    const titleHint = title || dramaNameZh;
    await progress(
      MANHUA_LEARN_STAGE.list,
      `已解析 ${listed.length} 集${mixId && listed.length > 1 ? "（合集展开）" : ""}${dramaNameZh ? ` · 《${dramaNameZh}》` : ""}`,
    );

    const seriesClassify = classifyManhuaLearnTitle(titleHint || "未命名合集");
    let prog =
      (await loadSeriesProgress(seriesKey)) ||
      ({
        seriesKey,
        sourceUrl: url,
        titleHint: titleHint || "未命名合集",
        learnLlm,
        mixId: mixId || undefined,
        listedEpisodeCount: listed.length,
        listedEpisodeIndexes: listedRes.reliable
          ? listed.map((e) => e.index).sort((a, b) => a - b)
          : undefined,
        learnedEpisodeIndexes: [],
        updatedAt: new Date().toISOString(),
        dramaKind: seriesClassify.dramaKind,
        categoryLabelZh: seriesClassify.categoryLabelZh,
        tagLabelsZh: seriesClassify.tagLabelsZh,
      } satisfies ManhuaLearnSeriesProgress);

    // 与 GCS 已完成 digest 对齐，避免同链接重复下片撑爆容量/触发限流
    const existingDigests = await loadAllDigests(seriesKey);
    const completeIndexes = existingDigests
      .filter(isManhuaLearnEpisodeComplete)
      .map((d) => d.episodeIndex);
    prog = {
      ...prog,
      sourceUrl: url,
      // 旧进度若还挂着占位（未命名合集/贴链接学习），回填到手的真剧名
      titleHint: titleHint || cleanManhuaLearnTitle(prog.titleHint) || "未命名合集",
      // 只有可靠列表才并进可靠集合；降级列表不缩写也不污染历史
      listedEpisodeIndexes: listedRes.reliable
        ? Array.from(
            new Set([...(prog.listedEpisodeIndexes || []), ...listed.map((e) => e.index)]),
          ).sort((a, b) => a - b)
        : prog.listedEpisodeIndexes,
      listedEpisodeCount: listedRes.reliable
        ? Math.max(
            prog.listedEpisodeCount || 0,
            new Set([...(prog.listedEpisodeIndexes || []), ...listed.map((e) => e.index)]).size,
          )
        : prog.listedEpisodeCount || listed.length,
      mixId: mixId || prog.mixId || undefined,
      dramaKind: seriesClassify.dramaKind,
      categoryLabelZh: seriesClassify.categoryLabelZh,
      tagLabelsZh: seriesClassify.tagLabelsZh,
      learnedEpisodeIndexes: Array.from(
        new Set([...prog.learnedEpisodeIndexes, ...completeIndexes]),
      ).sort((a, b) => a - b),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonGcs(
      `manhua-template-learn/series/${seriesKey}/progress.json`,
      prog,
    );

    const listedIndexes = listed.map((e) => e.index);
    const batchIndexes = pickNextEpisodeIndexes({
      listedIndexes,
      learnedIndexes: prog.learnedEpisodeIndexes,
      batchSize,
    });
    if (!batchIndexes.length) {
      const digestsAll = await loadAllDigests(seriesKey);
      const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
      if (
        canEmitManhuaLearnAnalysis(digests.length, {
          allListedComplete: isManhuaLearnListComplete(
            prog.listedEpisodeIndexes,
            digests.map((d) => d.episodeIndex),
          ),
        })
      ) {
        // 审查必须修12：三态读取——瞬时读取失败（GCS 抖动/鉴权/坏 JSON）不许当
        // 「文件不存在」去用启发式稿覆盖已批准/已润色的落盘提案；只有确认 404 才补写。
        const proposalObjectName = `manhua-template-learn/proposals/tpl_series_${seriesKey}.json`;
        const existingRead = await readJsonGcsDetailed<ManhuaViralTemplateCard>(proposalObjectName);
        if (existingRead.status === "error") {
          throw new Error(`提案读取暂时失败，请稍后重试（未覆盖已有提案）：${existingRead.errorNote}`);
        }
        const existingParsed =
          existingRead.status === "found"
            ? parseManhuaViralTemplateCard(existingRead.value)
            : null;
        let proposal: ManhuaViralTemplateCard | null = null;
        let proposalGcsUri: string;
        let visionFilled = false;
        let noBatchMessage: string;
        if (existingParsed && existingParsed.status !== "proposed") {
          // 已批准/已拒绝：不再返回可批准的提案卡（客户端会显示死按钮、服务端必拒二次批准）
          proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
          proposal = null;
          visionFilled = existingParsed.provenance?.proposalPolish?.success === true;
          noBatchMessage =
            existingParsed.status === "approved"
              ? `该系列模板已批准进库（累计 ${digests.length} 集），无需重复批准。`
              : `该系列提案此前已被拒绝（累计 ${digests.length} 集）；如需重出提案请继续学新集。`;
        } else if (existingParsed) {
          proposal = existingParsed;
          proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
          // provenance 诚实化：落盘卡说了算，没有 provenance 的旧卡按未知处理不冒充
          visionFilled = existingParsed.provenance?.proposalPolish?.success === true;
          noBatchMessage = `已累计 ${digests.length} 集，分析提案已就绪（网页可预览后再决定是否进库）。`;
        } else {
          proposal = mergeEpisodeDigestsIntoProposal({
            seriesKey,
            titleHint: prog.titleHint,
            sourceUrl: prog.sourceUrl,
            digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET),
          });
          if (!proposal) throw new Error("已学满但合成提案失败");
          proposal = {
            ...proposal,
            provenance: {
              frameVision: aggregateDigestFrameVision(digests),
              proposalPolish: {
                provider: learnLlm === "claude" ? "anthropic" : "openai",
                model: "",
                attempted: false,
                success: false,
                degraded: true,
              },
            },
          };
          proposalGcsUri = await writeJsonGcs(
            `manhua-template-learn/proposals/${proposal.id}.json`,
            proposal,
          );
          visionFilled = false;
          noBatchMessage = `已累计 ${digests.length} 集，补建启发式草稿提案（模型润色未跑，可继续学习触发润色）。`;
        }
        let proposalReadUrl: string | undefined;
        try {
          proposalReadUrl = signGsUriV4ReadUrl(proposalGcsUri, 7 * 24 * 3600);
        } catch {
          proposalReadUrl = undefined;
        }
        return {
          seriesKey,
          analysisReady: true,
          learnedCount: digests.length,
          analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
          analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
          batchLearned: 0,
          batchIndexes: [],
          listedEpisodeCount: Math.max(prog.listedEpisodeCount || 0, listedRes.reliable ? listed.length : 0) || listed.length,
          digestsPreview: digestsAll.map(toDigestPreview),
          categoryLabelZh: prog.categoryLabelZh,
          tagLabelsZh: prog.tagLabelsZh,
          proposal,
          proposalGcsUri,
          proposalReadUrl,
          visionFilled,
          messageZh: noBatchMessage,
          workId,
        };
      }
      // 单集/短合集：可学剧集已吃完仍不足总分析门槛 → 成功回显分集结果，不抛错
      return {
        seriesKey,
        analysisReady: false,
        learnedCount: digests.length,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: 0,
        batchIndexes: [],
        listedEpisodeCount: Math.max(prog.listedEpisodeCount || 0, listedRes.reliable ? listed.length : 0) || listed.length,
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          digests.length > 0
            ? `该链接可学剧集已学完（累计 ${digests.length} 集，列表共 ${listed.length} 集）。分集结果见下方。`
            : `该链接暂无可再学剧集（列表 ${listed.length} 集）。请换合集/成片链接重试。`,
        workId,
      };
    }

    const byIndex = new Map(listed.map((e) => [e.index, e]));
    const batchLearnedIndexes: number[] = [];
    const episodeFailNotes: string[] = [];
    const consecutiveStop = Math.max(1, MANHUA_LEARN_CONSECUTIVE_FAIL_STOP);
    let consecutiveFails = 0;

    for (const idx of batchIndexes) {
      const ep = byIndex.get(idx);
      if (!ep) continue;
      const existing = await readJsonGcs<ManhuaLearnEpisodeDigest>(
        episodeObjectName(seriesKey, idx),
      );

      // 已学完：跳过，不重下（防容量/限流）
      if (existing && isManhuaLearnEpisodeComplete(existing)) {
        consecutiveFails = 0;
        if (!prog.learnedEpisodeIndexes.includes(idx)) {
          prog.learnedEpisodeIndexes = Array.from(
            new Set([...prog.learnedEpisodeIndexes, idx]),
          ).sort((a, b) => a - b);
          prog.updatedAt = new Date().toISOString();
          await writeJsonGcs(
            `manhua-template-learn/series/${seriesKey}/progress.json`,
            prog,
          );
        }
        await progress(
          MANHUA_LEARN_STAGE.persist,
          `第 ${idx} 集已学过，跳过重复学习`,
        );
        continue;
      }

      try {
        const digest = await learnOneEpisode({
          ep,
          titleHint: prog.titleHint,
          rootTmp,
          existing,
          onProgress: input.onProgress,
          onCheckpoint: async (partial) => {
            await writeJsonGcs(episodeObjectName(seriesKey, idx), partial);
          },
        });
        await writeJsonGcs(episodeObjectName(seriesKey, idx), digest);
        if (!isManhuaLearnEpisodeComplete(digest)) {
          throw new Error(`第 ${idx} 集未学完（检查点已保留，可续学）`);
        }
        consecutiveFails = 0;
        batchLearnedIndexes.push(idx);
        prog.learnedEpisodeIndexes = Array.from(
          new Set([...prog.learnedEpisodeIndexes, idx]),
        ).sort((a, b) => a - b);
        prog.updatedAt = new Date().toISOString();
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/progress.json`,
          prog,
        );
        await progress(
          MANHUA_LEARN_STAGE.persist,
          `第 ${idx} 集整集学完（约 ${Math.round((digest.durationSec || 0) / 60)} 分钟 · 本轮新增 ${batchLearnedIndexes.length}）`,
        );
      } catch (e) {
        const errZh = mapManhuaLearnFetchError(e);
        const isPerm = errZh === MANHUA_LEARN_FETCH_ERR.permissionDenied
          || /权限不足/.test(errZh);
        const note = isPerm
          ? `第 ${idx} 集权限不足，已跳过`
          : `第 ${idx} 集失败已跳过：${errZh}`;
        episodeFailNotes.push(note);
        consecutiveFails += 1;
        console.warn(
          "[manhuaTemplateLearn] skip ep → next:",
          idx,
          `consecutiveFails=${consecutiveFails}/${consecutiveStop}`,
          errZh,
        );
        await progress(MANHUA_LEARN_STAGE.failed, note);
        if (consecutiveFails >= consecutiveStop) {
          throw new Error(
            `连续 ${consecutiveStop} 集学习失败，已停止本轮（列表共 ${listed.length} 集，本轮新增 ${batchLearnedIndexes.length} 集）。最近：${note}。检查点已保留，可稍后续学。`,
          );
        }
      }
    }

    if (batchLearnedIndexes.length === 0 && batchIndexes.length > 0) {
      const last = episodeFailNotes[episodeFailNotes.length - 1] || "本轮未能成功采下新集";
      // 全部跳过但未达连续停机阈值（例如只试了 1–2 集）→ 仍给失败终态，避免伪装成功
      throw new Error(
        `${last}（本轮尝试 ${batchIndexes.length} 集均未新增完整学习）。请换合集/成片或稍后重试。`,
      );
    }

    const digestsAll = await loadAllDigests(seriesKey);
    const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
    const learnedCount = digests.length;
    const ready = canEmitManhuaLearnAnalysis(learnedCount, {
      allListedComplete: isManhuaLearnListComplete(
        prog.listedEpisodeIndexes,
        digests.map((d) => d.episodeIndex),
      ),
    });

    if (!ready) {
      const singleOrShort =
        listed.length < MANHUA_LEARN_ANALYSIS_MIN
          ? `当前链接共 ${listed.length} 集（单集也可学）。`
          : "";
      const failHint =
        episodeFailNotes.length > 0
          ? ` 另有 ${episodeFailNotes.length} 集未成功（见进度日志）。`
          : "";
      return {
        seriesKey,
        analysisReady: false,
        learnedCount,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: batchLearnedIndexes.length,
        batchIndexes: batchLearnedIndexes,
        listedEpisodeCount: Math.max(prog.listedEpisodeCount || 0, listedRes.reliable ? listed.length : 0) || listed.length,
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          `本轮学了 ${batchLearnedIndexes.length} 集（视频已删），累计 ${learnedCount} 集。${singleOrShort}${failHint}分集结果见下方；学满 ${MANHUA_LEARN_ANALYSIS_DRAFT_MIN} 集或该合集学完即出草版总分析（约 ${MANHUA_LEARN_ANALYSIS_MIN} 集更准），是否进库由你决定。`,
        workId,
      };
    }

    await progress(
      MANHUA_LEARN_STAGE.analysis,
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.analysis),
    );
    let proposal = mergeEpisodeDigestsIntoProposal({
      seriesKey,
      titleHint: prog.titleHint,
      sourceUrl: prog.sourceUrl,
      digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET),
    });
    if (!proposal) throw new Error("合成提案失败");

    // 可选：文本润色 hook（默认 Terra；env 切 Claude 做 A/B，失败则用启发式）
    let polishOk = false;
    let polishModelUsed = "";
    try {
      const { invokeLLM, extractJsonString } = await import("../_core/llm.js");
      const {
        MANHUA_TEMPLATE_FRAME_VISION_MODEL,
        MANHUA_TEMPLATE_FRAME_VISION_REASONING,
        MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL,
        resolveManhuaTemplateLearnLlmProvider,
      } = await import("../../shared/manhuaTemplateLearnFrameVision.js");
      const isClaude = learnLlm === "claude";
      const resp = await invokeLLM({
        model: "pro",
        provider: isClaude ? "anthropic" : "openai",
        modelName: isClaude ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL : MANHUA_TEMPLATE_FRAME_VISION_MODEL,
        reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
        max_tokens: 4096,
        // claude-opus-5 不收采样控件与 response_format，仅 GPT 路径带
        ...(isClaude ? {} : { temperature: 0.3, response_format: { type: "json_object" as const } }),
        messages: [
          {
            role: "system",
            content:
              "你根据多集漫剧学习摘要，输出一张中性节奏模板 JSON（nameZh,laneZh,summaryZh,hook3sZh,beatGrid,scenePoolHints,castShape）。禁止外部剧名/台词。只返回 JSON。",
          },
          {
            role: "user",
            content: JSON.stringify({
              titleHint: prog.titleHint,
              digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET).map((d) => ({
                episodeIndex: d.episodeIndex,
                hookNoteZh: d.hookNoteZh,
                transcriptPreview: d.transcriptPreview.slice(0, 800),
                climaxNotes: d.climaxNotes,
                sceneHints: d.sceneHints,
                beatHints: d.beatHints.slice(0, 6),
              })),
              seed: {
                nameZh: proposal.nameZh,
                laneZh: proposal.laneZh,
                hook3sZh: proposal.hook3sZh,
              },
            }),
          },
        ],
      });
      if (String(resp.choices?.[0]?.finish_reason || "") === "max_tokens") {
        throw new Error("polish_truncated");
      }
      const raw = String(resp.choices?.[0]?.message?.content || "");
      const parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
      const polished = parseManhuaViralTemplateCard({
        ...proposal,
        ...parsed,
        id: proposal.id,
        status: "proposed",
        sourceRefs: proposal.sourceRefs,
      });
      if (polished) {
        proposal = polished;
        polishOk = true;
        polishModelUsed = isClaude ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL : MANHUA_TEMPLATE_FRAME_VISION_MODEL;
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] polish failed, keep heuristic:",
        e instanceof Error ? e.message : e,
      );
    }

    // provenance 落盘（审查必须修13）：读帧与润色分开记，快照/no-batch/UI 同源消费；
    // A/B 结果可解释 = 卡面能证明它真的出自所选模型
    const frameVisionAgg = aggregateDigestFrameVision(digests);
    proposal = {
      ...proposal,
      provenance: {
        frameVision: frameVisionAgg,
        proposalPolish: {
          provider: learnLlm === "claude" ? "anthropic" : "openai",
          model: polishModelUsed,
          attempted: true,
          success: polishOk,
          degraded: polishOk ? undefined : true,
        },
      },
    };

    const proposalGcsUri = await writeJsonGcs(
      `manhua-template-learn/proposals/${proposal.id}.json`,
      proposal,
    );
    let proposalReadUrl: string | undefined;
    try {
      proposalReadUrl = signGsUriV4ReadUrl(proposalGcsUri, 7 * 24 * 3600);
    } catch {
      proposalReadUrl = undefined;
    }

    return {
      seriesKey,
      analysisReady: true,
      learnedCount,
      analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
      analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
      batchLearned: batchLearnedIndexes.length,
      batchIndexes: batchLearnedIndexes,
      listedEpisodeCount: Math.max(prog.listedEpisodeCount || 0, listedRes.reliable ? listed.length : 0) || listed.length,
      digestsPreview: digestsAll.map(toDigestPreview),
      categoryLabelZh: prog.categoryLabelZh,
      tagLabelsZh: prog.tagLabelsZh,
      proposal,
      proposalGcsUri,
      proposalReadUrl,
      // provenance 诚实化（审查必须修13）：「模型已填」= 读帧真实成功过 且 润色成功；
      // 全部读帧失败+润色成功不算，读帧成功+润色失败也不算
      visionFilled: polishOk && (frameVisionAgg?.successChunks ?? 0) > 0,
      messageZh: `本轮 +${batchLearnedIndexes.length} 集（视频已删），累计 ${learnedCount} 集，系列分析已可在网页预览${
        polishOk ? "" : "（本轮为启发式草稿，模型润色未成功）"
      }${(frameVisionAgg?.successChunks ?? 0) > 0 ? "" : "（视觉读帧未成功，节奏点为启发式）"}，是否进库由你决定。`,
      workId,
    };
  } finally {
    await rmrf(rootTmp);
  }
}

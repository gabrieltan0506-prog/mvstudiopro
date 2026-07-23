/**
 * 漫剧节奏模板 · 单集或合集学习。
 * 每轮按剧集顺序采（短合集有几集采几集；长合集约 8–10）→ 语音+抽帧+读帧 → 立刻删本地视频；
 * 同一系列累计 ≥16 集（目标约 20）才合成一张提案；不足也可先看分集学习结果。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildAdaptiveFramePlan,
  speechRegionsFromSilenceDetectLog,
} from "../../shared/manhuaTemplateLearnFramePlan.js";
import {
  applyFrameVisionToProposal,
  selectFramesForVisionAnalysis,
} from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
  MANHUA_LEARN_BATCH_DEFAULT,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  classifyManhuaLearnTitle,
  mergeEpisodeDigestsIntoProposal,
  pickNextEpisodeIndexes,
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

function toDigestPreview(d: ManhuaLearnEpisodeDigest): ManhuaLearnDigestPreview {
  return {
    episodeIndex: d.episodeIndex,
    title: d.title,
    hookNoteZh: d.hookNoteZh,
    transcriptPreview: d.transcriptPreview.slice(0, 160),
    durationSec: d.durationSec,
    categoryLabelZh: d.categoryLabelZh,
    tagLabelsZh: d.tagLabelsZh,
  };
}

/** 供网页查询合集学习进度与分集摘要 */
export async function getManhuaSeriesLearnSnapshot(seriesKey: string): Promise<{
  progress: ManhuaLearnSeriesProgress | null;
  digestsPreview: ManhuaLearnDigestPreview[];
  analysisReady: boolean;
  proposal: ManhuaViralTemplateCard | null;
}> {
  const key = String(seriesKey || "").trim();
  if (!key) {
    return { progress: null, digestsPreview: [], analysisReady: false, proposal: null };
  }
  const progress = await loadSeriesProgress(key);
  const digests = await loadAllDigests(key);
  const digestsPreview = digests.map(toDigestPreview);
  const analysisReady = canEmitManhuaLearnAnalysis(digests.length);
  let proposal: ManhuaViralTemplateCard | null = null;
  if (analysisReady && progress) {
    proposal = mergeEpisodeDigestsIntoProposal({
      seriesKey: key,
      titleHint: progress.titleHint,
      sourceUrl: progress.sourceUrl,
      digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET),
    });
    // 若已有 GCS 提案文件则优先读
    const fromGcs = await readJsonGcs<ManhuaViralTemplateCard>(
      `manhua-template-learn/proposals/tpl_series_${key}.json`,
    );
    if (fromGcs && fromGcs.status === "proposed") {
      proposal = parseManhuaViralTemplateCard(fromGcs) || proposal;
    }
  }
  return { progress, digestsPreview, analysisReady, proposal };
}

function ytDlpBin(): string {
  return String(process.env.YOUTUBE_DL_PATH || "yt-dlp").trim() || "yt-dlp";
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

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0 && stderr) {
        console.warn(`[manhuaTemplateLearn] ${cmd} exit=${code}:`, stderr.slice(0, 400));
      }
      resolve(code ?? 1);
    });
  });
}

function seriesKeyFrom(input: { url: string; mixId?: string; title?: string }): string {
  const mix = String(input.mixId || "").trim();
  if (mix) return createHash("sha1").update(`mix:${mix}`).digest("hex").slice(0, 12);
  return createHash("sha1")
    .update(String(input.url || input.title || "series"))
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

async function extractAudioMp3(videoPath: string, audioPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    audioPath,
  ]);
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
  const outTpl = path.join(workDir, "source.%(ext)s");
  const code = await run(ytDlpBin(), [
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    outTpl,
    "--no-playlist",
    "--max-filesize",
    "180M",
    url,
  ]);
  if (code !== 0) throw new Error("成片下载失败，请确认链接可访问或稍后重试");
  const files = await fs.readdir(workDir);
  const vid = files.find((f) => /\.(mp4|webm|mkv)$/i.test(f));
  if (!vid) throw new Error("下载完成但未找到视频文件");
  return path.join(workDir, vid);
}

type ListedEpisode = { index: number; url: string; title: string };

async function listOrderedEpisodes(sourceUrl: string): Promise<ListedEpisode[]> {
  const { stdout } = await execFileAsync(
    ytDlpBin(),
    ["--flat-playlist", "-J", "--no-warnings", sourceUrl],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const data = JSON.parse(String(stdout || "{}")) as {
    _type?: string;
    title?: string;
    webpage_url?: string;
    url?: string;
    entries?: Array<{
      playlist_index?: number;
      title?: string;
      url?: string;
      webpage_url?: string;
      id?: string;
    } | null>;
  };
  const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [];
  if (entries.length > 0) {
    const out: ListedEpisode[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const index = Math.max(1, Math.floor(Number(e.playlist_index) || i + 1));
      let epUrl = String(e.webpage_url || e.url || "").trim();
      if (!epUrl && e.id) {
        // 抖音等可能只给 id；交给 yt-dlp 原合集+索引不可靠，尽量拼 webpage
        epUrl = String(e.url || e.id).trim();
      }
      if (!epUrl || !/^https?:\/\//i.test(epUrl)) continue;
      out.push({
        index,
        url: epUrl,
        title: String(e.title || `第${index}集`).trim() || `第${index}集`,
      });
    }
    out.sort((a, b) => a.index - b.index);
    // 去重 index
    const seen = new Set<number>();
    return out.filter((e) => {
      if (seen.has(e.index)) return false;
      seen.add(e.index);
      return true;
    });
  }
  // 单集
  return [
    {
      index: 1,
      url: sourceUrl,
      title: String(data.title || "第1集").trim() || "第1集",
    },
  ];
}

async function readJsonGcs<T>(objectName: string): Promise<T | null> {
  try {
    const { buffer } = await downloadGcsObject({
      gcsUri: `gs://${gcsBucketHint()}/${objectName}`,
    });
    return JSON.parse(buffer.toString("utf8")) as T;
  } catch {
    return null;
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

async function learnOneEpisode(input: {
  ep: ListedEpisode;
  titleHint: string;
  rootTmp: string;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
}): Promise<ManhuaLearnEpisodeDigest> {
  const epDir = path.join(input.rootTmp, `ep_${input.ep.index}`);
  await fs.mkdir(epDir, { recursive: true });
  try {
    await input.onProgress?.(
      MANHUA_LEARN_STAGE.download,
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.download, input.ep.index),
    );
    const videoPath = await downloadVideo(input.ep.url, epDir);
    const durationSec = await ffprobeDuration(videoPath);
    if (durationSec > 12 * 60) {
      throw new Error(`第 ${input.ep.index} 集超过 12 分钟，已跳过策略外片`);
    }

    await input.onProgress?.(
      MANHUA_LEARN_STAGE.audio,
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.audio, input.ep.index),
    );
    const audioPath = path.join(epDir, "audio.mp3");
    await extractAudioMp3(videoPath, audioPath);

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
          "[manhuaTemplateLearn] ep audio failed:",
          input.ep.index,
          e instanceof Error ? e.message : e,
        );
      }
    }
    const silenceLog = await silenceDetectLog(audioPath);
    const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, durationSec);
    const plan = buildAdaptiveFramePlan({
      durationSec,
      geminiSections: geminiScan?.sections,
      speechRegions,
    });
    const timestamps = plan.timestamps.slice(0, 12);

    await input.onProgress?.(
      MANHUA_LEARN_STAGE.frames,
      formatManhuaLearnEpisodeDetail(
        MANHUA_LEARN_STAGE.frames,
        input.ep.index,
        `${timestamps.length} 张`,
      ),
    );
    const framesDir = path.join(epDir, "frames");
    const framePaths = await extractFrames(videoPath, timestamps, framesDir);
    // 学完立刻删视频（只保留帧/摘要进后续分析与 GCS digest）
    await fs.unlink(videoPath).catch(() => undefined);
    await input.onProgress?.(
      MANHUA_LEARN_STAGE.cleanup,
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.cleanup, input.ep.index),
    );

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
      formatManhuaLearnEpisodeDetail(MANHUA_LEARN_STAGE.vision, input.ep.index),
    );
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
          id: `ep_tmp_${input.ep.index}`,
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
        const vision = await analyzeManhuaTemplateFramesWithTerra({
          frames,
          titleHint: `${input.titleHint} · ${input.ep.title}`,
          durationSec,
          transcriptPreview,
          climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
          fallbackLane: draft.laneZh,
        });
        const filled = applyFrameVisionToProposal(draft, vision);
        if (filled) {
          hookNoteZh = filled.hook3sZh;
          beatHints = filled.beatGrid;
          sceneHints.push(...(filled.scenePoolHints || []));
        }
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] ep vision failed:",
        input.ep.index,
        e instanceof Error ? e.message : e,
      );
    }

    const classify = classifyManhuaLearnTitle(input.titleHint, input.ep.title);
    return {
      episodeIndex: input.ep.index,
      url: input.ep.url,
      title: input.ep.title,
      durationSec,
      transcriptPreview,
      hookNoteZh,
      beatHints,
      climaxNotes: plan.climaxWindows.map((w) => w.reasonZh).slice(0, 6),
      sceneHints: sceneHints.slice(0, 8),
      learnedAt: new Date().toISOString(),
      dramaKind: classify.dramaKind,
      categoryLabelZh: classify.categoryLabelZh,
      tagLabelsZh: classify.tagLabelsZh,
    };
  } finally {
    await rmrf(epDir);
  }
}

export async function runManhuaTemplateLearn(
  input: ManhuaTemplateLearnInput,
): Promise<ManhuaTemplateLearnResult> {
  const title = String(input.title || "").trim();
  const url = String(input.url || "").trim();
  if (!url) {
    throw new Error("缺少合集或成片链接（榜单一点或粘贴链接）");
  }
  if (/douyin\.com\/search\//i.test(url)) {
    throw new Error("当前是搜索页链接，请改用合集/成片页地址");
  }

  const batchSize = clampManhuaLearnBatchSize(input.batchSize ?? MANHUA_LEARN_BATCH_DEFAULT);
  const seriesKey = seriesKeyFrom({ url, mixId: input.mixId, title });
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
    const listed = await listOrderedEpisodes(url);
    if (!listed.length) {
      throw new Error("无法解析任何可学剧集，请换合集页或成片链接重试");
    }

    const seriesClassify = classifyManhuaLearnTitle(title || "未命名合集");
    let prog =
      (await loadSeriesProgress(seriesKey)) ||
      ({
        seriesKey,
        sourceUrl: url,
        titleHint: title || "未命名合集",
        mixId: String(input.mixId || "").trim() || undefined,
        listedEpisodeCount: listed.length,
        learnedEpisodeIndexes: [],
        updatedAt: new Date().toISOString(),
        dramaKind: seriesClassify.dramaKind,
        categoryLabelZh: seriesClassify.categoryLabelZh,
        tagLabelsZh: seriesClassify.tagLabelsZh,
      } satisfies ManhuaLearnSeriesProgress);

    prog = {
      ...prog,
      sourceUrl: url,
      titleHint: title || prog.titleHint,
      listedEpisodeCount: listed.length,
      mixId: String(input.mixId || prog.mixId || "").trim() || undefined,
      dramaKind: seriesClassify.dramaKind,
      categoryLabelZh: seriesClassify.categoryLabelZh,
      tagLabelsZh: seriesClassify.tagLabelsZh,
    };

    const listedIndexes = listed.map((e) => e.index);
    const batchIndexes = pickNextEpisodeIndexes({
      listedIndexes,
      learnedIndexes: prog.learnedEpisodeIndexes,
      batchSize,
    });
    if (!batchIndexes.length) {
      const digests = await loadAllDigests(seriesKey);
      if (canEmitManhuaLearnAnalysis(digests.length)) {
        const proposal = mergeEpisodeDigestsIntoProposal({
          seriesKey,
          titleHint: prog.titleHint,
          sourceUrl: prog.sourceUrl,
          digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET),
        });
        if (!proposal) throw new Error("已学满但合成提案失败");
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
          learnedCount: digests.length,
          analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
          analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
          batchLearned: 0,
          batchIndexes: [],
          listedEpisodeCount: listed.length,
          digestsPreview: digests.map(toDigestPreview),
          categoryLabelZh: prog.categoryLabelZh,
          tagLabelsZh: prog.tagLabelsZh,
          proposal,
          proposalGcsUri,
          proposalReadUrl,
          visionFilled: true,
          messageZh: `已累计 ${digests.length} 集，分析提案已就绪（网页可预览后再决定是否进库）。`,
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
        listedEpisodeCount: listed.length,
        digestsPreview: digests.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          digests.length > 0
            ? `该链接可学剧集已学完（累计 ${digests.length} 集，列表共 ${listed.length} 集）。分集结果见下方；总分析需约 ${MANHUA_LEARN_ANALYSIS_MIN} 集，可换更长合集继续学。`
            : `该链接暂无可再学剧集（列表 ${listed.length} 集）。请换合集/成片链接重试。`,
        workId,
      };
    }

    const byIndex = new Map(listed.map((e) => [e.index, e]));
    const batchLearnedIndexes: number[] = [];
    for (const idx of batchIndexes) {
      const ep = byIndex.get(idx);
      if (!ep) continue;
      try {
        const digest = await learnOneEpisode({
          ep,
          titleHint: prog.titleHint,
          rootTmp,
          onProgress: input.onProgress,
        });
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/episodes/ep_${String(idx).padStart(4, "0")}.json`,
          digest,
        );
        batchLearnedIndexes.push(idx);
        prog.learnedEpisodeIndexes = Array.from(
          new Set([...prog.learnedEpisodeIndexes, idx]),
        ).sort((a, b) => a - b);
        prog.updatedAt = new Date().toISOString();
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/progress.json`,
          prog,
        );
      } catch (e) {
        console.warn(
          "[manhuaTemplateLearn] skip ep:",
          idx,
          e instanceof Error ? e.message : e,
        );
      }
    }

    const digests = await loadAllDigests(seriesKey);
    const learnedCount = digests.length;
    const ready = canEmitManhuaLearnAnalysis(learnedCount);

    if (!ready) {
      const singleOrShort =
        listed.length < MANHUA_LEARN_ANALYSIS_MIN
          ? `当前链接共 ${listed.length} 集（单集也可学）。`
          : "";
      return {
        seriesKey,
        analysisReady: false,
        learnedCount,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: batchLearnedIndexes.length,
        batchIndexes: batchLearnedIndexes,
        listedEpisodeCount: listed.length,
        digestsPreview: digests.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          batchLearnedIndexes.length > 0
            ? `本轮学了 ${batchLearnedIndexes.length} 集（视频已删），累计 ${learnedCount}/${MANHUA_LEARN_ANALYSIS_MIN}（目标 ${MANHUA_LEARN_ANALYSIS_TARGET}）。${singleOrShort}分集结果见下方；凑满后再出总分析，是否进库由你决定。`
            : `本轮未能成功采下新集（列表 ${listed.length} 集，已累计 ${learnedCount}）。${singleOrShort}请换链接或稍后重试。`,
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

    // 可选：Terra 文本润色 hook（失败则用启发式）
    try {
      const { invokeLLM, extractJsonString } = await import("../_core/llm.js");
      const { MANHUA_TEMPLATE_FRAME_VISION_MODEL, MANHUA_TEMPLATE_FRAME_VISION_REASONING } =
        await import("../../shared/manhuaTemplateLearnFrameVision.js");
      const resp = await invokeLLM({
        model: "pro",
        provider: "openai",
        modelName: MANHUA_TEMPLATE_FRAME_VISION_MODEL,
        reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
        max_tokens: 4096,
        temperature: 0.3,
        response_format: { type: "json_object" },
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
                transcriptPreview: d.transcriptPreview.slice(0, 160),
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
      const raw = String(resp.choices?.[0]?.message?.content || "");
      const parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
      const polished = parseManhuaViralTemplateCard({
        ...proposal,
        ...parsed,
        id: proposal.id,
        status: "proposed",
        sourceRefs: proposal.sourceRefs,
      });
      if (polished) proposal = polished;
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] polish failed, keep heuristic:",
        e instanceof Error ? e.message : e,
      );
    }

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
      listedEpisodeCount: listed.length,
      digestsPreview: digests.map(toDigestPreview),
      categoryLabelZh: prog.categoryLabelZh,
      tagLabelsZh: prog.tagLabelsZh,
      proposal,
      proposalGcsUri,
      proposalReadUrl,
      visionFilled: true,
      messageZh: `本轮 +${batchLearnedIndexes.length} 集（视频已删），累计 ${learnedCount} 集，系列分析已可在网页预览，是否进库由你决定。`,
      workId,
    };
  } finally {
    await rmrf(rootTmp);
  }
}

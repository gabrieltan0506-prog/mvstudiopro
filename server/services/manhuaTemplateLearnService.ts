/**
 * 漫剧节奏模板 · 单集或合集学习。
 * 每轮按剧集顺序采（短合集有几集采几集；长合集约 8–10）→ 语音+抽帧+读帧 → 立刻删本地视频；
 * 同一系列累计 ≥16 集（目标约 20）才合成一张提案；不足也可先看分集学习结果。
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
  selectFramesForVisionAnalysis,
} from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
  MANHUA_LEARN_BATCH_DEFAULT,
  MANHUA_LEARN_CHECKPOINT_SEC,
  MANHUA_LEARN_EPISODE_RETRY_MAX,
  MANHUA_LEARN_MAX_DURATION_SEC,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
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
  isDouyinSingleVideoUrl,
  listedSingleEpisodeFromUrl,
  mapManhuaLearnFetchError,
} from "../../shared/manhuaLearnYtdlp.js";
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
  const digestsAll = await loadAllDigests(key);
  const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
  const digestsPreview = digestsAll.map(toDigestPreview);
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

function gcsBucketHint(): string {
  return String(
    process.env.GCS_BUCKET_NAME
      || process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || "mv-studio-pro-vertex-video-temp",
  ).trim();
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

async function listOrderedEpisodes(
  sourceUrl: string,
  titleHint?: string,
): Promise<ListedEpisode[]> {
  // 单集成片页：不必 --flat-playlist（抖音常因此先撞登录态）
  if (isDouyinSingleVideoUrl(sourceUrl)) {
    return listedSingleEpisodeFromUrl(sourceUrl, titleHint);
  }

  assertYtdlpCookieReadyForUrl(sourceUrl);
  const cookies = await openYtdlpCookieSession();
  try {
    const data = (await execYtdlpJson([
      ...cookies.args,
      "--flat-playlist",
      "-J",
      "--no-warnings",
      sourceUrl,
    ])) as {
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
      const seen = new Set<number>();
      return out.filter((e) => {
        if (seen.has(e.index)) return false;
        seen.add(e.index);
        return true;
      });
    }
    return listedSingleEpisodeFromUrl(
      sourceUrl,
      String(data.title || titleHint || "第1集").trim() || "第1集",
    );
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  } finally {
    await cookies.cleanup();
  }
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
      const vision = await analyzeManhuaTemplateFramesWithTerra({
        frames,
        titleHint: `${input.titleHint} · ${input.ep.title} · ${rangeZh}`,
        durationSec: chunkLen,
        transcriptPreview,
        climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
        fallbackLane: draft.laneZh,
      });
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
    const listed = await listOrderedEpisodes(url, title);
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
      const digestsAll = await loadAllDigests(seriesKey);
      const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
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
          digestsPreview: digestsAll.map(toDigestPreview),
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
        digestsPreview: digestsAll.map(toDigestPreview),
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
    const episodeFailNotes: string[] = [];
    const downloadRetryMax = Math.max(1, MANHUA_LEARN_EPISODE_RETRY_MAX);
    for (const idx of batchIndexes) {
      const ep = byIndex.get(idx);
      if (!ep) continue;
      const existing = await readJsonGcs<ManhuaLearnEpisodeDigest>(
        episodeObjectName(seriesKey, idx),
      );
      let lastErrZh = "";
      let digest: ManhuaLearnEpisodeDigest | null = null;
      let stopWithoutRetry = false;
      for (let attempt = 1; attempt <= downloadRetryMax; attempt++) {
        try {
          if (attempt > 1) {
            await progress(
              MANHUA_LEARN_STAGE.download,
              `第 ${idx} 集整集重试 ${attempt}/${downloadRetryMax}…`,
            );
          }
          digest = await learnOneEpisode({
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
          break;
        } catch (e) {
          const rawMsg = e instanceof Error ? e.message : String(e || "");
          lastErrZh = mapManhuaLearnFetchError(e);
          // 分片重试耗尽 / 策略跳过：直接停本轮（检查点已落盘）
          stopWithoutRetry =
            /连续 \d+ 次失败|超过 \d+ 分钟|策略外片|搜索页|已保留此前检查点/.test(
              `${lastErrZh}\n${rawMsg}`,
            );
          console.warn(
            "[manhuaTemplateLearn] ep fail:",
            idx,
            `attempt=${attempt}/${downloadRetryMax}`,
            lastErrZh,
          );
          await progress(
            MANHUA_LEARN_STAGE.failed,
            stopWithoutRetry
              ? `第 ${idx} 集失败：${lastErrZh}`
              : `第 ${idx} 集失败（${attempt}/${downloadRetryMax}）：${lastErrZh}`,
          );
          if (stopWithoutRetry) break;
        }
      }
      if (!digest || !isManhuaLearnEpisodeComplete(digest)) {
        const note = lastErrZh
          ? `第 ${idx} 集未学完：${lastErrZh}`
          : `第 ${idx} 集未学完`;
        episodeFailNotes.push(note);
        throw new Error(
          `${note}。已停止本轮学习（列表共 ${listed.length} 集，本轮完整学成 ${batchLearnedIndexes.length} 集）。检查点已保留，可稍后续学。`,
        );
      }
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
        `第 ${idx} 集整集学完（约 ${Math.round((digest.durationSec || 0) / 60)} 分钟 · 本轮累计 ${batchLearnedIndexes.length}）`,
      );
    }

    if (batchLearnedIndexes.length === 0 && batchIndexes.length > 0) {
      const last = episodeFailNotes[episodeFailNotes.length - 1] || "本轮未能成功采下新集";
      throw new Error(
        `${last}（尝试 ${batchIndexes.length} 集，列表共 ${listed.length} 集）。请检查成片链接、登录态或付费墙后重试。`,
      );
    }

    const digestsAll = await loadAllDigests(seriesKey);
    const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
    const learnedCount = digests.length;
    const ready = canEmitManhuaLearnAnalysis(learnedCount);

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
        listedEpisodeCount: listed.length,
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          `本轮学了 ${batchLearnedIndexes.length} 集（视频已删），累计 ${learnedCount}/${MANHUA_LEARN_ANALYSIS_MIN}（目标 ${MANHUA_LEARN_ANALYSIS_TARGET}）。${singleOrShort}${failHint}分集结果见下方；凑满后再出总分析，是否进库由你决定。`,
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
      digestsPreview: digestsAll.map(toDigestPreview),
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

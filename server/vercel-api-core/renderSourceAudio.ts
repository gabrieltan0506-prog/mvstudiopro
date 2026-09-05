import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RenderWorkflowInput } from "./renderTypes.js";
import { downloadFileToPath, parseDurationSeconds } from "./renderUtils.js";
import { buildRenderedSubtitleTimeline, manhuaRenderOverlap, normalizeManhuaSubtitleSource,
  subtitleCuesForRenderedSource } from "../../shared/manhuaRenderedSubtitle.js";
import type { ManhuaSubtitleCue } from "../../shared/manhuaEditSubtitle.js";

const execFileAsync = promisify(execFile);
const SAMPLE_RATE = 48_000;
const FRAME_RATE = 30;

type SourceProbeResult = {
  streams?: Array<{ codec_type?: string; duration?: string }>;
  format?: { duration?: string };
};

export function resolveSourceVideoFacts(result: SourceProbeResult) {
  const video = result.streams?.find(stream => stream.codec_type === "video");
  const duration = [
    Number(video?.duration),
    Number(result.format?.duration),
  ].find(value => Number.isFinite(value) && value > 0);
  if (!video || duration == null)
    throw new Error("成片素材缺少可验证的视频时长");
  return {
    duration,
    hasAudio: Boolean(
      result.streams?.some(stream => stream.codec_type === "audio")
    ),
  };
}

export function resolveSourceTrim(
  sourceDuration: number,
  trimIn?: number,
  trimOut?: number
) {
  const hasTrim = trimIn != null || trimOut != null;
  const start = hasTrim ? Number(trimIn) : 0;
  const end = hasTrim ? Number(trimOut) : sourceDuration;
  // 工作台以0.1秒保存剪点；最多容忍一个刻度的尾差，不补造视频或裁掉真实内容。
  if (
    !Number.isFinite(sourceDuration) ||
    sourceDuration <= 0 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    start >= sourceDuration ||
    end > sourceDuration + 0.1 + Number.EPSILON
  ) {
    throw new Error("裁切范围超过实际素材，请重新确认剪辑点");
  }
  return { start, duration: Math.min(end, sourceDuration) - start };
}

async function mediaTool(command: "ffmpeg" | "ffprobe", args: string[]) {
  return execFileAsync(command, args, {
    timeout: 15 * 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function downloadSourceMedia(url: string, target: string) {
  return downloadFileToPath(url, target, AbortSignal.timeout(120_000));
}

/** 以实际媒体确定时长及音轨，不能以提示词里声明的秒数截掉尾部。 */
async function inspectVideo(filePath: string) {
  const { stdout } = await mediaTool("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,duration:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  return resolveSourceVideoFacts(JSON.parse(stdout) as SourceProbeResult);
}

function nonNegative(value: number | undefined, fallback: number) {
  return value != null && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

/**
 * 漫剧专用本地合成器：原声跟随镜头一起裁切、排序和转场，静音片补等长静音。
 * 无供应商调用；已有合成任务继续负责权限、计费、上传和回执。
 */
export async function renderSourceAudioFinal(
  input: RenderWorkflowInput,
  size: { width: number; height: number },
  tmpDir: string
): Promise<string> {
  if (!input.sceneVideos.length) throw new Error("至少需要一个成片素材");
  if (
    input.voiceUrl ||
    input.sceneVideos.some(
      scene => scene.voiceUrl && scene.includeVoice !== false
    )
  ) {
    throw new Error(
      "保留原声的合成入口不接受独立配音，请在配音工序确认替换关系"
    );
  }
  const scale = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FRAME_RATE},format=yuv420p`;
  const encode = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "2",
    "-movflags",
    "+faststart",
  ];
  const normalized: Array<{ file: string; duration: number; cues: ManhuaSubtitleCue[] }> = [];
  const hasSubtitleSources = input.sceneVideos.every(scene => Boolean(normalizeManhuaSubtitleSource(scene.subtitleSource)));
  const sources = new Map<
    string,
    { file: string; duration: number; hasAudio: boolean }
  >();

  for (let i = 0; i < input.sceneVideos.length; i += 1) {
    const scene = input.sceneVideos[i]!;
    if (!String(scene.url || "").trim())
      throw new Error(`第 ${i + 1} 段缺少成片素材`);
    const file = path.join(tmpDir, `source-audio-${i}.mp4`);
    let source = sources.get(scene.url);
    if (!source) {
      const sourceFile = path.join(tmpDir, `source-audio-${i}-raw.mp4`);
      await downloadSourceMedia(scene.url, sourceFile);
      source = { file: sourceFile, ...(await inspectVideo(sourceFile)) };
      // 一条源片拆成多镜时只下载/探测一次，裁切结果仍按每个真实剪点独立生成。
      sources.set(scene.url, source);
    }
    const { start, duration } = resolveSourceTrim(
      source.duration,
      scene.trimInSec,
      scene.trimOutSec
    );
    const args = ["-y", "-v", "error", "-ss", String(start), "-i", source.file];
    if (!source.hasAudio)
      args.push("-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`);
    args.push(
      "-t",
      String(duration),
      "-map",
      "0:v:0",
      "-map",
      source.hasAudio ? "0:a:0" : "1:a:0",
      "-vf",
      scale,
      "-af",
      `aresample=${SAMPLE_RATE}:first_pts=0,apad`,
      ...encode,
      file
    );
    await mediaTool("ffmpeg", args);
    const renderedDuration = (await inspectVideo(file)).duration;
    const subtitleSource = normalizeManhuaSubtitleSource(scene.subtitleSource);
    normalized.push({ file, duration: renderedDuration, cues: subtitleSource ? subtitleCuesForRenderedSource({
      source: subtitleSource, sourceDuration: source.duration, trimStart: start,
      renderedDuration, shotIndex: scene.subtitleShotIndex,
    }) : [] });

    if (scene.stillImageUrl) {
      const still = path.join(tmpDir, `source-audio-${i}-still.jpg`);
      const stillVideo = path.join(tmpDir, `source-audio-${i}-still.mp4`);
      await downloadSourceMedia(scene.stillImageUrl, still);
      await mediaTool("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-loop",
        "1",
        "-i",
        still,
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=${SAMPLE_RATE}:cl=stereo`,
        "-t",
        String(parseDurationSeconds(scene.stillDuration, 1.5)),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        scale,
        ...encode,
        stillVideo,
      ]);
      normalized.push({
        file: stillVideo,
        duration: (await inspectVideo(stillVideo)).duration,
        cues: [],
      });
    }
  }

  const merged = path.join(tmpDir, "source-audio-merged.mp4");
  let timeline = normalized[0]!.duration;
  if (normalized.length === 1) {
    await fs.copyFile(normalized[0]!.file, merged);
  } else {
    const args = ["-y", "-v", "error", "-filter_complex_threads", "1"];
    normalized.forEach(clip => args.push("-i", clip.file));
    const filters = normalized.flatMap((clip, i) => [
      `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`,
      `[${i}:a]atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${i}]`,
    ]);
    let video = "v0";
    let audio = "a0";
    if (String(input.transition || "cut").toLowerCase() === "fade") {
      for (let i = 1; i < normalized.length; i += 1) {
        // 短镜转场不得吃掉整镜；声画使用相同重叠时长。
        const overlap = manhuaRenderOverlap(normalized[i - 1]!.duration, normalized[i]!.duration, input.transition);
        filters.push(
          `[${video}][v${i}]xfade=transition=fade:duration=${overlap}:offset=${timeline - overlap}[vx${i}]`
        );
        filters.push(
          `[${audio}][a${i}]acrossfade=d=${overlap}:c1=tri:c2=tri[ax${i}]`
        );
        video = `vx${i}`;
        audio = `ax${i}`;
        timeline += normalized[i]!.duration - overlap;
      }
    } else {
      filters.push(
        `${normalized.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${normalized.length}:v=1:a=1[vout][aout]`
      );
      video = "vout";
      audio = "aout";
      timeline = normalized.reduce((sum, clip) => sum + clip.duration, 0);
    }
    await mediaTool("ffmpeg", [
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${video}]`,
      "-map",
      `[${audio}]`,
      ...encode,
      merged,
    ]);
  }

  const finish = async (file: string) => {
    if (hasSubtitleSources && input.onSubtitleTimeline) {
      const actualDuration = (await inspectVideo(file)).duration;
      input.onSubtitleTimeline(buildRenderedSubtitleTimeline(normalized, input.transition, actualDuration));
    }
    return file;
  };
  if (!String(input.musicUrl || "").trim()) return finish(merged);
  const music = path.join(tmpDir, "source-audio-music");
  await downloadSourceMedia(input.musicUrl!, music);
  const start = nonNegative(input.musicStartSec, 0);
  const end = nonNegative(input.musicEndSec, 0);
  const musicFilters = [
    `atrim=start=${start}${end > start ? `:end=${end}` : ""}`,
    "asetpts=PTS-STARTPTS",
    `volume=${nonNegative(input.musicVolume, 0.35)}`,
  ];
  const fadeIn = nonNegative(input.musicFadeInSec, 0);
  const fadeOut = nonNegative(input.musicFadeOutSec, 0);
  if (fadeIn > 0) musicFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0)
    musicFilters.push(
      `afade=t=out:st=${Math.max(0, timeline - fadeOut)}:d=${fadeOut}`
    );
  // duration=first 以原片为准；短配乐补静音，不得通过 -shortest 截掉视频。
  const filter = `[1:a]${musicFilters.join(",")},apad[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0[aout]`;
  const final = path.join(tmpDir, "source-audio-final.mp4");
  await mediaTool("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    merged,
    "-i",
    music,
    "-filter_complex",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    final,
  ]);
  return finish(final);
}

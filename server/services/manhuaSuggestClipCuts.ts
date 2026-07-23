/**
 * 成片静音检测 → 建议细剪进出点（导戏秒轴窗优先，无大模型）。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildManhuaAssembleShotPieces,
  suggestManhuaFineCutFromSpeechRegions,
  suggestManhuaFineCutsForSegmentShots,
  type ManhuaAssembleShotPiece,
  type ManhuaSpeechRegion,
  type ManhuaShotTimeWindow,
} from "../../shared/manhuaEditAutoCut.js";
import { speechRegionsFromSilenceDetectLog } from "../../shared/manhuaTemplateLearnFramePlan.js";
import type { ManhuaFineCutByShot, ManhuaFineCutTrim } from "../../shared/manhuaEditFineCut.js";

const execFileAsync = promisify(execFile);

export type ManhuaSuggestClipCutsInput = {
  videoUrl: string;
  /** 段内镜列表 */
  shots?: Array<{ shotIndex: number; durationSec: number }>;
  /** 段成片导戏 prompt（秒轴对齐） */
  directorPrompt?: string | null;
};

export type ManhuaSuggestClipCutsResult = {
  durationSec: number;
  speechRegions: ManhuaSpeechRegion[];
  segmentTrim: ManhuaFineCutTrim;
  segmentLabelZh: string;
  fineCutByShot: ManhuaFineCutByShot;
  windows: ManhuaShotTimeWindow[];
  windowSource: "cue" | "even" | "mixed";
  shotPieces: ManhuaAssembleShotPiece[];
};

async function downloadVideoToTemp(videoUrl: string, destPath: string): Promise<void> {
  const r = await fetch(videoUrl, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+suggest-clip-cuts)" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`download_failed:${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) throw new Error("download_too_small");
  await fs.writeFile(destPath, buf);
}

async function probeDurationSec(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ],
      { timeout: 60_000 },
    );
    const d = Number(String(stdout || "").trim());
    if (Number.isFinite(d) && d > 0.5) return Math.min(600, Math.round(d * 10) / 10);
  } catch {
    /* fall through */
  }
  return 15;
}

async function silenceDetectLog(audioPath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-i", audioPath, "-af", "silencedetect=noise=-32dB:d=0.45", "-f", "null", "-"],
      { timeout: 120_000 },
    );
    return String(stderr || "");
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    return String(err.stderr || "");
  }
}

export async function suggestManhuaClipCutsFromVideo(
  input: ManhuaSuggestClipCutsInput,
): Promise<ManhuaSuggestClipCutsResult> {
  const videoUrl = String(input.videoUrl || "").trim();
  if (!/^https:\/\//i.test(videoUrl)) {
    throw new Error("video_url_must_be_https");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "manhua-autocut-"));
  const videoPath = path.join(tmpDir, "clip.mp4");
  const audioPath = path.join(tmpDir, "audio.wav");

  try {
    await downloadVideoToTemp(videoUrl, videoPath);
    const durationSec = await probeDurationSec(videoPath);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        String(Math.min(120, durationSec)),
        audioPath,
      ],
      { timeout: 120_000 },
    );
    const log = await silenceDetectLog(audioPath);
    const speechRegions = speechRegionsFromSilenceDetectLog(log, durationSec);
    const segment = suggestManhuaFineCutFromSpeechRegions(speechRegions, durationSec);
    const shots = Array.isArray(input.shots) ? input.shots : [];
    const mapped = shots.length
      ? suggestManhuaFineCutsForSegmentShots({
          speechRegions,
          videoDurationSec: durationSec,
          shots,
          directorPrompt: input.directorPrompt,
        })
      : {
          fineCutByShot: {} as ManhuaFineCutByShot,
          segmentSuggest: segment,
          windows: [] as ManhuaShotTimeWindow[],
          windowSource: "even" as const,
        };

    const shotPieces = shots.length
      ? buildManhuaAssembleShotPieces({
          videoDurationSec: durationSec,
          fineCutByShot: mapped.fineCutByShot,
          windows: mapped.windows,
          shots,
        })
      : [];

    const cueHint =
      mapped.windowSource === "cue"
        ? "·已对齐导戏秒轴"
        : mapped.windowSource === "mixed"
          ? "·部分对齐导戏"
          : "";

    return {
      durationSec,
      speechRegions,
      segmentTrim: mapped.segmentSuggest.trim,
      segmentLabelZh: `${mapped.segmentSuggest.labelZh}${cueHint}`,
      fineCutByShot: mapped.fineCutByShot,
      windows: mapped.windows,
      windowSource: mapped.windowSource,
      shotPieces,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

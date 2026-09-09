import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseDurationSeconds(value: string | number | undefined, fallback = 8) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.endsWith("s")) {
    const n = Number(raw.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolutionToSize(value: string | undefined) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "720p") return { width: 1280, height: 720 };
  if (raw === "1080p") return { width: 1920, height: 1080 };
  if (raw === "2k" || raw === "1440p") return { width: 2560, height: 1440 };
  if (raw === "4k" || raw === "2160p") return { width: 3840, height: 2160 };
  // 竖屏漫剧 / 短剧成片
  if (raw === "9:16" || raw === "portrait" || raw === "1080x1920") {
    return { width: 1080, height: 1920 };
  }
  if (raw === "720x1280") return { width: 720, height: 1280 };
  return { width: 1920, height: 1080 };
}

export async function runFfmpeg(args: string[]) {
  return execFileAsync("ffmpeg", args);
}

/** ffprobe 真实时长（秒）；探不到回 null，让调用方退回声明值而不是炸。 */
export async function probeMediaDurationSec(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath,
    ]);
    const info = JSON.parse(String(stdout || "{}")) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; duration?: string }>;
    };
    const video = info.streams?.find((st) => st.codec_type === "video");
    const d = Number(video?.duration ?? info.format?.duration);
    return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

/**
 * 合成用的每段实际时长（0910 字幕绑真实裁切）：
 * - 有裁切窗：窗口长度，但不得超过探测到的真实长度（裁到片尾以外的部分 ffmpeg 会静默缩短）；
 * - 无裁切窗：优先探测值，探不到才退回声明值。
 * 字幕时间轴、xfade 偏移、BGM 淡出起点都吃这个数，声明与实际差 0.3 s 累计四段就是字幕漂 1 s 以上。
 */
export function resolveSceneClipDurationSec(input: {
  trimInSec: unknown;
  trimOutSec: unknown;
  declaredDurationSec: number;
  probedDurationSec: number | null;
}): { clipDur: number; hasTrim: boolean; trimIn: number } {
  const trimIn = Number(input.trimInSec);
  const trimOut = Number(input.trimOutSec);
  const hasTrim = Number.isFinite(trimIn) && Number.isFinite(trimOut) && trimOut - trimIn >= 0.5;
  const probed = input.probedDurationSec;
  // 裁切起点已在真实片尾之外：-ss 会出空文件、xfade 直接炸，退回整段按探测值走
  if (hasTrim && !(probed != null && Math.max(0, trimIn) >= probed - 0.5)) {
    const start = Math.max(0, trimIn);
    const wanted = Math.round((trimOut - trimIn) * 10) / 10;
    const available = probed != null ? Math.max(0.5, probed - start) : wanted;
    return { clipDur: Math.round(Math.min(wanted, available) * 1000) / 1000, hasTrim: true, trimIn: start };
  }
  const declared = Number(input.declaredDurationSec);
  const clipDur = probed != null ? probed : declared;
  return { clipDur: Math.round(clipDur * 1000) / 1000, hasTrim: false, trimIn: 0 };
}

export async function makeTempDir(prefix = "mvsp-render-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function downloadFileToPath(url: string, outPath: string, signal?: AbortSignal) {
  const resp = await fetch(url, { headers: { "User-Agent": "mvstudiopro-render" }, signal });
  if (!resp.ok) throw new Error(`download_failed:${resp.status}:${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  return outPath;
}

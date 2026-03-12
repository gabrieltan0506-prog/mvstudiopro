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
  return { width: 1920, height: 1080 };
}

export async function runFfmpeg(args: string[]) {
  return execFileAsync("ffmpeg", args);
}

export async function makeTempDir(prefix = "mvsp-render-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function downloadFileToPath(url: string, outPath: string) {
  const resp = await fetch(url, { headers: { "User-Agent": "mvstudiopro-render" } });
  if (!resp.ok) throw new Error(`download_failed:${resp.status}:${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  return outPath;
}

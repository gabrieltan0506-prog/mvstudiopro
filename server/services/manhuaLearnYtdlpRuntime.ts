/**
 * 漫剧学节奏 · yt-dlp 运行时：解析 Cookie 参数、带 stderr 执行、错误映射。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildNetscapeCookiesFromHeader,
  hasManhuaLearnYtdlpCookieSource,
  isDouyinHostUrl,
  MANHUA_LEARN_FETCH_ERR,
  manhuaLearnYtdlpCookiesFileFromEnv,
  manhuaLearnYtdlpCookiesFromBrowserFromEnv,
  mapManhuaLearnFetchError,
  pickDouyinCookieHeaderFromEnv,
} from "../../shared/manhuaLearnYtdlp.js";

const execFileAsync = promisify(execFile);

export function ytDlpBin(): string {
  return String(process.env.YOUTUBE_DL_PATH || "yt-dlp").trim() || "yt-dlp";
}

export type YtdlpCookieSession = {
  args: string[];
  cleanup: () => Promise<void>;
  hasCookies: boolean;
};

/** 解析 --cookies / --cookies-from-browser；Header Cookie 写临时 Netscape 文件 */
export async function openYtdlpCookieSession(): Promise<YtdlpCookieSession> {
  const file = manhuaLearnYtdlpCookiesFileFromEnv();
  if (file) {
    try {
      await fs.access(file);
      return {
        args: ["--cookies", file],
        cleanup: async () => {},
        hasCookies: true,
      };
    } catch {
      console.warn("[manhuaLearnYtdlp] cookies file missing:", file.slice(0, 80));
    }
  }

  const fromBrowser = manhuaLearnYtdlpCookiesFromBrowserFromEnv();
  if (fromBrowser) {
    return {
      args: ["--cookies-from-browser", fromBrowser],
      cleanup: async () => {},
      hasCookies: true,
    };
  }

  const header = pickDouyinCookieHeaderFromEnv();
  if (header) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "manhua-learn-cookies-"));
    const cookiesPath = path.join(tmp, "douyin.cookies.txt");
    await fs.writeFile(cookiesPath, buildNetscapeCookiesFromHeader(header), "utf8");
    return {
      args: ["--cookies", cookiesPath],
      cleanup: async () => {
        try {
          await fs.rm(tmp, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      },
      hasCookies: true,
    };
  }

  return { args: [], cleanup: async () => {}, hasCookies: false };
}

export function assertYtdlpCookieReadyForUrl(url: string): void {
  if (!isDouyinHostUrl(url)) return;
  if (hasManhuaLearnYtdlpCookieSource()) return;
  throw new Error(MANHUA_LEARN_FETCH_ERR.douyinLoginRequired);
}

export async function runYtdlp(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

export async function execYtdlpJson(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(ytDlpBin(), args, {
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(String(stdout || "{}"));
  } catch (e: unknown) {
    const err = e as { stderr?: string | Buffer; message?: string };
    const stderr = String(err.stderr || err.message || e);
    throw new Error(mapManhuaLearnFetchError(stderr));
  }
}

export function throwMappedYtdlpFailure(stderr: string, fallback = MANHUA_LEARN_FETCH_ERR.downloadFailed): never {
  throw new Error(mapManhuaLearnFetchError(stderr || fallback));
}

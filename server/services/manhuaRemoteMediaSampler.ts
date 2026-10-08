import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const MEDIA_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type ManhuaRemoteMediaSource = {
  url: string;
  referer?: string;
};

function remoteInputArgs(source: ManhuaRemoteMediaSource, startSec: number): string[] {
  const isHttpSource = /^https?:\/\//i.test(source.url);
  return [
    "-ss",
    String(Math.max(0, startSec)),
    ...(isHttpSource ? ["-user_agent", MEDIA_UA] : []),
    ...(source.referer ? ["-headers", `Referer: ${source.referer}\r\n`] : []),
    "-i",
    source.url,
  ];
}

export function classifyRemoteFfmpegFailure(stderr: unknown, fallbackZh: string): string {
  const detail = String(stderr || "").toLowerCase();
  if (/failed to resolve hostname|name or service not known|temporary failure in name resolution|nodename nor servname|enotfound|eai_again/.test(detail)) {
    return "媒体域名暂时无法解析";
  }
  if (/server returned 403|http error 403|error 403/.test(detail)) {
    return "媒体节点拒绝访问";
  }
  if (/server returned 404|http error 404|error 404/.test(detail)) {
    return "媒体地址已失效";
  }
  if (/server returned 416|http error 416|error 416/.test(detail)) {
    return "媒体分段范围不可用";
  }
  if (/timed out|timeout|connection reset|connection refused/.test(detail)) {
    return "媒体读取超时或连接中断";
  }
  if (
    /channel element|non-existing pps|decode_slice_header|invalid data found|error while decoding|moov atom not found|could not find codec parameters/.test(
      detail,
    )
  ) {
    return "媒体数据体损坏或不可解码";
  }
  return fallbackZh;
}

async function runRemoteFfmpeg(
  args: string[],
  errorZh: string,
  timeoutMs = 300_000,
): Promise<void> {
  try {
    const { shouldDispatchHeavyMedia, dispatchLearnCommand } = await import("./heavyLearnMedia");
    if (args[args.length - 1] === "-" && shouldDispatchHeavyMedia()) {
      await dispatchLearnCommand("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: timeoutMs });
      return;
    }
    await execFileAsync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], {
      // 单核/双核机上的 10 分钟远程媒体解码会明显慢于本地文件。
      timeout: timeoutMs,
    });
  } catch (error) {
    // Error.message 会带完整签名 URL，不能写进日志或前台。
    const stderr = error && typeof error === "object" && "stderr" in error
      ? (error as { stderr?: unknown }).stderr
      : "";
    throw new Error(classifyRemoteFfmpegFailure(stderr, errorZh));
  }
}

/**
 * ffprobe 只能证明容器头可读；部分 CDN 响应会保留时长/轨道元数据，
 * 但 AAC 数据体已经损坏。模型调用前先真实解码 2 秒音频。
 */
export async function probeRemoteManhuaMediaDecodability(
  source: ManhuaRemoteMediaSource,
): Promise<void> {
  await runRemoteFfmpeg(
    [
      ...remoteInputArgs(source, 0),
      "-t",
      "2",
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "null",
      "-",
    ],
    "媒体数据体损坏或不可解码",
    25_000,
  );
}

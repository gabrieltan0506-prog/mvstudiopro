import { create } from 'youtube-dl-exec';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// 优先使用系统级 yt-dlp（Docker 部署）；本地开发回退到 npm 包内置二进制
const YTDLP_BIN = process.env.YOUTUBE_DL_PATH || 'yt-dlp';
const youtubedl = create(YTDLP_BIN);

export async function parseVideoUrl(url: string) {
  try {
    return await runParse(url);
  } catch (err: unknown) {
    console.log('[videoParser] 解析失败，尝试自动更新 yt-dlp...');
    try {
      await execAsync('npm update youtube-dl-exec', {
        cwd: PROJECT_ROOT,
        timeout: 60000,
      });
      console.log('[videoParser] yt-dlp 已更新，重试解析...');
      return await runParse(url);
    } catch {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `解析失败，引擎更新后仍无法提取（${msg.slice(0, 120)}）。请检查 URL 有效性或稍后重试。`,
      );
    }
  }
}

async function runParse(url: string) {
  // 检测平台，YouTube 需要用 iOS/Android 客户端绕过机器人验证
  const isYoutube = /youtube\.com|youtu\.be/i.test(url);
  const isBilibili = /bilibili\.com|b23\.tv/i.test(url);

  const extraArgs: Record<string, unknown> = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    addHeader: [
      'referer:https://www.google.com/',
      'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ],
  };

  if (isYoutube) {
    // 伪装为 iOS 客户端，绕过 YouTube 机器人检测（无需登录 cookies）
    extraArgs['extractor-args'] = 'youtube:player_client=ios,web';
    // 选取最佳画质但不超过 1080p，避免合并流失败
    extraArgs['format'] = 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best';
  }

  if (isBilibili) {
    extraArgs['addHeader'] = [
      'referer:https://www.bilibili.com/',
      'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    ];
  }

  const output = await (youtubedl as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>)(url, extraArgs);

  const formats = (output.formats as Array<Record<string, unknown>> | undefined) ?? [];
  const requestedDownloads = output.requested_downloads as Array<Record<string, unknown>> | undefined;

  // 优先取 requested_downloads（yt-dlp 已选择的最终格式）
  const videoUrl =
    (requestedDownloads?.[0]?.url as string | undefined) ||
    (output.url as string | undefined) ||
    // mp4 且含视频流
    (formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4')?.url as string | undefined) ||
    // 任意含视频流
    (formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none')?.url as string | undefined) ||
    // 最高清晰度（可能是无声视频流，作为兜底）
    (formats[formats.length - 1]?.url as string | undefined);

  if (!videoUrl) {
    throw new Error('无法提取视频直链，该平台可能有强力反爬，请更新引擎');
  }

  const thumbnails = output.thumbnails as Array<Record<string, unknown>> | undefined;

  return {
    title: String(output.title ?? '未命名素材'),
    downloadUrl: String(videoUrl),
    coverUrl: String(
      (output.thumbnail as string | undefined) ||
        thumbnails?.[0]?.url ||
        '',
    ),
    platform: String(
      (output.extractor_key as string | undefined) ||
        (output.extractor as string | undefined) ||
        'unknown',
    ),
    duration: Number(output.duration ?? 0),
    uploader: String(
      (output.uploader as string | undefined) ||
        (output.channel as string | undefined) ||
        '',
    ),
    description: String(
      ((output.description as string | undefined) ?? '').slice(0, 200),
    ),
  };
}

export async function checkYtdlpHealth(): Promise<{
  ok: boolean;
  version: string;
  message: string;
}> {
  try {
    const result = await (youtubedl as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>)(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
      },
    );
    const version =
      ((result?._version as Record<string, unknown> | undefined)?.version as string | undefined) ??
      'unknown';
    return {
      ok: !!result?.title,
      version,
      message: result?.title ? '引擎正常' : '引擎可能异常',
    };
  } catch (err: unknown) {
    return {
      ok: false,
      version: 'unknown',
      message: err instanceof Error ? err.message : '引擎不可用',
    };
  }
}

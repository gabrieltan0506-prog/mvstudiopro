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
  const output = await (youtubedl as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>)(url, {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    addHeader: [
      'referer:https://www.google.com/',
      'user-agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ],
  });

  const formats = (output.formats as Array<Record<string, unknown>> | undefined) ?? [];
  const videoUrl =
    (output.url as string | undefined) ||
    ((output.requested_downloads as Array<Record<string, unknown>> | undefined)?.[0]?.url as string | undefined) ||
    (formats.find((f) => f.vcodec !== 'none' && f.ext === 'mp4')?.url as string | undefined) ||
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

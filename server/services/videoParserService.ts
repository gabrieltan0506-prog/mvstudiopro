import { create } from 'youtube-dl-exec';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 系统级 yt-dlp（Docker），本地回退 npm 包内置二进制
const YTDLP_BIN = process.env.YOUTUBE_DL_PATH || 'yt-dlp';
const youtubedl = create(YTDLP_BIN);

interface ParsedVideo {
  title: string;
  downloadUrl: string;
  coverUrl: string;
  platform: string;
  duration: number;
  uploader: string;
  description: string;
}

// ── 通用平台：yt-dlp 解析（B 站、抖音、快手、小红书等） ──────────────────────
async function runParseDirect(url: string) {
  const isBilibili = /bilibili\.com|b23\.tv/i.test(url);

  const extraArgs: Record<string, unknown> = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    addHeader: isBilibili
      ? [
          'referer:https://www.bilibili.com/',
          'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        ]
      : [
          'referer:https://www.google.com/',
          'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        ],
  };

  const output = await (
    youtubedl as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>
  )(url, extraArgs);

  const formats = (output.formats as Array<Record<string, unknown>> | undefined) ?? [];
  const requestedDownloads = output.requested_downloads as
    | Array<Record<string, unknown>>
    | undefined;

  const videoUrl =
    (requestedDownloads?.[0]?.url as string | undefined) ||
    (output.url as string | undefined) ||
    (formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4')
      ?.url as string | undefined) ||
    (formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none')?.url as string | undefined) ||
    (formats[formats.length - 1]?.url as string | undefined);

  if (!videoUrl) throw new Error('无法提取视频直链，该平台可能有强力反爬，请更新引擎');

  const thumbnails = output.thumbnails as Array<Record<string, unknown>> | undefined;
  return {
    title: String(output.title ?? '未命名素材'),
    downloadUrl: String(videoUrl),
    coverUrl: String((output.thumbnail as string | undefined) || thumbnails?.[0]?.url || ''),
    platform: String(
      (output.extractor_key as string | undefined) ||
        (output.extractor as string | undefined) ||
        'unknown',
    ),
    duration: Number(output.duration ?? 0),
    uploader: String(
      (output.uploader as string | undefined) || (output.channel as string | undefined) || '',
    ),
    description: String(((output.description as string | undefined) ?? '').slice(0, 200)),
  };
}

// ── 对外接口 ──────────────────────────────────────────────────────────────────
export async function parseVideoUrl(url: string): Promise<ParsedVideo> {
  // 数据中心 IP 已被反爬完全封锁（cookie 也无法绕过），不走该平台路径
  if (/youtube\.com|youtu\.be/i.test(url)) {
    throw new Error('该链接所属平台暂不支持，请改用 B 站 / 抖音 / 快手 / 小红书 链接。');
  }

  try {
    return await runParseDirect(url);
  } catch (err: unknown) {
    console.log('[videoParser] yt-dlp 解析失败，尝试更新后重试...');
    try {
      await execAsync('pip3 install --break-system-packages --upgrade yt-dlp', { timeout: 60000 });
      return await runParseDirect(url);
    } catch {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`解析失败（${msg.slice(0, 120)}）。请检查 URL 有效性或稍后重试。`);
    }
  }
}

export async function checkYtdlpHealth(): Promise<{
  ok: boolean;
  version: string;
  message: string;
}> {
  // 用 yt-dlp --version 实测引擎可用性（不依赖任何外网调用，避免误诊）
  try {
    const { stdout } = await execAsync(`${YTDLP_BIN} --version`, { timeout: 5000 });
    const version = stdout.trim();
    return {
      ok: !!version,
      version: version || 'unknown',
      message: version ? 'yt-dlp 引擎可用' : '引擎未返回版本号',
    };
  } catch (err: unknown) {
    return {
      ok: false,
      version: 'unknown',
      message: err instanceof Error ? err.message : '引擎不可用',
    };
  }
}

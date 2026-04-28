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

// 优先使用系统级 yt-dlp（Docker）；本地回退到 npm 包内置二进制
const YTDLP_BIN = process.env.YOUTUBE_DL_PATH || 'yt-dlp';
const youtubedl = create(YTDLP_BIN);

// ── YouTube 专用：通过 Invidious 公共 API 绕过机器人检测 ──────────────────────
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.io.lol',
  'https://yewtu.be',
  'https://vid.puffyan.us',
  'https://invidious.nerdvpn.de',
];

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function parseYoutubeViaInvidious(videoId: string) {
  const fields = 'title,author,lengthSeconds,videoThumbnails,formatStreams,adaptiveFormats,description';

  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const resp = await fetch(
        `${instance}/api/v1/videos/${videoId}?fields=${fields}`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
      );
      if (!resp.ok) continue;

      const data = await resp.json() as Record<string, any>;

      // formatStreams = 合并流（含音视频），优先选 mp4
      const streamFormats: any[] = data.formatStreams ?? [];
      const adaptiveFormats: any[] = data.adaptiveFormats ?? [];

      const bestStream =
        streamFormats.find((f) => f.container === 'mp4') ||
        streamFormats[0] ||
        adaptiveFormats.find((f) => String(f.type).includes('video/mp4') && String(f.type).includes('avc1')) ||
        adaptiveFormats.find((f) => String(f.type).includes('video/')) ||
        null;

      if (!bestStream?.url) continue;

      const thumbnail: string =
        (data.videoThumbnails as any[])?.[0]?.url ||
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

      return {
        title: String(data.title ?? '未命名'),
        downloadUrl: String(bestStream.url),
        coverUrl: thumbnail,
        platform: 'YouTube',
        duration: Number(data.lengthSeconds ?? 0),
        uploader: String(data.author ?? ''),
        description: String((data.description ?? '').slice(0, 200)),
      };
    } catch (e) {
      console.warn(`[videoParser] Invidious ${instance} 失败:`, e instanceof Error ? e.message : e);
      continue;
    }
  }
  throw new Error('YouTube 所有解析通道暂时不可用，请稍后重试（服务器 IP 受限）');
}

// ── 通用平台：yt-dlp 解析 ─────────────────────────────────────────────────────
async function runParseDirect(url: string) {
  const isBilibili = /bilibili\.com|b23\.tv/i.test(url);

  const extraArgs: Record<string, unknown> = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    addHeader: isBilibili
      ? ['referer:https://www.bilibili.com/', 'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15']
      : ['referer:https://www.google.com/', 'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'],
  };

  const output = await (youtubedl as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>)(url, extraArgs);

  const formats = (output.formats as Array<Record<string, unknown>> | undefined) ?? [];
  const requestedDownloads = output.requested_downloads as Array<Record<string, unknown>> | undefined;

  const videoUrl =
    (requestedDownloads?.[0]?.url as string | undefined) ||
    (output.url as string | undefined) ||
    (formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4')?.url as string | undefined) ||
    (formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none')?.url as string | undefined) ||
    (formats[formats.length - 1]?.url as string | undefined);

  if (!videoUrl) throw new Error('无法提取视频直链，该平台可能有强力反爬，请更新引擎');

  const thumbnails = output.thumbnails as Array<Record<string, unknown>> | undefined;
  return {
    title: String(output.title ?? '未命名素材'),
    downloadUrl: String(videoUrl),
    coverUrl: String((output.thumbnail as string | undefined) || thumbnails?.[0]?.url || ''),
    platform: String((output.extractor_key as string | undefined) || (output.extractor as string | undefined) || 'unknown'),
    duration: Number(output.duration ?? 0),
    uploader: String((output.uploader as string | undefined) || (output.channel as string | undefined) || ''),
    description: String(((output.description as string | undefined) ?? '').slice(0, 200)),
  };
}

// ── 对外接口 ──────────────────────────────────────────────────────────────────
export async function parseVideoUrl(url: string) {
  const isYoutube = /youtube\.com|youtu\.be/i.test(url);

  if (isYoutube) {
    // YouTube 专用通道：Invidious API（无需 cookies，无机器人验证）
    const videoId = extractYoutubeId(url);
    if (!videoId) throw new Error('无法解析 YouTube 视频 ID，请检查链接格式');
    return await parseYoutubeViaInvidious(videoId);
  }

  // 其他平台走 yt-dlp
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

export async function checkYtdlpHealth(): Promise<{ ok: boolean; version: string; message: string }> {
  try {
    // 用 Invidious 测试 YouTube 通道
    const testResult = await parseYoutubeViaInvidious('dQw4w9WgXcQ');
    return { ok: !!testResult.title, version: 'Invidious', message: testResult.title ? 'YouTube通道正常' : '通道异常' };
  } catch (err: unknown) {
    return { ok: false, version: 'unknown', message: err instanceof Error ? err.message : '引擎不可用' };
  }
}

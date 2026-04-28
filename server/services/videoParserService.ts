import { create } from 'youtube-dl-exec';
import { Innertube, Platform } from 'youtubei.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

// ── 注入 JS 解释器，让 youtubei.js 能解密 YouTube 加密的视频 URL（cipher / n-token）
// YouTube 对部分视频（音乐 MV、版权视频）的 streaming URL 用 obfuscated JS 加密签名，
// 必须执行 player.js 解密。Node.js 默认无 evaluator，需要手动注入。
// 用 vm.runInNewContext 沙箱（比 new Function 安全，不污染全局，限时 5s）。
Platform.shim.eval = async (
  data: { output: string },
  env: Record<string, unknown>,
): Promise<unknown> => {
  const props: string[] = [];
  if (typeof env.n === 'string') props.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (typeof env.sig === 'string') props.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  const code = `(function() { ${data.output}\nreturn { ${props.join(', ')} } })()`;
  return vm.runInNewContext(code, {}, { timeout: 5000 });
};

const execAsync = promisify(exec);

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// 系统级 yt-dlp（Docker），本地回退 npm 包内置二进制 —— 仅作其他平台 + 兜底
const YTDLP_BIN = process.env.YOUTUBE_DL_PATH || 'yt-dlp';
const youtubedl = create(YTDLP_BIN);

// ── YouTube 解析：youtubei.js（INNERTUBE 直连，零 cookie，多 client 兜底） ────
//
// 2026 年 4 月真实情况：
// - 公共 Invidious 实例 5/5 全死（403/502/401）
// - cobalt.tools API 加 Turnstile + API key 不允许第三方调用
// - yt-dlp 在数据中心 IP 上多数 player_client 被 YouTube 卡机器人验证
//
// 唯一无 cookie 还能跑的方案：直接调 YouTube INNERTUBE 内部 API。
// youtubei.js v17 把这套 API 封装得最完整，多 client 失败可串行重试。

type YtClient = 'IOS' | 'ANDROID' | 'TV' | 'WEB_EMBEDDED' | 'MWEB' | 'WEB';

const YT_CLIENT_ORDER: YtClient[] = ['IOS', 'ANDROID', 'TV', 'WEB_EMBEDDED', 'MWEB', 'WEB'];

// Innertube 实例创建有 ~1.5s 开销，全局复用
let innertubePromise: Promise<Innertube> | null = null;
function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
    }).catch((err) => {
      // 创建失败下次再试
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

interface ParsedVideo {
  title: string;
  downloadUrl: string;
  coverUrl: string;
  platform: string;
  duration: number;
  uploader: string;
  description: string;
}

// 从 youtubei.js 的 Format 对象拿到真实 URL（必要时调 decipher 解密签名）
async function resolveFormatUrl(fmt: any, player: unknown): Promise<string | undefined> {
  if (typeof fmt?.url === 'string' && fmt.url.length > 0) return fmt.url;
  if (typeof fmt?.decipher === 'function') {
    try {
      const u = await fmt.decipher(player);
      return typeof u === 'string' && u.length > 0 ? u : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function parseYoutubeViaInnertube(videoId: string): Promise<ParsedVideo> {
  const yt = await getInnertube();
  const errors: string[] = [];

  for (const client of YT_CLIENT_ORDER) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const basic = info.basic_info;
      const streaming = info.streaming_data;

      if (!streaming) {
        errors.push(`${client}: streaming_data 为空`);
        continue;
      }

      let directUrl: string | undefined;
      let qualityLabel: string | undefined;

      // 候选优先级（按可用性 + 用户体验）：
      //   1) 合并流 formats[]（含音视频，画质中等但下载即用）
      //   2) adaptive_formats 中的 mp4 视频流（最高画质，但需客户端再合并音轨）
      // 关键：必须调 decipher 解密签名，YouTube 反爬把真 url 用 obfuscated JS 签名加密
      const formats = streaming.formats || [];
      const adaptive = streaming.adaptive_formats || [];
      const candidates: any[] = [
        ...formats,
        ...adaptive.filter((f: any) => f.mime_type?.includes('video/mp4') && (f.has_video ?? true)),
      ];

      for (const fmt of candidates) {
        const u = await resolveFormatUrl(fmt, yt.session.player);
        if (u) {
          directUrl = u;
          qualityLabel = fmt.quality_label || fmt.quality;
          break;
        }
      }

      if (!directUrl) {
        errors.push(`${client}: 无可用直链（cipher 解密失败 or 所有 format 均无 url）`);
        continue;
      }

      const thumbnails = basic?.thumbnail || [];
      const cover =
        thumbnails[thumbnails.length - 1]?.url ||
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

      console.log(
        `[videoParser] ✓ Innertube[${client}] 解析成功 ${videoId}（${qualityLabel || '?'}）`,
      );

      return {
        title: String(basic?.title || '未命名'),
        downloadUrl: directUrl,
        coverUrl: cover,
        platform: 'YouTube',
        duration: Number(basic?.duration ?? 0),
        uploader: String(basic?.author || basic?.channel?.name || ''),
        description: String((basic?.short_description || '').slice(0, 200)),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${client}: ${msg.slice(0, 60)}`);
      console.warn(`[videoParser] Innertube[${client}] 失败:`, msg.slice(0, 100));
      continue;
    }
  }

  throw new Error(
    `YouTube 解析失败（所有 ${YT_CLIENT_ORDER.length} 个客户端均不可用）。可能原因：服务器 IP 被 YouTube 临时限流或视频已下架。详情：${errors.slice(0, 3).join(' | ')}`,
  );
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

// ── 兜底：yt-dlp 解析 YouTube（多 player_client + missing_pot 兼容）──────────
async function parseYoutubeViaYtdlp(url: string): Promise<ParsedVideo> {
  const extraArgs: Record<string, unknown> = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    extractorArgs: 'youtube:player_client=ios,android,mweb,web_embedded;formats=missing_pot',
    addHeader: [
      'user-agent:com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
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

  if (!videoUrl) throw new Error('yt-dlp 兜底也无法提取直链');

  const thumbnails = output.thumbnails as Array<Record<string, unknown>> | undefined;
  return {
    title: String(output.title ?? '未命名'),
    downloadUrl: String(videoUrl),
    coverUrl: String((output.thumbnail as string | undefined) || thumbnails?.[0]?.url || ''),
    platform: 'YouTube',
    duration: Number(output.duration ?? 0),
    uploader: String(
      (output.uploader as string | undefined) || (output.channel as string | undefined) || '',
    ),
    description: String(((output.description as string | undefined) ?? '').slice(0, 200)),
  };
}

// ── 对外接口 ──────────────────────────────────────────────────────────────────
export async function parseVideoUrl(url: string): Promise<ParsedVideo> {
  const isYoutube = /youtube\.com|youtu\.be/i.test(url);

  if (isYoutube) {
    const videoId = extractYoutubeId(url);
    if (!videoId) throw new Error('无法解析 YouTube 视频 ID，请检查链接格式');

    // 主通道：youtubei.js (INNERTUBE 直连，无 cookie)
    try {
      return await parseYoutubeViaInnertube(videoId);
    } catch (innertubeErr) {
      const msg = innertubeErr instanceof Error ? innertubeErr.message : String(innertubeErr);
      console.log(`[videoParser] Innertube 全军覆没，回退 yt-dlp：${msg.slice(0, 120)}`);

      // 兜底通道：yt-dlp 多 player_client
      try {
        return await parseYoutubeViaYtdlp(url);
      } catch (ytdlpErr) {
        const ytdlpMsg = ytdlpErr instanceof Error ? ytdlpErr.message : String(ytdlpErr);

        // 最后再尝试更新 yt-dlp 一次（仅当看起来是版本问题）
        if (/sign in|bot|update|extractor/i.test(ytdlpMsg)) {
          try {
            console.log('[videoParser] 尝试热更新 yt-dlp...');
            await execAsync('pip3 install --break-system-packages --upgrade yt-dlp', {
              timeout: 60000,
            });
            return await parseYoutubeViaYtdlp(url);
          } catch {}
        }

        throw new Error(
          `YouTube 解析失败：${msg.slice(0, 100)}。建议稍后重试，或换其他平台链接（B 站 / 抖音 / 快手 / 小红书均支持）。`,
        );
      }
    }
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

export async function checkYtdlpHealth(): Promise<{
  ok: boolean;
  version: string;
  message: string;
}> {
  // 用 youtubei.js 测试 YouTube 主通道（Rick Astley 那条永远在线）
  try {
    const res = await parseYoutubeViaInnertube('dQw4w9WgXcQ');
    return {
      ok: !!res.title,
      version: 'youtubei.js v17',
      message: res.title ? 'YouTube INNERTUBE 通道正常' : '通道异常',
    };
  } catch (err: unknown) {
    return {
      ok: false,
      version: 'youtubei.js v17',
      message: err instanceof Error ? err.message : '引擎不可用',
    };
  }
}

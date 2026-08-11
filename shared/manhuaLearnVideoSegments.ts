/**
 * 漫剧学节奏 · 长视频分段下载纯规则。
 *
 * 生产服务只把当前约 10 分钟窗口交给 yt-dlp，不先落完整长片；
 * 每段处理并写入检查点后立即删除，失败重跑也只重下当前段。
 */

export const MANHUA_LEARN_SEGMENT_MAX_BYTES = 800 * 1024 * 1024;
export const MANHUA_LEARN_SEGMENT_MAX_HEIGHT = 720;

/** 手动导入视频只能引用当前登录用户在配置桶中的直传对象。 */
export function isOwnedManhuaLearnImportGcsUri(input: {
  gcsUri: string;
  bucket: string;
  userId: string | number;
}): boolean {
  const gcsUri = String(input.gcsUri || "").trim();
  const bucket = String(input.bucket || "").trim();
  const userId = String(input.userId || "").trim();
  if (!bucket || !/^\d+$/.test(userId)) return false;
  return gcsUri.startsWith(`gs://${bucket}/uploads/u${userId}/`);
}

export type ManhuaLearnVideoSegment = {
  startSec: number;
  endSec: number;
};

function finitePositive(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** yt-dlp --dump-single-json 的 duration（秒）解析；兼容少数 duration_ms 载荷。 */
export function parseManhuaLearnRemoteDurationSec(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const row = payload as Record<string, unknown>;
  const seconds = finitePositive(row.duration ?? row.duration_seconds);
  if (seconds > 0) return seconds;
  const milliseconds = finitePositive(row.duration_ms);
  return milliseconds > 0 ? milliseconds / 1000 : 0;
}

/** 从断点开始取下一段；不足一段时自然收尾。 */
export function nextManhuaLearnVideoSegment(input: {
  cursorSec: number;
  durationSec: number;
  segmentSec: number;
}): ManhuaLearnVideoSegment | null {
  const durationSec = finitePositive(input.durationSec);
  const segmentSec = finitePositive(input.segmentSec);
  if (durationSec <= 0 || segmentSec <= 0) return null;
  const startSec = Math.max(0, Number(input.cursorSec) || 0);
  if (startSec >= durationSec - 0.5) return null;
  return {
    startSec,
    endSec: Math.min(durationSec, startSec + segmentSec),
  };
}

function ytdlpTimeSec(value: number): string {
  return String(Number(Math.max(0, value).toFixed(3)));
}

/** yt-dlp --download-sections 参数，星号表示按时间区间裁切。 */
export function buildManhuaLearnYtdlpSection(startSec: number, endSec: number): string {
  const start = Math.max(0, Number(startSec) || 0);
  const end = Math.max(start, Number(endSec) || 0);
  if (end <= start) throw new Error("视频分段结束时间必须晚于开始时间");
  return `*${ytdlpTimeSec(start)}-${ytdlpTimeSec(end)}`;
}

export function buildManhuaLearnYtdlpMetadataArgs(input: {
  url: string;
  cookieArgs?: string[];
  /** 直连官方 CDN 播放地址时带站内 Referer（部分节点校验来源） */
  referer?: string;
}): string[] {
  return [
    ...(input.cookieArgs || []),
    ...(input.referer ? ["--referer", input.referer] : []),
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    input.url,
  ];
}

/**
 * 分段下载固定使用最高 720p 的分析副本；若来源没有 720p 档才回退 best。
 * 不传 --max-filesize：它按整条来源估算，会误杀只下载 10 分钟的长视频。
 * 800MB 安全阈值在文件落地后按“当前段真实大小”校验。
 */
export function buildManhuaLearnYtdlpSegmentArgs(input: {
  url: string;
  outputTemplate: string;
  startSec: number;
  endSec: number;
  cookieArgs?: string[];
  /** 直连官方 CDN 播放地址时带站内 Referer（部分节点校验来源） */
  referer?: string;
}): string[] {
  return [
    ...(input.cookieArgs || []),
    ...(input.referer ? ["--referer", input.referer] : []),
    "-f",
    `bv*[height<=${MANHUA_LEARN_SEGMENT_MAX_HEIGHT}][ext=mp4]+ba[ext=m4a]/b[height<=${MANHUA_LEARN_SEGMENT_MAX_HEIGHT}][ext=mp4]/best[height<=${MANHUA_LEARN_SEGMENT_MAX_HEIGHT}]/best`,
    "--download-sections",
    buildManhuaLearnYtdlpSection(input.startSec, input.endSec),
    "--force-keyframes-at-cuts",
    "--merge-output-format",
    "mp4",
    "-o",
    input.outputTemplate,
    "--no-playlist",
    input.url,
  ];
}

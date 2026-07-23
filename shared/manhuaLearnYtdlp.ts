/**
 * 漫剧「学节奏」下片辅助：URL 判定、Cookie 串 → Netscape、错误人话映射。
 * 不依赖 Node fs；临时 Cookie 文件由服务端 / 本机脚本写入。
 * 云端凭证与趋势采集同源：DOUYIN_COOKIE / DOUYIN_COOKIE_BACKUP / DOUYIN_COOKIE_POOL。
 */

/** 抖音单集成片页（非合集列表） */
export function isDouyinSingleVideoUrl(url: string): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (!/(^|\.)douyin\.com$/i.test(parsed.hostname) && !/(^|\.)iesdouyin\.com$/i.test(parsed.hostname)) {
      return false;
    }
    return /\/video\/\d+/i.test(parsed.pathname) || /\/note\/\d+/i.test(parsed.pathname);
  } catch {
    return /douyin\.com\/video\/\d+/i.test(u) || /douyin\.com\/note\/\d+/i.test(u);
  }
}

export function isDouyinHostUrl(url: string): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  try {
    const host = new URL(u).hostname;
    return /(^|\.)douyin\.com$/i.test(host) || /(^|\.)iesdouyin\.com$/i.test(host);
  } catch {
    return /douyin\.com|iesdouyin\.com/i.test(u);
  }
}

/** Header 形 Cookie（`a=1; b=2`）→ Netscape cookies.txt 正文 */
export function buildNetscapeCookiesFromHeader(
  cookieHeader: string,
  host = ".douyin.com",
): string {
  const pairs = String(cookieHeader || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = ["# Netscape HTTP Cookie File", "# Generated for manhua template learn"];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    // domain flag path secure expiry name value
    lines.push(`${host}\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
  }
  return `${lines.join("\n")}\n`;
}

type EnvMap = Record<string, string | undefined>;

function readEnv(env?: EnvMap): EnvMap {
  return env || (typeof process !== "undefined" ? (process.env as EnvMap) : {});
}

export function pickDouyinCookieHeaderFromEnv(env?: EnvMap): string {
  const e = readEnv(env);
  const primary = String(e.DOUYIN_COOKIE || "").trim();
  if (primary) return primary;
  const backup = String(e.DOUYIN_COOKIE_BACKUP || "").trim();
  if (backup) return backup;
  const pool = String(e.DOUYIN_COOKIE_POOL || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return pool[0] || "";
}

export function manhuaLearnYtdlpCookiesFileFromEnv(env?: EnvMap): string {
  const e = readEnv(env);
  return String(e.MANHUA_LEARN_YTDLP_COOKIES_FILE || e.YTDLP_COOKIES_FILE || "").trim();
}

export function manhuaLearnYtdlpCookiesFromBrowserFromEnv(env?: EnvMap): string {
  return String(readEnv(env).MANHUA_LEARN_YTDLP_COOKIES_FROM_BROWSER || "").trim();
}

/** 是否已配置任一 Cookie 来源（文件 / 浏览器 / DOUYIN_COOKIE） */
export function hasManhuaLearnYtdlpCookieSource(env?: EnvMap): boolean {
  return Boolean(
    manhuaLearnYtdlpCookiesFileFromEnv(env)
      || manhuaLearnYtdlpCookiesFromBrowserFromEnv(env)
      || pickDouyinCookieHeaderFromEnv(env),
  );
}

export const MANHUA_LEARN_FETCH_ERR = {
  douyinLoginRequired:
    "抖音成片需要有效登录态才能拉取。云端学节奏复用服务端已有的抖音登录凭证（与趋势采集同源 DOUYIN_COOKIE）；若未生效请检查密钥配置。本机学习请在 .env 写入同一套 DOUYIN_COOKIE，或设置 MANHUA_LEARN_YTDLP_COOKIES_FILE。",
  douyinLoginStale:
    "抖音登录态已失效或被风控拦截，无法拉取成片。请更新服务端抖音登录凭证后重试（学节奏与趋势采集共用同一套）。",
  permissionDenied:
    "权限不足，无法下载该集成片（可能需购买或会员）。已跳过，继续下一集。",
  searchPage: "当前是搜索页链接，请改用合集或成片页地址后再学节奏",
  listFailed: "无法解析可学剧集，请换合集页或成片链接重试",
  downloadFailed: "成片下载失败，请确认链接可访问或稍后重试",
} as const;

/** 弱启发：错误原文偶发含付费/会员等字样时标「权限不足」（不可靠，仍计入连续失败） */
export function isManhuaLearnPermissionDeniedHint(raw: unknown): boolean {
  const text = raw instanceof Error ? raw.message : String(raw || "");
  return /付费|付費|会员|會員|购买|購買|无权|無權|权限不足|需开通|需開通|VIP专享|VIP專享|paywall|paid content|premium only/i.test(
    text,
  );
}

/** 合集 mixId → 候选合集页 URL（优先 collection，再 mix） */
export function buildDouyinMixCandidateUrls(mixId: string): string[] {
  const id = String(mixId || "").trim();
  if (!id || id.length < 4) return [];
  // 避免把剧名误当成 mixId 拼进 URL
  if (!/^\d{6,}$/.test(id)) return [];
  return [
    `https://www.douyin.com/collection/${id}`,
    `https://www.douyin.com/mix/${id}`,
  ];
}

/** 将 yt-dlp / spawn 原始错误收成前台可用中文（不泄漏命令行） */
export function mapManhuaLearnFetchError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw || "");
  const joined = `${text}\n${raw instanceof Error && raw.cause ? String(raw.cause) : ""}`;
  if (/douyin\.com\/search\//i.test(joined) || /搜索页/.test(joined)) {
    return MANHUA_LEARN_FETCH_ERR.searchPage;
  }
  if (isManhuaLearnPermissionDeniedHint(joined)) {
    return MANHUA_LEARN_FETCH_ERR.permissionDenied;
  }
  if (
    /Fresh cookies|cookies?.*(needed|required)|Login required|请先登录|登录态|cookie/i.test(joined)
  ) {
    if (/Fresh cookies|needed|required|失效|过期|expired|invalid/i.test(joined)) {
      return MANHUA_LEARN_FETCH_ERR.douyinLoginStale;
    }
    return MANHUA_LEARN_FETCH_ERR.douyinLoginRequired;
  }
  if (
    /Unable to extract|Unsupported URL|No video formats|HTTP Error 401|HTTP Error 403/i.test(joined)
    || /\b403\b|\b401\b/.test(joined)
  ) {
    return MANHUA_LEARN_FETCH_ERR.douyinLoginStale;
  }
  if (/Command failed:.*yt-dlp|yt-dlp/i.test(joined)) {
    return MANHUA_LEARN_FETCH_ERR.downloadFailed;
  }
  if (/无法解析任何可学剧集|listOrdered|flat-playlist/i.test(joined)) {
    return MANHUA_LEARN_FETCH_ERR.listFailed;
  }
  // 已是中文业务句则原样
  if (/[\u4e00-\u9fff]/.test(text) && !/yt-dlp|Command failed|ERROR: \[/i.test(text)) {
    return text.trim();
  }
  return MANHUA_LEARN_FETCH_ERR.downloadFailed;
}

/** 云端因登录态失败时，回退本机命令只会重复失败 → 跳过 */
export function shouldSkipLocalLearnFallback(errorZh: string): boolean {
  const t = String(errorZh || "");
  return (
    t.includes("登录态")
    || t.includes("登录凭证")
    || t === MANHUA_LEARN_FETCH_ERR.douyinLoginRequired
    || t === MANHUA_LEARN_FETCH_ERR.douyinLoginStale
  );
}

export function listedSingleEpisodeFromUrl(
  sourceUrl: string,
  titleHint?: string,
): Array<{ index: number; url: string; title: string }> {
  return [
    {
      index: 1,
      url: sourceUrl,
      title: String(titleHint || "第1集").trim() || "第1集",
    },
  ];
}

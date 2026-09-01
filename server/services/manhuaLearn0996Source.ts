import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import {
  isTrustedManhua0996MediaUrl,
  isTrustedManhua0996SiteUrl,
  parseManhua0996PlaybackResponse,
  parseManhua0996SeriesPage,
  parseManhua0996SourceUrl,
  type Manhua0996Playback,
  type Manhua0996SeriesPage,
  type Manhua0996SourceRef,
} from "../../shared/manhuaLearn0996Source.js";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;
// 站点公开前端 bundle 使用的匿名请求签名常量，不是账号密钥或生产凭证。
const ANONYMOUS_SIGN_KEY = "cb808529bae6b6be45ecfab29a4889bc";

type FetchLike = typeof fetch;
const manhua0996SourceDispatcher = new Agent({
  connect: { family: 4, timeout: REQUEST_TIMEOUT_MS },
});
const defaultSourceFetch: FetchLike = ((input: Parameters<FetchLike>[0], init?: RequestInit) =>
  undiciFetch(input as string | URL, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: manhua0996SourceDispatcher,
  }) as unknown as Promise<Response>) as FetchLike;

export const MANHUA_LEARN_EXTRA_SOURCE_HOSTS_ENV = "MANHUA_LEARN_EXTRA_SOURCE_HOSTS" as const;
export const MANHUA_MIRROR_SOURCE_COOKIE_ENV = "MANHUA_MIRROR_SOURCE_COOKIE" as const;
export const MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV = "MANHUA_MIRROR_SOURCE_AUTHORIZATION" as const;

export function readManhuaMirrorSourceAuthHeaders(input: {
  cookie?: string;
  authorization?: string;
} = {}): Record<string, string> {
  const cookie = String(input.cookie ?? process.env[MANHUA_MIRROR_SOURCE_COOKIE_ENV] ?? "").trim();
  const authorization = String(
    input.authorization ?? process.env[MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV] ?? "",
  ).trim();
  const clean = (value: string, max: number) => value && value.length <= max && !/[\r\n]/.test(value);
  return {
    ...(clean(cookie, 16_384) ? { cookie } : {}),
    ...(clean(authorization, 4_096) ? { authorization } : {}),
  };
}

export function readManhuaLearnExtraSourceHosts(
  raw = process.env[MANHUA_LEARN_EXTRA_SOURCE_HOSTS_ENV],
): string[] {
  return Array.from(new Set(String(raw || "").split(",").flatMap((part) => {
    const host = part.trim().toLowerCase().replace(/\.$/, "");
    if (!host || host.length > 253 || isIP(host) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
      return [];
    }
    return [host];
  })));
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  const octets = (mappedIpv4 || normalized).split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254)
    || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b! >= 64 && b! <= 127);
}

/** DNS 解析结果只要混入一条私网/回环地址就拒绝，不接受双栈中的危险候选。 */
export async function assertPublicManhuaSourceHost(
  hostname: string,
  resolve = lookup,
): Promise<void> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolve(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("第三方播放站点 DNS 解析失败，已停止");
  }
  if (!addresses.length || addresses.some((row) => !isIP(row.address) || isPrivateAddress(row.address))) {
    throw new Error("第三方播放站点解析到非公网地址，已停止");
  }
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("第三方播放页解析已停止");
}

/**
 * 网络错误文本清洗：只保留可诊断信息，绝不外带敏感值。
 * URL 砍到协议+主机；cookie/authorization/sign/deviceId/token 形态的值整体遮蔽；
 * 禁换行；单字段限长，防止响应正文借错误串外带。
 */
export function sanitizeManhuaSourceErrorText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(https?:\/\/[^\s/?#"']+)[^\s"']*/gi, "$1/…")
    .replace(/\b(set-cookie|cookie|authorization|sign|deviceid|token)\b\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s;,&"']+/gi, "$1=<已遮蔽>")
    .replace(/[?&][^\s"']*/g, "?<已遮蔽>")
    .trim()
    .slice(0, 200);
}

/** 提取底层网络失败的结构化回执（name/message/cause.code/cause.name/cause.message，均已清洗）。 */
export function describeManhuaSourceFetchFailure(error: unknown): string {
  const parts: string[] = [];
  const push = (label: string, raw: unknown) => {
    const text = sanitizeManhuaSourceErrorText(raw);
    if (text) parts.push(`${label}=${text}`);
  };
  if (error instanceof Error) {
    push("name", error.name);
    push("message", error.message);
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      push("cause.name", (cause as { name?: unknown }).name);
      push("cause.code", (cause as { code?: unknown }).code);
      push("cause.message", (cause as { message?: unknown }).message);
    }
  } else if (error !== undefined && error !== null) {
    push("value", error);
  }
  return parts.join(" · ");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  fetchImpl: FetchLike = defaultSourceFetch,
): Promise<Response> {
  if (signal?.aborted) throw abortError(signal);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetchImpl(url, { ...init, signal: combined });
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    const detail = [
      timeout.aborted ? `timeout=${REQUEST_TIMEOUT_MS}ms` : "",
      describeManhuaSourceFetchFailure(error),
    ].filter(Boolean).join(" · ");
    throw new Error(detail ? `第三方播放页网络请求失败或超时（${detail}）` : "第三方播放页网络请求失败或超时");
  }
}

async function fetchTrustedSourceWithAuthFallback(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  fetchImpl: FetchLike = defaultSourceFetch,
): Promise<Response> {
  const authHeaders = readManhuaMirrorSourceAuthHeaders();
  const hasFallback = Object.keys(authHeaders).length > 0;
  try {
    const anonymous = await fetchWithTimeout(url, init, signal, fetchImpl);
    // manual redirect 是成功的逐跳结果，不得误触带生产凭证的鉴权兜底。
    if (anonymous.ok || isRedirectStatus(anonymous.status) || !hasFallback) return anonymous;
  } catch (error) {
    if (!hasFallback || signal?.aborted) throw error;
  }
  return fetchWithTimeout(url, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers).entries()), ...authHeaders },
  }, signal, fetchImpl);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * API 的每一跳只允许固定源站/镜像域；签名与原 headers 原样随同源跳转，绝不重签。
 * 最终响应中的媒体 URL 由 parseManhua0996PlaybackResponse 使用独立 CDN 白名单校验。
 */
async function fetchTrustedApiResponse(
  startUrl: string,
  init: RequestInit,
  signal?: AbortSignal,
  fetchImpl: FetchLike = defaultSourceFetch,
): Promise<Response> {
  const additionalHosts = readManhuaLearnExtraSourceHosts();
  let current = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isTrustedManhua0996SiteUrl(current, additionalHosts)) {
      throw new Error("第三方媒体接口重定向到非可信源站，已停止");
    }
    await assertPublicManhuaSourceHost(new URL(current).hostname);
    const response = await fetchTrustedSourceWithAuthFallback(current, {
      ...init,
      redirect: "manual",
    }, signal, fetchImpl);
    if (!isRedirectStatus(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("第三方媒体接口重定向缺少目标，已停止");
    const next = new URL(location, current).toString();
    if (!isTrustedManhua0996SiteUrl(next, additionalHosts)) {
      throw new Error("第三方媒体接口重定向到非可信源站，已停止");
    }
    current = next;
  }
  throw new Error("第三方媒体接口重定向次数过多，已停止");
}

/** 每一跳重定向都重新校验固定站点，防止可信页面把服务端导向内网或任意外域。 */
async function fetchTrustedPageHtml(
  startUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = defaultSourceFetch,
): Promise<string> {
  const additionalHosts = readManhuaLearnExtraSourceHosts();
  let current = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isTrustedManhua0996SiteUrl(current, additionalHosts)) {
      throw new Error("第三方播放页重定向到非可信域，已停止");
    }
    await assertPublicManhuaSourceHost(new URL(current).hostname);
    const response = await fetchTrustedSourceWithAuthFallback(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    }, signal, fetchImpl);
    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("第三方播放页重定向缺少目标，已停止");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`第三方播放页请求失败（HTTP ${response.status}）`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html")) {
      throw new Error("第三方播放页返回了非 HTML 内容，已停止");
    }
    const html = await response.text();
    if (!html.trim()) throw new Error("第三方播放页返回空内容，已停止");
    return html;
  }
  throw new Error("第三方播放页重定向次数过多，已停止");
}

export function buildManhua0996EpisodeApiRequest(
  source: Manhua0996SourceRef,
  timestampMs: number,
  deviceId = randomUUID(),
): { url: string; headers: Record<string, string> } {
  const t = String(Math.floor(timestampMs));
  if (!/^\d{10,16}$/.test(t)) throw new Error("第三方媒体请求时间戳无效");
  const query = `clientType=1&id=${source.vodId}&nid=${source.nid}`;
  const material = `${query}&key=${ANONYMOUS_SIGN_KEY}&t=${t}`;
  const md5 = createHash("md5").update(material).digest("hex");
  const sign = createHash("sha1").update(md5).digest("hex");
  return {
    url: `https://${source.host}/api/mw-movie/anonymous/v2/video/episode/url?${query}`,
    headers: {
      accept: "application/json",
      "client-type": "1",
      deviceId,
      referer: `https://${source.host}/`,
      sign,
      t,
    },
  };
}

export async function fetchManhua0996SeriesPage(
  rawUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = defaultSourceFetch,
): Promise<Manhua0996SeriesPage> {
  const source = parseManhua0996SourceUrl(rawUrl, readManhuaLearnExtraSourceHosts());
  if (!source) throw new Error("第三方播放页链接无效或不在可信站点内");
  const html = await fetchTrustedPageHtml(source.canonicalUrl, signal, fetchImpl);
  return parseManhua0996SeriesPage(html, source);
}

export async function fetchManhua0996EpisodePlayback(
  rawUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = defaultSourceFetch,
): Promise<Manhua0996Playback> {
  const source = parseManhua0996SourceUrl(rawUrl, readManhuaLearnExtraSourceHosts());
  if (!source) throw new Error("第三方播放页链接无效或不在可信站点内");
  const request = buildManhua0996EpisodeApiRequest(source, Date.now());
  await assertPublicManhuaSourceHost(source.host);
  /**
   * 🔒 凭证**不在这里主动发**：fetchTrustedApiResponse 内部是「先匿名、失败才带凭证」，
   * 那是刻意的安全边界（凭证只在必要时出网），不许为了拿高清就把它拆掉。
   * 这里只读「有没有配凭证」，用来决定**解析层要不要接受 needLogin:true 的高清档**。
   */
  const hasAuth = Object.keys(readManhuaMirrorSourceAuthHeaders({}) || {}).length > 0;
  const response = await fetchTrustedApiResponse(request.url, {
    method: "GET",
    headers: request.headers,
  }, signal, fetchImpl);
  if (!response.ok) throw new Error(`第三方媒体接口请求失败（HTTP ${response.status}）`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("第三方媒体接口返回了无效 JSON，已停止");
  }
  const parsed = parseManhua0996PlaybackResponse(payload, `https://${source.host}/`, hasAuth);
  for (const mediaUrl of parsed.playbackUrls) {
    if (!isTrustedManhua0996MediaUrl(mediaUrl)) {
      throw new Error("第三方媒体接口返回非可信媒体域，已停止");
    }
    await assertPublicManhuaSourceHost(new URL(mediaUrl).hostname);
  }
  return parsed;
}

export async function resolveManhua0996Series(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<{
  source: Manhua0996SourceRef;
  page: Manhua0996SeriesPage;
}> {
  const source = parseManhua0996SourceUrl(rawUrl, readManhuaLearnExtraSourceHosts());
  if (!source) throw new Error("第三方播放页链接无效或不在可信站点内");
  const page = await fetchManhua0996SeriesPage(source.canonicalUrl, signal);
  return { source, page };
}

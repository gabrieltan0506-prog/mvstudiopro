import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
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

export const MANHUA_LEARN_EXTRA_SOURCE_HOSTS_ENV = "MANHUA_LEARN_EXTRA_SOURCE_HOSTS" as const;

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (signal?.aborted) throw abortError(signal);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetchImpl(url, { ...init, signal: combined });
  } catch {
    if (signal?.aborted) throw abortError(signal);
    throw new Error("第三方播放页网络请求失败或超时");
  }
}

/** 每一跳重定向都重新校验固定站点，防止可信页面把服务端导向内网或任意外域。 */
async function fetchTrustedPageHtml(
  startUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const additionalHosts = readManhuaLearnExtraSourceHosts();
  let current = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isTrustedManhua0996SiteUrl(current, additionalHosts)) {
      throw new Error("第三方播放页重定向到非可信域，已停止");
    }
    await assertPublicManhuaSourceHost(new URL(current).hostname);
    const response = await fetchWithTimeout(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    }, signal, fetchImpl);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
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
  fetchImpl: FetchLike = fetch,
): Promise<Manhua0996SeriesPage> {
  const source = parseManhua0996SourceUrl(rawUrl, readManhuaLearnExtraSourceHosts());
  if (!source) throw new Error("第三方播放页链接无效或不在可信站点内");
  const html = await fetchTrustedPageHtml(source.canonicalUrl, signal, fetchImpl);
  return parseManhua0996SeriesPage(html, source);
}

export async function fetchManhua0996EpisodePlayback(
  rawUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<Manhua0996Playback> {
  const source = parseManhua0996SourceUrl(rawUrl, readManhuaLearnExtraSourceHosts());
  if (!source) throw new Error("第三方播放页链接无效或不在可信站点内");
  const request = buildManhua0996EpisodeApiRequest(source, Date.now());
  await assertPublicManhuaSourceHost(source.host);
  const response = await fetchWithTimeout(request.url, {
    method: "GET",
    redirect: "error",
    headers: request.headers,
  }, signal, fetchImpl);
  if (!response.ok) throw new Error(`第三方媒体接口请求失败（HTTP ${response.status}）`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("第三方媒体接口返回了无效 JSON，已停止");
  }
  const parsed = parseManhua0996PlaybackResponse(payload, `https://${source.host}/`);
  for (const mediaUrl of parsed.playbackUrls) {
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

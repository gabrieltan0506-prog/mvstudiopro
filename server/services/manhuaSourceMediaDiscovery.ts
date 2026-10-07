import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isUnsafePhotoAddress } from "./photoMediaInput.js";
import { isTrustedManhua0996MediaUrl } from "../../shared/manhuaLearn0996Source.js";

/** A source response can authorize public media only; it never expands credential-bearing source hosts. */
export function parseDiscoveredMediaUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || /^https:\/\/[^/]+:\d+(?:\/|$)/i.test(raw)
    || isIP(url.hostname.replace(/^\[|\]$/g, ""))
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) {
    throw new Error("来源返回的媒体地址不是安全的公网 HTTPS 域名");
  }
  return url;
}

/** Bounded header-only preflight. Every redirect is public-DNS checked and pinned; no account headers. */
export async function verifyDiscoveredMediaUrl(raw: string, referer: string, signal?: AbortSignal): Promise<string> {
  let current = parseDiscoveredMediaUrl(raw);
  const bounded = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  for (let hop = 0; hop <= 4; hop++) {
    bounded.throwIfAborted();
    const addresses = await lookup(current.hostname, { all: true });
    if (!addresses.length || addresses.some(a => isUnsafePhotoAddress(a.address)))
      throw new Error("来源返回的媒体域解析到非公网地址，已停止");
    const address = addresses.find(a => a.family === 4) || addresses[0]!;
    const response = await new Promise<{status:number;location?:string}>((resolve, reject) => {
      const request = https.request(current, {
        method: "HEAD", signal: bounded,
        headers: { referer, "user-agent": "Mozilla/5.0" },
        lookup: ((_host: string, options: {all?: boolean}, callback: (...args: any[]) => void) => {
          callback(null, options.all ? [address] : address.address, address.family);
        }) as never,
      }, res => { const result = {status:res.statusCode || 0, location:res.headers.location};res.destroy();resolve(result); });
      request.on("error", reject);request.end();
    });
    if ([301,302,303,307,308].includes(response.status)) {
      if (!response.location || hop === 4) throw new Error("新媒体域重定向次数过多或缺少目标");
      current = parseDiscoveredMediaUrl(new URL(response.location,current).href);continue;
    }
    // HEAD often returns 403/405 even when signed GET works. This verifies the destination,
    // not entitlement/playability: native probes still try every quality and reject bad media.
    if (response.status < 200 || response.status >= 600)
      throw new Error("新媒体域预检未取得有效响应");
    return current.href;
  }
  throw new Error("新媒体域预检未完成");
}

export async function discoverSourceMedia(payload: unknown, input: {
  authenticated: boolean; referer: string; signal?: AbortSignal;
  verify?: typeof verifyDiscoveredMediaUrl;
}): Promise<{payload: unknown; verifiedHosts: string[]}> {
  // Discovery is bound to this authenticated response, not a global persistent allowlist.
  if (!input.authenticated || !payload || typeof payload !== "object") return {payload,verifiedHosts:[]};
  const root = payload as {code?:unknown;data?:{list?:unknown}};
  if (Number(root.code) !== 200 || !Array.isArray(root.data?.list)) return {payload,verifiedHosts:[]};
  const verifiedHosts = new Set<string>(), cache = new Map<string,string>();
  const list = [];
  for (const row of root.data.list) {
    if (!row || typeof row !== "object") {list.push(row);continue;}
    const raw = String(row.url ?? row.playUrl ?? "").trim();
    if (!raw || isTrustedManhua0996MediaUrl(raw)) {list.push(row);continue;}
    parseDiscoveredMediaUrl(raw);
    let resolved = cache.get(raw);
    if (!resolved) {
      if (cache.size >= 12) throw new Error("来源返回的新媒体节点过多，未自动扩大信任范围");
      resolved = await (input.verify || verifyDiscoveredMediaUrl)(raw,input.referer,input.signal);
      const final = parseDiscoveredMediaUrl(resolved);
      verifiedHosts.add(final.hostname);cache.set(raw,resolved);
    }
    list.push({...row,url:resolved});
  }
  return {payload:{...root,data:{...root.data,list}},verifiedHosts:Array.from(verifiedHosts)};
}

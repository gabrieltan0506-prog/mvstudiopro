import { lookup } from "node:dns/promises";

export function isPrivateOrReservedAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value || value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)?.[1];
  const ipv4 = mapped || (/^\d+\.\d+\.\d+\.\d+$/.test(value) ? value : "");
  if (!ipv4) return false;
  const octets = ipv4.split(".").map(Number);
  const [a, b] = octets;
  if (octets.length !== 4 || octets.some(part => part < 0 || part > 255)) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

export function isTrustedBlobBearerHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/\.$/, "");
  return value === "blob.vercel-storage.com" || value.endsWith(".blob.vercel-storage.com");
}

async function assertSafePublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("unsupported_image_url");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("unsafe_image_url");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => isPrivateOrReservedAddress(entry.address))) {
    throw new Error("unsafe_image_url");
  }
}

async function requestWithSafeRedirects(
  url: URL,
  headers: Record<string, string>,
  abortSignal?: AbortSignal,
): Promise<Response> {
  let current = url;
  let currentHeaders = { ...headers };
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    await assertSafePublicUrl(current);
    const timeoutSignal = AbortSignal.timeout(60_000);
    const response = await fetch(current, {
      redirect: "manual",
      headers: currentHeaders,
      signal: abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === 4) throw new Error("image_redirect_invalid");
    const next = new URL(location, current);
    if (next.hostname !== current.hostname && currentHeaders.Authorization) {
      currentHeaders = { ...currentHeaders };
      delete currentHeaders.Authorization;
    }
    current = next;
  }
  throw new Error("image_redirect_invalid");
}

export async function fetchSafeRemoteImage(input: {
  imageUrl: string;
  maxBytes: number;
  userAgent: string;
  /** 默认可在可信 Blob 域名 403/404 时带服务端令牌重试；外部供应商可读性探针必须关闭。 */
  allowTrustedBlobBearer?: boolean;
  /** 调用方整单墙钟信号；每次重定向仍另有 60 秒单请求上限。 */
  abortSignal?: AbortSignal;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const parsed = new URL(input.imageUrl);
  await assertSafePublicUrl(parsed);
  const tokens = Array.from(
    new Set(
      (input.allowTrustedBlobBearer === false
        ? []
        : [process.env.MVSP_READ_WRITE_TOKEN, process.env.BLOB_READ_WRITE_TOKEN])
        .map(value => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const headers: Record<string, string> = { "User-Agent": input.userAgent };
  let response = await requestWithSafeRedirects(parsed, headers, input.abortSignal);
  if (
    (response.status === 403 || response.status === 404) &&
    tokens.length &&
    isTrustedBlobBearerHost(parsed.hostname)
  ) {
    for (const token of tokens) {
      response = await requestWithSafeRedirects(
        parsed,
        {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        input.abortSignal,
      );
      if (response.ok) break;
    }
  }
  if (!response.ok) throw new Error(`image_fetch_failed:${response.status}`);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > input.maxBytes) throw new Error("image_too_large");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("empty_image");
  if (buffer.length > input.maxBytes) throw new Error("image_too_large");
  return {
    buffer,
    contentType: response.headers.get("content-type") || "image/png",
  };
}

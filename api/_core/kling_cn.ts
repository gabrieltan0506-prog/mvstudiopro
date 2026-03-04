type JsonValue = any;

function safeJsonParse(raw: string): { ok: true; json: JsonValue } | { ok: false; error: string } {
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function getKlingCnEnv() {
  const baseUrl = (process.env.KLING_CN_BASE_URL || "https://api-beijing.klingai.com").replace(/\/+$/, "");
  const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY || process.env.KLING_CN_IMAGE_ACCESS_KEY || "";
  const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY || process.env.KLING_CN_IMAGE_SECRET_KEY || "";
  if (!accessKey) throw new Error("Missing KLING_CN_VIDEO_ACCESS_KEY");
  if (!secretKey) throw new Error("Missing KLING_CN_VIDEO_SECRET_KEY");
  return { baseUrl, accessKey, secretKey };
}

/**
 * NOTE: Kling CN signature scheme varies by product/version.
 * We implement a minimal pass-through with required headers:
 * - X-Access-Key / X-Secret-Key (common pattern in CN gateways)
 * If your Kling CN requires HMAC signature, we'll update after first real error payload is visible.
 */
export async function klingCnFetch(path: string, init: RequestInit) {
  const { baseUrl, accessKey, secretKey } = getKlingCnEnv();
  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  if (!headers.get("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("X-Access-Key", accessKey);
  headers.set("X-Secret-Key", secretKey);

  const resp = await fetch(url, { ...init, headers });
  const rawText = await resp.text();

  const parsed = safeJsonParse(rawText);
  if (!parsed.ok) {
    return {
      ok: false,
      status: resp.status,
      url,
      contentType: resp.headers.get("content-type") || "",
      rawText: rawText.slice(0, 4000),
      parseError: parsed.error,
    };
  }

  if (!resp.ok) return { ok: false, status: resp.status, url, json: parsed.json };
  return { ok: true, status: resp.status, url, json: parsed.json };
}

type JsonValue = any;

function safeJsonParse(raw: string): { ok: true; json: JsonValue } | { ok: false; error: string } {
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * AIMusicAPI fetch helper.
 * - baseUrl MUST be host-only, e.g. https://api.aimusicapi.ai
 * - path should be full API path, e.g. /api/v1/get-credits
 */
export async function aimusicFetch(path: string, init: RequestInit) {
  const baseUrl = (process.env.AIMUSIC_BASE_URL || "https://api.aimusicapi.ai").replace(/\/+$/, "");
  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const resp = await fetch(url, init);
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

  if (!resp.ok) {
    return { ok: false, status: resp.status, url, json: parsed.json };
  }

  return { ok: true, status: resp.status, url, json: parsed.json };
}

export function getAimusicKey(): string {
  const k =
    process.env.AIMUSIC_API_KEY ||
    process.env.AIMUSICAPI_KEY ||
    process.env.AIMUSIC_API_TOKEN ||
    "";
  if (!k) throw new Error("Missing AIMUSIC_API_KEY");
  return k;
}

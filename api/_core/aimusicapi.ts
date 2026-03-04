type JsonValue = any;

function safeJsonParse(raw: string): { ok: true; json: JsonValue } | { ok: false; error: string } {
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function aimusicFetch(path: string, init: RequestInit) {
  const baseUrl = "https://api.aimusicapi.ai";
  const url = `${baseUrl}${path}`;

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
  const k = process.env.AIMUSICAPI_KEY || process.env.AIMUSIC_API_KEY || "";
  if (!k) throw new Error("Missing AIMUSICAPI_KEY (or AIMUSIC_API_KEY) env var");
  return k;
}

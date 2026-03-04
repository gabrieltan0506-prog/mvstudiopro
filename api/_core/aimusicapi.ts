export async function aimusicFetch(path: string, body?: any) {
  const base = process.env.AIMUSIC_BASE_URL || "https://api.aimusicapi.ai";
  const key = process.env.AIMUSIC_API_KEY;
  if (!key) throw new Error("AIMUSIC_API_KEY missing");

  const resp = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await resp.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { ok:false, status:resp.status, raw };
  }
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

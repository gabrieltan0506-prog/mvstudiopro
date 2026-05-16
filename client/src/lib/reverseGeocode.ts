/**
 * 逆地理短標籤：經生產環境 `vercel.json` 將 `/api/ext/reverse-geocode` 轉發至 BigDataCloud，
 * 避免客戶端直連海外網域在部分網路下被拖慢或阻斷。
 */
const GEOCODE_TIMEOUT_MS = 1500;

export async function reverseGeocodeShortLabel(lat: number, lon: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  try {
    const u =
      `/api/ext/reverse-geocode?latitude=${encodeURIComponent(String(lat))}` +
      `&longitude=${encodeURIComponent(String(lon))}&localityLanguage=zh`;

    const res = await fetch(u, {
      credentials: "omit",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const j = (await res.json()) as {
      locality?: string;
      city?: string;
      principalSubdivision?: string;
      countryName?: string;
    };

    const parts = [j.locality, j.city, j.principalSubdivision]
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const uniq = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));

    if (uniq.length === 0 && j.countryName) return String(j.countryName).trim() || null;
    return uniq.slice(0, 2).join(" · ") || null;
  } catch {
    clearTimeout(timeoutId);
    console.warn("[Geocode] 逆地理定位超時或失敗，使用預設值");
    return null;
  }
}

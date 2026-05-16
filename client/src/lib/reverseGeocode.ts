/**
 * 瀏覽器端免金鑰逆地理（BigDataCloud client API，可從一般網頁直接 fetch）。
 */
export async function reverseGeocodeShortLabel(lat: number, lon: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    const u =
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(String(lat))}` +
      `&longitude=${encodeURIComponent(String(lon))}&localityLanguage=zh`;
    const res = await fetch(u, { credentials: "omit" });
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
    return null;
  }
}

export type ManhuaAssetManifestClaim = {
  anchorIds: string[];
  anchorNamesZh: string[];
};

function cleanPath(raw: unknown): string {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function addClaim(
  out: Map<string, ManhuaAssetManifestClaim>,
  pathRaw: unknown,
  idRaw: unknown,
  nameRaw: unknown
): void {
  const path = cleanPath(pathRaw);
  if (!path) return;
  const prev = out.get(path) || { anchorIds: [], anchorNamesZh: [] };
  const id = String(idRaw || "").trim();
  const name = String(nameRaw || "").trim();
  if (id && !prev.anchorIds.includes(id)) prev.anchorIds.push(id);
  if (name && !prev.anchorNamesZh.includes(name)) prev.anchorNamesZh.push(name);
  out.set(path, prev);
}

/** 解析资产包 asset_canon.json；同一张场景/道具拼板可认领多个锚点。 */
export function buildManhuaAssetManifestClaims(
  raw: unknown
): Map<string, ManhuaAssetManifestClaim> {
  const out = new Map<string, ManhuaAssetManifestClaim>();
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const item of Array.isArray(src.characters) ? src.characters : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const images =
      row.images && typeof row.images === "object"
        ? (row.images as Record<string, unknown>)
        : {};
    for (const path of Object.values(images))
      addClaim(out, path, row.id, row.nameZh);
  }
  for (const item of Array.isArray(src.locations) ? src.locations : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    addClaim(out, row.image, row.id, row.nameZh);
  }
  for (const item of Array.isArray(src.props) ? src.props : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    addClaim(out, row.sheet || row.image, row.id, row.nameZh);
  }
  return out;
}

export function resolveManhuaAssetManifestClaim(
  claims: Map<string, ManhuaAssetManifestClaim>,
  importedPath: string
): ManhuaAssetManifestClaim | null {
  const imported = cleanPath(importedPath);
  for (const [path, claim] of Array.from(claims.entries())) {
    if (imported === path || imported.endsWith(`/${path}`)) return claim;
  }
  return null;
}

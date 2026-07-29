/**
 * 资产暂存区（恢复站）：人物/场景/道具设定图在被「清掉旧图重出 / 误删」前，
 * 先把带成品图的块存进本地持久暂存区；万一手贱清错，可一键救回。
 *
 * 产品口径（用户 2026-07-29）：「原有的生成人物跟道具场景做一个暂存区，
 * 如果不小心手贱删掉了还能救回来。」
 *
 * 纯逻辑（不碰 localStorage）：合并/去重/封顶/解析在这里，持久化交调用方。
 */

export type ManhuaAssetStashRole = "character" | "scene" | "prop";

export type ManhuaAssetStashEntry = {
  /** 原画布块 id（charsheet-/sceneplate-/propsheet-…），救回时按此还原 */
  blockId: string;
  role: ManhuaAssetStashRole;
  /** 成品图 https 地址（唯一去重键） */
  imageUrl: string;
  labelZh?: string;
  /** 原提示词，救回块用 */
  prompt?: string;
  /** 该块曾附带的多图（如主角脸+全身、场景四格切片） */
  outputUrls?: string[];
  stashedAt: number;
};

/** 暂存区上限：超出按 stashedAt 保新弃旧 */
export const MANHUA_ASSET_STASH_CAP = 200;

export const MANHUA_ASSET_STASH_STORAGE_KEY = "mv-manhua-asset-stash-v1";

const HTTPS_RE = /^https:\/\//i;

function cleanEntry(raw: unknown): ManhuaAssetStashEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaAssetStashEntry>;
  const imageUrl = String(o.imageUrl || "").trim();
  const blockId = String(o.blockId || "").trim();
  if (!HTTPS_RE.test(imageUrl) || !blockId) return null;
  const role: ManhuaAssetStashRole =
    o.role === "scene" || o.role === "prop" ? o.role : "character";
  const outputUrls = Array.isArray(o.outputUrls)
    ? o.outputUrls.map((u) => String(u || "").trim()).filter((u) => HTTPS_RE.test(u))
    : undefined;
  return {
    blockId,
    role,
    imageUrl,
    ...(o.labelZh ? { labelZh: String(o.labelZh).slice(0, 80) } : {}),
    ...(o.prompt ? { prompt: String(o.prompt) } : {}),
    ...(outputUrls && outputUrls.length ? { outputUrls } : {}),
    stashedAt: Math.max(0, Math.floor(Number(o.stashedAt) || Date.now())),
  };
}

/** 解析持久化的暂存区（脏数据自动剔除，按 stashedAt 新→旧排序）。 */
export function parseManhuaAssetStash(raw: unknown): ManhuaAssetStashEntry[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: ManhuaAssetStashEntry[] = [];
  for (const it of arr) {
    const e = cleanEntry(it);
    if (e) out.push(e);
  }
  return out.sort((a, b) => b.stashedAt - a.stashedAt);
}

/**
 * 把即将被清掉的资产块并入暂存区。
 * - 只收带成品图（https）的块；无图（半成品）不进暂存。
 * - 按 imageUrl 去重，重复者以「更新的 stashedAt」为准。
 * - 封顶 `MANHUA_ASSET_STASH_CAP`，保新弃旧。
 */
export function mergeManhuaAssetStash(
  existing: readonly ManhuaAssetStashEntry[] | null | undefined,
  incoming: readonly Partial<ManhuaAssetStashEntry>[] | null | undefined,
  now: number = Date.now(),
): ManhuaAssetStashEntry[] {
  const byUrl = new Map<string, ManhuaAssetStashEntry>();
  for (const e of existing || []) {
    const c = cleanEntry(e);
    if (c) byUrl.set(c.imageUrl, c);
  }
  for (const raw of incoming || []) {
    const c = cleanEntry({ stashedAt: now, ...raw });
    if (!c) continue;
    const prev = byUrl.get(c.imageUrl);
    if (!prev || c.stashedAt >= prev.stashedAt) byUrl.set(c.imageUrl, c);
  }
  return Array.from(byUrl.values())
    .sort((a, b) => b.stashedAt - a.stashedAt)
    .slice(0, MANHUA_ASSET_STASH_CAP);
}

/** 从暂存区按 blockId 取一条（救回单张用）。 */
export function findManhuaAssetStashEntry(
  stash: readonly ManhuaAssetStashEntry[] | null | undefined,
  blockId: string,
): ManhuaAssetStashEntry | null {
  const id = String(blockId || "").trim();
  if (!id) return null;
  return (stash || []).find((e) => e.blockId === id) || null;
}

/** 从暂存区移除若干条（救回后清理，按 imageUrl 匹配）。 */
export function removeManhuaAssetStashEntries(
  stash: readonly ManhuaAssetStashEntry[] | null | undefined,
  imageUrls: readonly string[],
): ManhuaAssetStashEntry[] {
  const drop = new Set(imageUrls.map((u) => String(u || "").trim()));
  return (stash || []).filter((e) => !drop.has(e.imageUrl));
}

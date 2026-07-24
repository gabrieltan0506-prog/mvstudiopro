/**
 * 人物造型套（A+3）：每人最多 3 套妆造+服装(+道具搭配)。
 * - 全局 @服装N（跨集可复用）
 * - 子号 @角色K·服装i（挂在谁身上）
 * - 换装 = 段上手选启用哪一套，不改 @角色 脸 id
 * 网址只进后台 path 表，不进用户可见提示词。
 */

import type { ManhuaCustomAssetRef } from "./manhuaCustomAssetRefs.js";

export const MANHUA_LOOK_SETS_PER_CHARACTER_MAX = 3;

export type ManhuaCharacterLookSet = {
  id: string;
  characterId: string;
  /** 该角色下第几套：1..3 */
  index: number;
  labelZh: string;
  /** 妆造/全身造型图 customRef id */
  lookRefId?: string;
  /** 服装特写图 customRef id（role=wardrobe 优先） */
  wardrobeRefId?: string;
  /** 本套搭配道具 customRef id */
  propRefIds?: string[];
};

export type ManhuaWardrobeSubSlot = {
  wardrobeId: string;
  wardrobeNameZh: string;
  characterId: string;
  characterNameZh: string;
  /** 全局 @服装N */
  wardrobeTag: string;
  /** @角色K·服装i */
  subTag: string;
  localIndex: number;
  parentCharacterTag: string;
  path: string;
  lookSetId: string;
};

export function makeManhuaLookSetId(characterId: string, index: number): string {
  const c = String(characterId || "char")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40);
  return `ls_${c}_${Math.max(1, Math.min(MANHUA_LOOK_SETS_PER_CHARACTER_MAX, index))}`;
}

export function segmentLookBindingKey(episodeIndex: number, segmentIndex: number): string {
  return `e${Math.max(1, Math.floor(episodeIndex))}:s${Math.max(1, Math.floor(segmentIndex))}`;
}

export function normalizeManhuaCharacterLookSets(raw: unknown): ManhuaCharacterLookSet[] {
  if (!Array.isArray(raw)) return [];
  const byChar = new Map<string, ManhuaCharacterLookSet[]>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Partial<ManhuaCharacterLookSet>;
    const characterId = String(o.characterId || "").trim();
    if (!characterId) continue;
    const index = Math.max(
      1,
      Math.min(MANHUA_LOOK_SETS_PER_CHARACTER_MAX, Math.floor(Number(o.index) || 1)),
    );
    const id = String(o.id || "").trim() || makeManhuaLookSetId(characterId, index);
    const labelZh =
      String(o.labelZh || "").trim().slice(0, 40) || `造型${index}`;
    const lookRefId = String(o.lookRefId || "").trim() || undefined;
    const wardrobeRefId = String(o.wardrobeRefId || "").trim() || undefined;
    const propRefIds = Array.isArray(o.propRefIds)
      ? o.propRefIds.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6)
      : [];
    const list = byChar.get(characterId) || [];
    if (list.length >= MANHUA_LOOK_SETS_PER_CHARACTER_MAX) continue;
    if (list.some((x) => x.index === index || x.id === id)) continue;
    list.push({
      id,
      characterId,
      index,
      labelZh,
      lookRefId,
      wardrobeRefId,
      propRefIds,
    });
    byChar.set(characterId, list);
  }
  const out: ManhuaCharacterLookSet[] = [];
  for (const list of Array.from(byChar.values())) {
    list.sort((a: ManhuaCharacterLookSet, b: ManhuaCharacterLookSet) => a.index - b.index);
    out.push(...list);
  }
  return out;
}

export function normalizeManhuaSegmentLookBindings(
  raw: unknown,
): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [segKey, bind] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(segKey || "").trim().slice(0, 32);
    if (!key || !bind || typeof bind !== "object") continue;
    const row: Record<string, string> = {};
    for (const [cid, ls] of Object.entries(bind as Record<string, unknown>)) {
      const characterId = String(cid || "").trim().slice(0, 64);
      const lookSetId = String(ls || "").trim().slice(0, 80);
      if (characterId && lookSetId) row[characterId] = lookSetId;
    }
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}

export function listManhuaLookSetsForCharacter(
  sets: ManhuaCharacterLookSet[] | null | undefined,
  characterId: string,
): ManhuaCharacterLookSet[] {
  const cid = String(characterId || "").trim();
  return (sets || [])
    .filter((s) => s.characterId === cid)
    .sort((a, b) => a.index - b.index)
    .slice(0, MANHUA_LOOK_SETS_PER_CHARACTER_MAX);
}

/** 确保角色至少有 1 套空位（便于段上手选）；不自动造图 */
export function ensureDefaultLookSetsForCharacters(
  sets: ManhuaCharacterLookSet[] | null | undefined,
  characterIds: string[],
  nameById?: Record<string, string> | null,
): ManhuaCharacterLookSet[] {
  const next = normalizeManhuaCharacterLookSets(sets);
  for (const cid of characterIds.map((x) => String(x || "").trim()).filter(Boolean)) {
    const existing = listManhuaLookSetsForCharacter(next, cid);
    if (existing.length) continue;
    const name = String(nameById?.[cid] || "").trim();
    next.push({
      id: makeManhuaLookSetId(cid, 1),
      characterId: cid,
      index: 1,
      labelZh: name ? `${name}·默认造型` : "造型1",
    });
  }
  return normalizeManhuaCharacterLookSets(next);
}

export function upsertManhuaCharacterLookSet(
  sets: ManhuaCharacterLookSet[] | null | undefined,
  patch: Partial<ManhuaCharacterLookSet> & { characterId: string; index: number },
): ManhuaCharacterLookSet[] {
  const characterId = String(patch.characterId || "").trim();
  const index = Math.max(
    1,
    Math.min(MANHUA_LOOK_SETS_PER_CHARACTER_MAX, Math.floor(Number(patch.index) || 1)),
  );
  if (!characterId) return normalizeManhuaCharacterLookSets(sets);
  const id = String(patch.id || "").trim() || makeManhuaLookSetId(characterId, index);
  const others = normalizeManhuaCharacterLookSets(sets).filter(
    (s) => !(s.characterId === characterId && (s.index === index || s.id === id)),
  );
  const forChar = listManhuaLookSetsForCharacter(others, characterId);
  if (forChar.length >= MANHUA_LOOK_SETS_PER_CHARACTER_MAX) {
    return normalizeManhuaCharacterLookSets(others);
  }
  others.push({
    id,
    characterId,
    index,
    labelZh: String(patch.labelZh || `造型${index}`).trim().slice(0, 40),
    lookRefId: String(patch.lookRefId || "").trim() || undefined,
    wardrobeRefId: String(patch.wardrobeRefId || "").trim() || undefined,
    propRefIds: Array.isArray(patch.propRefIds)
      ? patch.propRefIds.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6)
      : [],
  });
  return normalizeManhuaCharacterLookSets(others);
}

export function setManhuaSegmentLookBinding(opts: {
  bindings: Record<string, Record<string, string>> | null | undefined;
  episodeIndex: number;
  segmentIndex: number;
  characterId: string;
  lookSetId: string;
}): Record<string, Record<string, string>> {
  const key = segmentLookBindingKey(opts.episodeIndex, opts.segmentIndex);
  const next = normalizeManhuaSegmentLookBindings(opts.bindings);
  const row = { ...(next[key] || {}) };
  const cid = String(opts.characterId || "").trim();
  const ls = String(opts.lookSetId || "").trim();
  if (!cid) return next;
  if (!ls) delete row[cid];
  else row[cid] = ls;
  if (Object.keys(row).length) next[key] = row;
  else delete next[key];
  return next;
}

export function getManhuaSegmentLookBinding(
  bindings: Record<string, Record<string, string>> | null | undefined,
  episodeIndex: number,
  segmentIndex: number,
): Record<string, string> {
  const key = segmentLookBindingKey(episodeIndex, segmentIndex);
  return { ...(normalizeManhuaSegmentLookBindings(bindings)[key] || {}) };
}

function refUrlById(
  refs: ManhuaCustomAssetRef[] | null | undefined,
  id: string | undefined,
): string {
  const want = String(id || "").trim();
  if (!want) return "";
  const hit = (refs || []).find((r) => r.id === want);
  return String(hit?.url || "").trim();
}

/**
 * 从造型套生成服装子编号（有挂图才进 path；否则 logical 占位只编号）。
 */
export function buildManhuaWardrobeSubSlotsFromLookSets(opts: {
  lookSets: ManhuaCharacterLookSet[] | null | undefined;
  customRefs?: ManhuaCustomAssetRef[] | null;
  characterTagById?: Record<string, string> | null;
  characterNameById?: Record<string, string> | null;
}): ManhuaWardrobeSubSlot[] {
  const sets = normalizeManhuaCharacterLookSets(opts.lookSets);
  if (!sets.length) return [];
  const tagById = opts.characterTagById || {};
  const nameById = opts.characterNameById || {};
  const refs = opts.customRefs || [];

  type Draft = {
    lookSet: ManhuaCharacterLookSet;
    parentCharacterTag: string;
    path: string;
  };
  const drafts: Draft[] = [];
  for (const ls of sets) {
    const path =
      refUrlById(refs, ls.wardrobeRefId) ||
      refUrlById(refs, ls.lookRefId) ||
      `logical://look-wardrobe/${encodeURIComponent(ls.characterId)}/${encodeURIComponent(ls.id)}`;
    const parentTag =
      String(tagById[ls.characterId] || "").trim() ||
      `@角色${Math.max(1, ls.index)}`;
    drafts.push({ lookSet: ls, parentCharacterTag: parentTag, path });
  }

  // 全局 @服装N：按 lookSet.id 稳定排序
  const idOrder = Array.from(new Set(drafts.map((d) => d.lookSet.id))).sort((a, b) =>
    a.localeCompare(b),
  );
  const tagByLookSetId = new Map<string, string>();
  idOrder.forEach((id, i) => tagByLookSetId.set(id, `@服装${i + 1}`));

  // 每角色本地 ·服装i 按 index
  return drafts.map((d) => {
    const localIndex = d.lookSet.index;
    return {
      wardrobeId: d.lookSet.id,
      wardrobeNameZh: d.lookSet.labelZh,
      characterId: d.lookSet.characterId,
      characterNameZh: String(nameById[d.lookSet.characterId] || "").trim() || "角色",
      wardrobeTag: tagByLookSetId.get(d.lookSet.id) || "@服装1",
      subTag: `${d.parentCharacterTag}·服装${localIndex}`,
      localIndex,
      parentCharacterTag: d.parentCharacterTag,
      path: d.path,
      lookSetId: d.lookSet.id,
    };
  });
}

/** 用户可见：本段启用造型（无网址） */
export function formatManhuaSegmentActiveLookLine(opts: {
  lookSets: ManhuaCharacterLookSet[] | null | undefined;
  binding: Record<string, string> | null | undefined;
  wardrobeSlots?: ManhuaWardrobeSubSlot[] | null;
  characterTagById?: Record<string, string> | null;
}): string {
  const sets = normalizeManhuaCharacterLookSets(opts.lookSets);
  const bind = opts.binding || {};
  const tagById = opts.characterTagById || {};
  const slotByLookSetId = new Map(
    (opts.wardrobeSlots || []).map((s) => [s.lookSetId, s] as const),
  );
  const bits: string[] = [];
  for (const [cid, lsId] of Object.entries(bind)) {
    const ls = sets.find((s) => s.id === lsId && s.characterId === cid);
    if (!ls) continue;
    const slot = slotByLookSetId.get(ls.id);
    const roleTag = String(tagById[cid] || slot?.parentCharacterTag || "").trim() || cid;
    const wTag = slot?.wardrobeTag || "";
    const sub = slot?.subTag || "";
    bits.push(
      [roleTag, wTag ? `→${wTag}` : "", `（${ls.labelZh}）`, sub ? ` ${sub}` : ""]
        .filter(Boolean)
        .join(""),
    );
  }
  if (!bits.length) return "";
  return `【本段造型】${bits.join("；")}`;
}

/** 出片：本段启用的造型套 id 列表 */
export function resolveActiveLookSetIdsForSegment(opts: {
  lookSets: ManhuaCharacterLookSet[] | null | undefined;
  binding: Record<string, string> | null | undefined;
  /** 无手选时：每人默认第 1 套 */
  fallbackCharacterIds?: string[] | null;
}): string[] {
  const sets = normalizeManhuaCharacterLookSets(opts.lookSets);
  const bind = opts.binding || {};
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lsId of Object.values(bind)) {
    const id = String(lsId || "").trim();
    if (!id || seen.has(id)) continue;
    if (!sets.some((s) => s.id === id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.length) return out;
  for (const cid of opts.fallbackCharacterIds || []) {
    const first = listManhuaLookSetsForCharacter(sets, cid)[0];
    if (first && !seen.has(first.id)) {
      seen.add(first.id);
      out.push(first.id);
    }
  }
  return out;
}

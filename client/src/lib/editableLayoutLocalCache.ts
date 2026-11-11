/**
 * 排版稿本机缓存（1111 瘦身）。
 *
 * 背景：旧版（v1）把整个稿件库完整写进 localStorage，1110 实测已 330 万字符（上限约 500 万），
 * 出现「浏览器保存失败」。新版（v2）以云端为准：本机只完整保存当前打开的稿，其他稿只留索引（id、标题、更新时间）。
 *
 * 老存档迁移：旧 key 里的完整库不能丢。只有确认云端已有同版本或更新版本、且本机没有未保存修改时才删除旧 key；
 * 否则旧 key 原样保留（继续作为完整底稿读取），直到一次云端保存成功后再删。
 */
import { editableLayoutSchema, layoutLibrarySchema, type EditableLayout, type LayoutLibrary } from "@shared/editableLayout";

export type LayoutCacheState = { library: LayoutLibrary; generation: string; dirty: boolean; activeId: string };
export type LayoutCacheIndexEntry = { id: string; title: string; updatedAt: string };
export type CompactLayoutCache = {
  version: 2;
  owner: string;
  generation: string;
  dirty: boolean;
  activeId: string;
  index: LayoutCacheIndexEntry[];
  /** 完整保存的稿：当前打开的稿 + 尚未与云端同步的稿（未打开任何稿且全部已同步时为空）。 */
  documents: EditableLayout[];
};

export const legacyLayoutCacheKey = (owner: string) => `mvstudiopro.editableLayout.v1.${owner}`;
export const compactLayoutCacheKey = (owner: string) => `mvstudiopro.editableLayout.v2.${owner}`;

/**
 * @param synced 最近一次与云端一致时各稿的 updatedAt（id → updatedAt）；与之不同或不在其中的稿视为未同步，完整保存。
 */
export function compactLayoutCache(state: LayoutCacheState, synced: ReadonlyMap<string, string> = new Map()): CompactLayoutCache {
  const active = state.library.documents.find(d => d.id === state.activeId);
  const documents = state.library.documents.filter(d => d.id === state.activeId || (state.dirty && synced.get(d.id) !== d.updatedAt));
  return {
    version: 2,
    owner: state.library.owner,
    generation: state.generation,
    dirty: state.dirty,
    activeId: active ? state.activeId : "",
    index: state.library.documents.map(d => ({ id: d.id, title: d.title, updatedAt: d.updatedAt })),
    documents,
  };
}

/** 读取 v2；账号、版本号或稿件结构不符一律视为不可用（返回 null，由调用方另存原文）。 */
export function parseCompactLayoutCache(raw: string, owner: string): CompactLayoutCache {
  const value = JSON.parse(raw);
  if (value?.version !== 2 || value.owner !== owner || !/^\d+$/.test(String(value.generation)))
    throw new Error("本机稿件账号或版本不匹配");
  const documents: EditableLayout[] = (Array.isArray(value.documents) ? value.documents : []).map((d: unknown) => editableLayoutSchema.parse(d));
  const index = Array.isArray(value.index) ? value.index.filter((e: any) => typeof e?.id === "string").map((e: any) => ({ id: e.id, title: String(e.title ?? ""), updatedAt: String(e.updatedAt ?? "") })) : [];
  const activeId = documents.some(d => d.id === value.activeId) ? String(value.activeId) : "";
  return { version: 2, owner, generation: String(value.generation), dirty: Boolean(value.dirty), activeId, index, documents };
}

/** 读取 v1 完整库（旧格式）。 */
export function parseLegacyLayoutCache(raw: string, owner: string): LayoutCacheState {
  const value = JSON.parse(raw);
  const library = layoutLibrarySchema.parse(value.library);
  if (library.owner !== owner || !/^\d+$/.test(value.generation)) throw new Error("本机稿件账号或版本不匹配");
  return { library, generation: value.generation, dirty: Boolean(value.dirty), activeId: "" };
}

const generationNumber = (generation: string) => { try { return BigInt(generation); } catch { return BigInt(-1); } };

/** 云端已有同版本或更新版本、且本机无未保存修改，才可删除旧完整库。 */
export function legacyCacheSafeToDrop(legacy: { generation: string; dirty: boolean }, cloud: { generation: string; hasLibrary: boolean }) {
  return !legacy.dirty && cloud.hasLibrary && generationNumber(cloud.generation) >= generationNumber(legacy.generation) && generationNumber(legacy.generation) >= BigInt(0);
}

/**
 * 云端读回后合并本机：
 * - 本机无未保存修改：完全以云端为准，仅保留上次打开的稿 id。
 * - 本机有未保存修改且版本一致：云端库 + 本机当前稿覆盖，仍标记未保存。
 * - 本机有未保存修改但云端版本不同：同样叠加本机当前稿，但保留本机旧版本号，使保存时触发冲突而不是覆盖云端新版。
 */
export function mergeCompactWithCloud(local: CompactLayoutCache, cloud: { library: LayoutLibrary | null; generation: string }, owner: string): { state: LayoutCacheState; conflict: boolean } {
  const base: LayoutLibrary = cloud.library || { version: 1, owner, documents: [] };
  if (!local.dirty || !local.documents.length)
    return { state: { library: base, generation: cloud.generation, dirty: false, activeId: "" }, conflict: false };
  let documents = base.documents;
  for (const doc of local.documents)
    documents = documents.some(d => d.id === doc.id) ? documents.map(d => d.id === doc.id ? doc : d) : [...documents, doc];
  const library = layoutLibrarySchema.parse({ ...base, documents });
  const conflict = cloud.generation !== local.generation;
  return { state: { library, generation: conflict ? local.generation : cloud.generation, dirty: true, activeId: local.activeId }, conflict };
}

/** 云端尚未读回时的临时状态：只有本机完整保存的稿，属于不完整库（调用方须禁止整库保存，以免覆盖云端其他稿）。 */
export function provisionalFromCompact(local: CompactLayoutCache, owner: string): LayoutCacheState {
  return { library: layoutLibrarySchema.parse({ version: 1, owner, documents: local.documents }), generation: local.generation, dirty: local.dirty, activeId: local.dirty ? local.activeId : "" };
}

/** 一份完整库各稿的 updatedAt（与云端一致时记录）。 */
export const syncedLayoutVersions = (library: LayoutLibrary) => new Map(library.documents.map(d => [d.id, d.updatedAt]));

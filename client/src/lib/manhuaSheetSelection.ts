/**
 * 本集设定图画廊的「多选集合」判据。
 *
 * 立此模块的原因（2026-08-23 实测缺陷）：设定图画廊一张卡都不能勾，
 * 唯一的批量入口是「重出本类」——批的是烧钱动作，而用户真正天天要批的是
 * 删除、改分类、设垫图用途。补多选就得有一套集合运算：单勾/全选本区/
 * 跨类计数/图被删后清幽灵勾/哪些能重出。
 *
 * 这些判据一旦内联进 6900 行的渲染里，下次加一类资产就会出现
 * 「全选本区把别区也选上了」「已选 3 项其实只剩 1 张」这种没人看得出的错。
 * 抽成纯函数，渲染与测试共用一处。
 */

export type ManhuaSheetSelectionItem = {
  /** 画廊 id：画布块是 `charsheet-xxx`，用户自传是 `charsheet-custom-<refId>` */
  id: string;
  kind: string;
  /**
   * 对应剧本锚点 id。只有系统按剧本出的设定图才有；
   * 用户自传的参考图没有——那是他自己的素材，不该被系统覆盖重出。
   */
  anchorId?: string;
};

/** 画廊里「我自传/自生成的参考图」的 id 形制，与 removeEpisodeGalleryItem 同一把尺 */
const CUSTOM_SHEET_ID_RE = /^(?:charsheet|sceneplate|propsheet)-custom-(.+)$/;

export function isManhuaCustomSheetId(id: string): boolean {
  return CUSTOM_SHEET_ID_RE.test(String(id || ""));
}

/** 取出自传参考图的真实 refId：改分类/设垫图用途的回调只认它，喂画廊 id 会静默无效 */
export function manhuaCustomSheetRefId(id: string): string | null {
  const m = CUSTOM_SHEET_ID_RE.exec(String(id || ""));
  return m?.[1] || null;
}

export function toggleManhuaSheetSelection(
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * 全选/取消本区：只动本区这批 id，别区的勾必须原样留着——
 * 用户经常先选完人物再去场景补两张，一按全选就把前面清了是灾难。
 */
export function setManhuaSheetSectionSelection(
  selected: ReadonlySet<string>,
  sectionIds: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of sectionIds) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** 本区是否已全选（空区不算全选，否则「取消本区」按钮会在没图的区里亮着） */
export function isManhuaSheetSectionAllSelected(
  selected: ReadonlySet<string>,
  sectionIds: readonly string[],
): boolean {
  if (!sectionIds.length) return false;
  return sectionIds.every((id) => selected.has(id));
}

/** 跨类计数：批量条要报「人物 3 · 场景 2」，不能只报一个总数让人猜选中了哪些 */
export function countManhuaSheetSelectionByKind(
  items: readonly ManhuaSheetSelectionItem[],
  selected: ReadonlySet<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (!selected.has(it.id)) continue;
    out[it.kind] = (out[it.kind] || 0) + 1;
  }
  return out;
}

/**
 * 清幽灵勾：图被删掉（或改分类后换了 id）之后，勾还留在集合里，
 * 批量条就会显示「已选 3 项」而实际只剩 1 张，点删除还会去删不存在的 id。
 */
export function pruneManhuaSheetSelection(
  selected: ReadonlySet<string>,
  items: readonly ManhuaSheetSelectionItem[],
): Set<string> {
  const next = new Set<string>();
  // 反过来遍历还活着的条目（而不是遍历勾选集合）：顺带把重复 id 也收敛掉
  for (const it of items) if (selected.has(it.id)) next.add(it.id);
  return next;
}

/** 只取当前还在画廊里的选中项（批量动作一律以它为准，不直接遍历 selected） */
export function selectedManhuaSheetItems(
  items: readonly ManhuaSheetSelectionItem[],
  selected: ReadonlySet<string>,
): ManhuaSheetSelectionItem[] {
  return items.filter((x) => selected.has(x.id));
}

export type ManhuaSheetBatchRegenPlan = {
  /** 真能送进 onRegenerateSheets 的剧本锚点；为空则不许出这个按钮 */
  anchorIds: string[];
  kind: string | null;
  /** 不能重出的原因（中文，直接给 title 用）；能重出时为 null */
  blockedReasonZh: string | null;
};

/**
 * 批量重出的可行性判据。
 *
 * 两条硬边界：
 * 1. 自传参考图不给重出——系统不覆盖用户自己的素材（与单卡「改这张」同一口径）。
 * 2. 重出弹框只带一个 role（决定「从库里挑」的候选池），所以一次只能同一类；
 *    跨类混选宁可拦下来说清楚，也不许偷偷只重出其中一类。
 */
export function resolveManhuaSheetBatchRegen(
  items: readonly ManhuaSheetSelectionItem[],
  selected: ReadonlySet<string>,
): ManhuaSheetBatchRegenPlan {
  const picked = selectedManhuaSheetItems(items, selected);
  if (!picked.length) return { anchorIds: [], kind: null, blockedReasonZh: "尚未勾选" };
  const eligible = picked.filter((x) => !isManhuaCustomSheetId(x.id) && Boolean(x.anchorId));
  if (!eligible.length) {
    return {
      anchorIds: [],
      kind: null,
      blockedReasonZh: "所选的图都是我自己上传的，系统不覆盖自传素材",
    };
  }
  // 混选（自传图 + 系统图）也要拦：放行只会静默重出系统那部分，
  // 用户以为 N 张都在重画、扣费与结果对不上——与跨类混选同一口径（审查 P1）。
  if (eligible.length !== picked.length) {
    const skipped = picked.length - eligible.length;
    return {
      anchorIds: [],
      kind: null,
      blockedReasonZh: `所选里有 ${skipped} 张是我自己上传的（系统不覆盖自传素材），请把它们取消勾选后再重出`,
    };
  }
  const kinds = Array.from(new Set(eligible.map((x) => x.kind)));
  if (kinds.length > 1) {
    return {
      anchorIds: [],
      kind: null,
      blockedReasonZh: "一次只能重出同一类（角色 / 场景 / 道具），请分开选",
    };
  }
  const anchorIds = Array.from(new Set(eligible.map((x) => String(x.anchorId))));
  return { anchorIds, kind: kinds[0] || null, blockedReasonZh: null };
}

/**
 * 「改分类 / 设垫图用途」只对自传参考图成立（画布出的设定图没有这两个字段）。
 * 混选时不给这两个按钮——放一个点了只对一半生效的下拉，比少一个按钮更糟。
 */
export function resolveManhuaSheetCustomRefIds(
  items: readonly ManhuaSheetSelectionItem[],
  selected: ReadonlySet<string>,
): { refIds: string[]; allCustom: boolean } {
  const picked = selectedManhuaSheetItems(items, selected);
  const refIds: string[] = [];
  for (const it of picked) {
    const refId = manhuaCustomSheetRefId(it.id);
    if (refId) refIds.push(refId);
  }
  return { refIds, allCustom: picked.length > 0 && refIds.length === picked.length };
}

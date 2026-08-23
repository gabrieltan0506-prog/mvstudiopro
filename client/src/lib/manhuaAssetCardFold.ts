/**
 * 资产卡折叠判据。
 *
 * 立此模块的原因：单张资产卡把数据模型的每个字段都摆成了一个控件——
 * 勾选 / ✕ / 改名 / 认领 / 清除认领 / 裁字 / 去字 / 四个分类 / 垫图用途，
 * 13 张卡全部平铺就是一屏一百多个可点的东西。
 * 用户原话：「太复杂跟繁琐，一点都不好用」。
 *
 * 判据写成函数导出，卡片与测试共用一处——展开与否这种事一旦在渲染里
 * 内联判断，下次加条件就会出现「这里展开了那里没展开」。
 */

export type ManhuaAssetCardFoldInput = {
  /** 简洁模式（全局，默认开）。关掉＝用户明确要看全部，卡片一律展开 */
  compactUi: boolean;
  /** 用户手动点开的卡 */
  expandedIds: ReadonlySet<string>;
  id: string;
  /**
   * 这张图需要人工确认（质检不过）。
   *
   * **强制展开**：折叠的前提是「收起来的都是低频操作」，
   * 而待确认是必须处理的事——收起来等于把问题藏了。
   */
  needsReview?: boolean;
};

export function isManhuaAssetCardExpanded(input: ManhuaAssetCardFoldInput): boolean {
  if (!input.compactUi) return true;
  if (input.needsReview) return true;
  return input.expandedIds.has(input.id);
}

/**
 * 折叠态下卡面仍要显示分类，否则用户分不清这张是人物还是场景。
 * 展开时由分类按钮组接管，不重复显示。
 */
export function shouldShowManhuaAssetRoleChip(expanded: boolean): boolean {
  return !expanded;
}

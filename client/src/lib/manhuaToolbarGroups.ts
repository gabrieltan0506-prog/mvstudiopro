/**
 * 工作台顶部工具条的分组判据。
 *
 * 线上实测：整屏可见按钮 228 个，顶部工具条占 18 个，全部平铺在一行里，
 * **花钱的和不花钱的肩并肩** —— 「生成关键静帧」紧挨着「对齐画布竖排」。
 *
 * 这不只是「看着乱」：本仓有过误点烧掉一整批积分的事故
 * （「生成全部」曾清掉 18 张已生成图），所以才有了双重确认 + 强制等 5 秒。
 * 双重确认拦的是点下去之后，**分组拦的是点错本身**。
 *
 * 判据收口在这里：分组规则散在 JSX 的 className 里，
 * 下次加按钮必然又混进错误的那一堆。
 */

export type ManhuaToolbarActionCost = "spend" | "free";

/**
 * 顶部工具条**当前真实使用**的全部动作及其成本语义。
 *
 * 上一版是「花钱名单 + 未知一律 free」，栽了两处：
 *   · 登记了 `confirm-stills-generate-all` / `regenerate-all-shots`
 *     —— **这两个 ID 全仓零处存在**，是照按钮文案编的
 *   · 漏了真花钱的 `generate-selected-fragments`（调 onGenerateMissingFragments）
 *     和 `rerun-keyarts`（调 onRerunKeyartsFromReverse）
 * 于是两个真花钱的按钮拿不到暖色圈，而两个不存在的 ID 白占名单。
 *
 * 改成**封闭映射**：新增按钮不登记就过不了类型检查，
 * 「未知默认 free」这条静默漏标的路被堵死。
 */
export const MANHUA_TOOLBAR_ACTION_COST = {
  "generate-all-keyarts": "spend",
  "review-clip-prompts": "free",
  "generate-fragment": "spend",
  "layout-readable-chain": "free",
  "generate-selected-fragments": "spend",
  "generate-missing-fragments": "spend",
  "rerun-keyarts": "spend",
} as const satisfies Record<string, ManhuaToolbarActionCost>;

export type ManhuaToolbarAction = keyof typeof MANHUA_TOOLBAR_ACTION_COST;

/**
 * 这个动作会不会花钱。
 *
 * 入参是封闭联合类型 —— 传没登记的 ID 在编译期就报错，不会静默当成 free。
 */
export function manhuaToolbarActionCost(
  action: ManhuaToolbarAction,
): ManhuaToolbarActionCost {
  return MANHUA_TOOLBAR_ACTION_COST[action];
}

/** 派生，不再手写第二份名单 */
export const MANHUA_TOOLBAR_SPEND_ACTIONS = (
  Object.entries(MANHUA_TOOLBAR_ACTION_COST) as Array<
    [ManhuaToolbarAction, ManhuaToolbarActionCost]
  >
)
  .filter(([, cost]) => cost === "spend")
  .map(([action]) => action);

/**
 * 成本语义与视觉收纳分开：本文件只判断会不会产生调用；工作台把低频控件
 * 收进「更多操作」，但所有生成动作仍读取这里的同一份成本标记。
 */

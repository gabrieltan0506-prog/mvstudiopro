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

/** 会消耗积分/上游额度的动作 */
export const MANHUA_TOOLBAR_SPEND_ACTIONS = [
  "generate-all-keyarts",
  "generate-fragment",
  "generate-missing-fragments",
  "confirm-stills-generate-all",
  "regenerate-all-shots",
] as const;

export type ManhuaToolbarActionCost = "spend" | "free";

/**
 * 这个动作会不会花钱。
 *
 * 用于给按钮打 `data-manhua-action-cost`，并据此上不同的视觉分组——
 * 花钱的归花钱的一堆，排版/开关归另一堆，中间留一道分隔。
 */
export function manhuaToolbarActionCost(action: string): ManhuaToolbarActionCost {
  return (MANHUA_TOOLBAR_SPEND_ACTIONS as readonly string[]).includes(action)
    ? "spend"
    : "free";
}

/**
 * ⚠️ 这里**不做折叠**。
 *
 * 低频控件的显隐已经由既有的 `compactUi`（简洁模式，默认开）在管，
 * 再加一套「更多」就是同一件事两套机制——用户要先想「这个东西是被
 * 简洁模式收走了还是被更多收走了」。分组只管「会不会花钱」这一件事。
 */

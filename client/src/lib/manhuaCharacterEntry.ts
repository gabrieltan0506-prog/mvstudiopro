/**
 * 资产抽屉（角色库 / 资产墙）的入口去重判据。
 *
 * 线上实测同屏有三个入口，全部指向同一个 `setManhuaAssetDrawer("characters")`：
 *   ① 顶部工具条「角色库」    —— 全阶段常驻（简洁模式下隐藏）
 *   ② 资产阶段「去选人物 / 更换人物」—— 就在人物卡片旁边
 *   ③ CastStrip「打开角色库」  —— 只在非工作台模式或未确认编剧时
 *
 * 用户原话：「太复杂跟繁琐」。三个按钮同一个去处，用户得先想「点哪个」，
 * 这是纯增的决策成本。
 *
 * 但**不能直接删工具条那个**：分镜与剪辑阶段没有资产区块，
 * 删了就砍掉了那两个阶段的唯一通路。正确做法是按上下文露出——
 * 就近的入口在场时，远处的那个让位。
 *
 * 判据收口在这里：规则散在 JSX 里，必然再长出第四个入口。
 */

/**
 * 资产阶段自带就近入口（人物卡旁边的「去选人物 / 更换人物」），
 * 此时工具条那个远端入口让位；其它阶段没有就近入口，工具条必须留着。
 *
 * 依据用户 0811 立的四问之一「动作离对象多远（零位移）」：
 * 就近的永远优先，远端的只在没有就近入口时补位。
 */
export function shouldShowToolbarAssetDrawerEntry(input: {
  activePhase: string;
  /** 简洁模式下工具条本就收起低频控件 */
  compactUi: boolean;
}): boolean {
  if (input.compactUi) return false;
  return input.activePhase !== "assets";
}

/**
 * 角色库入口（工具条）。与资产墙同一条规则，共用一个判据——
 * 两处各写一份 `activePhase !== "assets"`，下次改规则必漏一处。
 */
export const shouldShowToolbarCharacterLibraryEntry = shouldShowToolbarAssetDrawerEntry;

/**
 * 资产墙入口（工具条）。资产阶段的就近入口有 5 个之多
 * （「库场景·道具」「更换」「尚未选场景·点此更换」等），远端这个纯属多余。
 */
export const shouldShowToolbarAssetWallEntry = shouldShowToolbarAssetDrawerEntry;

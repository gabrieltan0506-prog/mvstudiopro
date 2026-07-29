/**
 * 资产回收入公有库（自动 · 去名匿名）。
 *
 * 产品口径（用户定 2026-07-29）：
 * - 生成完成的人物/场景/道具设定图 → 自动去掉剧本专名 → 匿名收录进平台公有参考库，供他人直接复用/融图。
 * - 半成品（生成失败 / 无成品图）→ 自动踢除，不入库。
 * - 换稿判「过期」的旧图仍是完整成品，属于回收对象（去名后进库正是其复用价值），不当半成品踢。
 * - 用户手动上传的参考图默认不自动入库（尊重来源版权）。
 *
 * 与 `manhuaAssetSharePricing` 分工：本模块只判定「入库 / 踢除 / 去名」，
 * 计价（生成侧半价、消费侧 1张15/2张20）在定价模块。
 */

export type ManhuaAssetRecycleRole = "character" | "scene" | "prop";

export type ManhuaAssetRecycleInput = {
  /** 是否已生成出成品图（有可用 imageUrl） */
  hasImage: boolean;
  /** 用户手动上传的参考（非平台生成）→ 不自动入库 */
  isUpload?: boolean;
};

export type ManhuaAssetRecycleDecision = {
  /** 去名后匿名收录进公有库 */
  recycle: boolean;
  /** 半成品：应从画布/队列踢除清理 */
  purge: boolean;
  reasonZh: string;
};

/**
 * 自动回收准入判定。
 * - 无成品图 → 半成品，踢除、不入库。
 * - 上传参考 → 保留但不自动入库。
 * - 平台生成的完整成品（含换稿过期图）→ 去名回收进公有库。
 */
export function decideManhuaAssetRecycle(
  input: ManhuaAssetRecycleInput,
): ManhuaAssetRecycleDecision {
  if (!input.hasImage) {
    return { recycle: false, purge: true, reasonZh: "半成品（无成品图）·自动踢除，不入库" };
  }
  if (input.isUpload) {
    return { recycle: false, purge: false, reasonZh: "手动上传参考·保留但不自动入库" };
  }
  return { recycle: true, purge: false, reasonZh: "完整成品·去名后匿名回收进公有库" };
}

const RECYCLE_FALLBACK_LABEL_ZH: Record<ManhuaAssetRecycleRole, string> = {
  character: "角色参考",
  scene: "场景参考",
  prop: "道具参考",
};

/** 去名时会连同专名一起清掉的连接符/前后缀标点 */
const NAME_JOINER_RE = /[·・\-—–_/｜|、，,。.:：;；\s]+/g;

/**
 * 去掉剧本专名，产出可公开的匿名通用标签。
 *
 * 做法：从原标签里逐个抹掉传入的专名（角色名/场景名/道具名），
 * 保留其余通用描述（如「冷峻青年剑客」「古风客栈·夜」）。
 * 抹净后为空 → 按角色回退到通用兜底标签，绝不泄漏专名。
 */
export function anonymizeManhuaLibraryLabelZh(
  labelZh: string | null | undefined,
  properNames: readonly string[],
  role: ManhuaAssetRecycleRole,
): string {
  let out = String(labelZh || "").trim();
  const names = (properNames || [])
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 2)
    // 长名先抹，避免短名先抹留下残片
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (!name) continue;
    out = out.split(name).join(" ");
  }
  out = out.replace(NAME_JOINER_RE, " ").trim();
  // 收尾清掉可能残留的空描述
  if (!out || out.length < 2) return RECYCLE_FALLBACK_LABEL_ZH[role];
  return out.slice(0, 80);
}

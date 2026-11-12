/**
 * 小说工作台 · 各环节价格（积分），前台显示与服务端扣费同读这一处。
 *
 * 口径（只用站长已定的数字，不另起一套）：
 * - 每次调用创作服务按所选线路档位收费：线路一（优秀）10 / 线路二（完美）5 / 线路三（卓越）限时 20、之后 40，
 *   真源 NOVEL_ADVISOR_TIER_OPTIONS + resolveNovelAdvisorTierPrice。「自动」按线路一档位计。
 * - 审稿改稿 = 审稿一次 + 改稿一次，各按各自线路计；只审稿 / 按所选意见改稿只收对应的一次。
 * - 爆款仿写：底稿拆解每次 NOVEL_IMITATION_SKELETON_CREDITS；仿写每集不低于 NOVEL_IMITATION_EPISODE_CREDITS。
 * - 创意环节（前两次免费、第三次起 20）由 novelCreativePremise 单独计，这里返回 0。
 */
import { NOVEL_IMITATION_EPISODE_CREDITS, NOVEL_IMITATION_SKELETON_CREDITS } from "./novelImitation";
import {
  NOVEL_ADVISOR_TIER_OPTIONS,
  novelRevisePreference,
  resolveNovelAdvisorTierPrice,
  type NovelTestInput,
} from "./novelWorkspace";

type Preference = NovelTestInput["modelPreference"];

/** 某条线路在 now 时刻的单次价格；「自动」/ 缺省按线路一档位。 */
export function novelLaneCredits(preference: Preference, now: Date | number = Date.now()) {
  const lane = !preference || preference === "auto" ? "glm" : preference;
  const tier = NOVEL_ADVISOR_TIER_OPTIONS.find(option => option.value === lane);
  if (!tier) throw new Error(`未知线路：${lane}`);
  return resolveNovelAdvisorTierPrice(tier, now).credits;
}

export type NovelStepBillingInput = Pick<
  NovelTestInput,
  | "stage"
  | "advisorIntent"
  | "modelPreference"
  | "reviewModelPreference"
  | "rewriteModelPreference"
  | "reviseMode"
  | "reviewOverride"
> & { imitation?: unknown };

/** 一次工作台请求的价格；创意环节返回 0（另有计次规则）。 */
export function novelStepCredits(input: NovelStepBillingInput, now: Date | number = Date.now()) {
  if (input.stage === "advice" && input.advisorIntent === "creative_premises") return 0;
  if (input.stage === "revise") {
    const review = novelLaneCredits(novelRevisePreference(input, "review"), now);
    const revise = novelLaneCredits(novelRevisePreference(input, "revise"), now);
    if (input.reviseMode === "review_only") return review;
    if (input.reviewOverride) return revise;
    return review + revise;
  }
  const lane = novelLaneCredits(input.modelPreference, now);
  if (input.stage === "chapter" && input.imitation) return Math.max(NOVEL_IMITATION_EPISODE_CREDITS, lane);
  return lane;
}

/** 底稿结构拆解每次的价格（同一底稿 + 线路命中缓存不再收）。 */
export function novelImitationSkeletonCredits() {
  return NOVEL_IMITATION_SKELETON_CREDITS;
}

export const NOVEL_STEP_CHARGE_ACTION = "novelWorkspaceStep";
export const NOVEL_STEP_NEED_CREDITS = (credits: number) => `本次需要 ${credits} 积分，余额不足，请充值后再提交`;
export const NOVEL_STEP_UNPAID = "积分不足，本次结果未交付，请充值后重新提交";
export const NOVEL_STEP_COST_LABEL = (credits: number) => `本次 ${credits} 积分`;

export function novelStepChargeKey(userId: number, requestId: string) {
  return `novel-step:${userId}:${requestId}`;
}

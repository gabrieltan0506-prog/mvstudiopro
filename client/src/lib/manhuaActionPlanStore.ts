/**
 * 动作计划本机存储（PR-2）：与导演板 overlay 同款——OmniCanvas 是唯一状态源，
 * 这里只负责 localStorage 往返与规范化；云草稿走 shared/manhuaCloudDraft 顶层 manhuaActionPlans。
 *
 * 键 = String(episodeIndex)。读回时不合合同的条目**不静默删**：留在 warnings 里由 UI 提示。
 */
import { sanitizeManhuaActionPlans } from "@shared/manhuaCloudDraft";
import type { ManhuaActionPlan } from "@shared/manhuaActionPlan";

const LS_KEY = "mv-manhua-action-plans-v1";

export type ManhuaActionPlansByEpisode = Record<string, ManhuaActionPlan>;

export type ManhuaActionPlanLoadResult = {
  plans: ManhuaActionPlansByEpisode;
  warnings: Array<{ episodeKey: string; messageZh: string }>;
};

export function normalizeManhuaActionPlans(raw: unknown): ManhuaActionPlanLoadResult {
  const r = sanitizeManhuaActionPlans(raw);
  return { plans: r.plans ?? {}, warnings: r.warnings };
}

export function loadManhuaActionPlans(): ManhuaActionPlanLoadResult {
  try {
    if (typeof window === "undefined") return { plans: {}, warnings: [] };
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { plans: {}, warnings: [] };
    return normalizeManhuaActionPlans(JSON.parse(raw));
  } catch {
    return { plans: {}, warnings: [] };
  }
}

export function saveManhuaActionPlans(plans: ManhuaActionPlansByEpisode): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (!Object.keys(plans).length) {
      window.localStorage.removeItem(LS_KEY);
      return true;
    }
    window.localStorage.setItem(LS_KEY, JSON.stringify(plans));
    return true;
  } catch {
    return false;
  }
}

export function manhuaActionPlanForEpisode(
  plans: ManhuaActionPlansByEpisode | null | undefined,
  episodeIndex: number,
): ManhuaActionPlan | null {
  return plans?.[String(Math.max(1, Math.floor(episodeIndex) || 1))] ?? null;
}

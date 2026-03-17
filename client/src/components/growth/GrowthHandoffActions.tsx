import type { GrowthHandoff, GrowthPlanStep } from "@shared/growth";

type GrowthHandoffActionsProps = {
  handoff: GrowthHandoff | null;
  growthPlan: GrowthPlanStep[];
  fallbackBrief: string;
  onCopyText: (text: string, successMessage: string) => Promise<void> | void;
  onStoreHandoff: (handoff: GrowthHandoff | null, successMessage?: string) => void;
};

export function GrowthHandoffActions({
  handoff,
  growthPlan,
  fallbackBrief,
  onCopyText,
  onStoreHandoff,
}: GrowthHandoffActionsProps) {
  const executionBrief = handoff?.brief || fallbackBrief;
  const growthPlanText = growthPlan
    .map((item) => `Day ${item.day} - ${item.title}: ${item.action}`)
    .join("\n");

  return (
    <div className="mt-4 grid gap-3">
      <button
        onClick={() => void onCopyText(executionBrief, "创作简报已复制")}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:bg-white/10"
      >
        复制执行简报
      </button>
      <button
        onClick={() => void onCopyText(growthPlanText, "7 天增长规划已复制")}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:bg-white/10"
      >
        复制 7 天增长规划
      </button>
      <button
        onClick={() => void onCopyText(handoff?.storyboardPrompt || fallbackBrief, "创作画布提示词已复制")}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:bg-white/10"
      >
        复制创作画布提示词
      </button>
      <button
        onClick={() => void onCopyText(handoff?.workflowPrompt || fallbackBrief, "工作流提示词已复制")}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:bg-white/10"
      >
        复制工作流提示词
      </button>
      <button
        onClick={() => void onCopyText(JSON.stringify(handoff, null, 2), "growth handoff JSON 已复制")}
        disabled={!handoff}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        复制 handoff JSON
      </button>
      <button
        onClick={() => onStoreHandoff(handoff, "growth handoff 已暂存到本地")}
        disabled={!handoff}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        暂存 handoff 到本地
      </button>
    </div>
  );
}

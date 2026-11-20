/**
 * 手册「总体进度」的显示状态（站长 2026-11-21）：
 * - 只要图片：图片出完即 100%。
 * - 要排版：同一条进度条接着显示排版进度，排版全部完成才到 100%。
 * - 图片出完、尚未选择：停在图片完成的位置并说明在等选择，不提前显示 100%。
 * 只推导显示，不改写出图流程自己的进度状态。
 */
import type { KnowledgeCardProgressState } from "@/components/platform/KnowledgeCardProgress";
import { knowledgeStageProgress, type KnowledgePublicationStage } from "./knowledgePublicationStage";

export type KnowledgeLayoutDecision = "not_applicable" | "pending" | "layout" | "images_only";
/** 选排版时出图占总体进度的前 70%，排版占后 30%。 */
export const KNOWLEDGE_IMAGES_DONE_PERCENT = 70;

export function knowledgeHandbookOverallProgress(input: {
  base: KnowledgeCardProgressState;
  decision: KnowledgeLayoutDecision;
  stage: KnowledgePublicationStage | null;
  layoutError?: string | null;
  layoutStopped?: boolean;
}): KnowledgeCardProgressState {
  const { base, decision, stage } = input;
  // 出图未成功收口（进行中、失败、已停止）或不涉及排版选择：原样显示。
  if (decision === "not_applicable" || base.status !== "succeeded") return base;
  if (decision === "images_only") return { ...base, status: "succeeded", percent: 100 };
  if (decision === "pending")
    return { status: "running", percent: KNOWLEDGE_IMAGES_DONE_PERCENT, label: "图片已全部完成，等待选择是否排版成册" };
  const progress = knowledgeStageProgress(stage);
  const percent = KNOWLEDGE_IMAGES_DONE_PERCENT + Math.round(((100 - KNOWLEDGE_IMAGES_DONE_PERCENT) * (progress?.percent ?? 0)) / 100);
  if (input.layoutError)
    return { status: input.layoutStopped ? "stopped" : "failed", percent, label: `排版成册 · ${progress?.stepName ?? "准备中"}`, error: input.layoutError };
  if (progress?.finished) return { status: "succeeded", percent: 100, label: "排版成册已完成" };
  return {
    status: "running", percent,
    label: `排版成册 · ${progress?.stepName ?? "准备中"}`,
    ...(progress ? { stepNumber: progress.stepNumber, stepTotal: progress.stepTotal } : {}),
    ...(progress?.stepCount ? { stageDone: progress.stepDone, stageTotal: progress.stepCount } : {}),
  };
}

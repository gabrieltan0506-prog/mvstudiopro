/**
 * 将上传素材分析结果整理为「拍摄手法」摘要，供 2×4 / 3×4 分镜与封面生图注入。
 */

import type { GrowthAnalysisScores } from "./growth";

/** 线下课/实操教学类画面的常用机位参考（固定中远景 + 前景操作物 + 背景大屏），作弱提示而非硬套。 */
export const TEACHING_DEMO_COMPOSITION_HINTS = [
  "教学/实操演示优先：固定中远景机位，主体偏画面一侧，前景保留手机/支架/道具操作区，背景可含大屏或投影同步界面。",
  "构图干净稳定，便于观众同时看清讲师动作与屏幕内容；避免频繁晃动与过密特写打断流程。",
  "分镜节奏可对齐：入口找功能区 → 预览区与时间轴关系 → 输入/确认回流 → 时间轴多层管理 → 导出前总检。",
].join(" ");

export function formatShootingTechniqueBrief(
  analysis: GrowthAnalysisScores | null | undefined,
  opts?: { maxChars?: number; includeTeachingHints?: boolean },
): string {
  if (!analysis) return "";
  const maxChars = opts?.maxChars ?? 2800;
  const lines: string[] = [];

  const scores = [
    Number.isFinite(analysis.composition) ? `构图 ${analysis.composition}` : "",
    Number.isFinite(analysis.lighting) ? `光影 ${analysis.lighting}` : "",
    Number.isFinite(analysis.color) ? `色彩 ${analysis.color}` : "",
    Number.isFinite(analysis.impact) ? `冲击力 ${analysis.impact}` : "",
  ].filter(Boolean);
  if (scores.length) lines.push(`【视觉评分】${scores.join(" · ")}`);

  if (analysis.visualSummary?.trim()) {
    lines.push(`【画面摘要】${analysis.visualSummary.trim()}`);
  }
  if (analysis.cameraEmotionTension?.trim()) {
    lines.push(`【镜头情绪张力】${analysis.cameraEmotionTension.trim()}`);
  }
  if (analysis.languageExpression?.trim()) {
    lines.push(`【语言表达】${analysis.languageExpression.trim()}`);
  }

  const remix = analysis.remixExecution;
  if (remix?.shootingGuidance?.trim()) {
    lines.push(`【拍摄指导】${remix.shootingGuidance.trim()}`);
  }
  const bp = remix?.shootingBlueprint;
  if (bp) {
    const bits = [
      bp.shotSize?.trim() ? `景别：${bp.shotSize.trim()}` : "",
      bp.lighting?.trim() ? `布光：${bp.lighting.trim()}` : "",
      bp.blocking?.trim() ? `走位：${bp.blocking.trim()}` : "",
      bp.cameraPerformance?.trim() ? `运镜表演：${bp.cameraPerformance.trim()}` : "",
      bp.emotionalTension?.trim() ? `情绪张力：${bp.emotionalTension.trim()}` : "",
    ].filter(Boolean);
    if (bits.length) lines.push(`【拍摄蓝图】\n${bits.join("\n")}`);
    if (Array.isArray(bp.storyboard) && bp.storyboard.length > 0) {
      const frames = bp.storyboard
        .slice(0, 8)
        .map((f, i) => `${i + 1}. ${String(f).trim()}`)
        .filter((line) => line.length > 3);
      if (frames.length) lines.push(`【参考分镜】\n${frames.join("\n")}`);
    }
  }

  const textBlob = [
    analysis.visualSummary,
    analysis.summary,
    remix?.shootingGuidance,
    bp?.blocking,
    bp?.shotSize,
  ]
    .filter(Boolean)
    .join(" ");
  const looksLikeTeaching =
    opts?.includeTeachingHints !== false &&
    /教学|实操|线下课|讲师|演示|手机剪辑|时间轴|支架|大屏|投影|salon|tutorial/i.test(textBlob);
  if (looksLikeTeaching) {
    lines.push(`【教学演示构图参考】${TEACHING_DEMO_COMPOSITION_HINTS}`);
  }

  return lines.join("\n\n").trim().slice(0, maxChars);
}

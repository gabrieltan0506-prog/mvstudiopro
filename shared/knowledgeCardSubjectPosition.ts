/**
 * 知识卡主体位置（2026-09-08 用户拍板）：横版 16:9 固定，主体可选「偏左」或「居中」。
 * 旧记录缺失或非法时回落偏左（与用户验收样张一致）。
 */
export const KNOWLEDGE_CARD_SUBJECT_POSITIONS = ["left", "center"] as const;
export type KnowledgeCardSubjectPosition = (typeof KNOWLEDGE_CARD_SUBJECT_POSITIONS)[number];
export const KNOWLEDGE_CARD_DEFAULT_SUBJECT_POSITION: KnowledgeCardSubjectPosition = "left";

export function resolveKnowledgeCardSubjectPosition(value?: unknown): KnowledgeCardSubjectPosition {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "center" ? "center" : "left";
}

export const KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH: Record<KnowledgeCardSubjectPosition, string> = {
  left: "主体偏左",
  center: "主体居中",
};

/** 出图提示词尾段：画幅与主体位置的最终约束，覆盖模板自带的构图位置。 */
export function buildKnowledgeCardSubjectPositionPrompt(value?: unknown): string {
  const position = resolveKnowledgeCardSubjectPosition(value);
  const zh = position === "left"
    ? "主体放在画面左侧约三分之一；右侧约三分之二安排清晰分栏的知识内容。主体与文字分区，不遮挡文字。"
    : "主体居中，知识内容在主体两侧对称或均衡分栏；主体适度收小，不挤压文字区。";
  const en = position === "left"
    ? "Place the main visual subject on the LEFT third, with readable knowledge text modules on the RIGHT two thirds."
    : "CENTER the main visual subject; arrange readable knowledge text modules in balanced columns on BOTH SIDES.";
  return `【知识卡画幅与主体位置·最终约束】全部使用横版16:9画幅，保留高密度知识文字区域；此约束覆盖模板自带的主体位置。${zh}\nLANDSCAPE 16:9 canvas. ${en} Preserve all page content and keep every glyph clear.`;
}

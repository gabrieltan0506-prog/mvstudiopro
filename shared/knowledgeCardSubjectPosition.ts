/** 主体位置不改变画幅：所有知识卡固定横版16:9。 */
export const KNOWLEDGE_CARD_SUBJECT_POSITIONS = ["left", "center"] as const;
export type KnowledgeCardSubjectPosition = (typeof KNOWLEDGE_CARD_SUBJECT_POSITIONS)[number];

/** 旧记录省略位置时沿用左侧；显式未知值不得静默回退。 */
export function resolveKnowledgeCardSubjectPosition(value?: unknown): KnowledgeCardSubjectPosition {
  if (value === undefined) return "left";
  if (value === "left" || value === "center") return value;
  throw new Error("主体位置无效，请选择左侧或居中");
}

/** 只转换知识卡消费的模板副本，不改变其他产品的竖版模板。 */
export function knowledgeCardLandscapeTemplatePrompt(prompt: string): string {
  return prompt.replace(/3\s*[:：]\s*4/g, "16:9")
    .replace(/竖版|竖向画幅/g, "横版")
    .replace(/\bvertical\s+(infographic|poster|canvas|layout|format|orientation)\b/gi, "landscape $1")
    .replace(/portrait\s+(orientation|canvas|layout|format)/gi, "landscape $1");
}

export function buildKnowledgeCardSubjectPositionPrompt(value?: unknown): string {
  const position = resolveKnowledgeCardSubjectPosition(value);
  return `【知识卡画幅与主体位置·最终约束】全部使用横版16:9画幅，保留高密度知识文字区域；此约束覆盖模板自带的主体位置。${position === "left"
    ? "主体放在画面左侧约三分之一；右侧约三分之二安排清晰分栏的知识内容。主体与文字分区，不遮挡文字。"
    : "主体居中，知识内容在主体两侧对称或均衡分栏；主体适度收小，不挤压文字区。"}
LANDSCAPE 16:9 canvas. ${position === "left" ? "Place the main visual subject on the LEFT third, with readable knowledge text modules on the RIGHT two thirds." : "CENTER the main visual subject; arrange readable knowledge text modules in balanced columns on BOTH SIDES."} Preserve all page content and keep every glyph clear.`;
}

/** 独立图文页只使用当前页内容，系列约束不作为正文印刷。 */
export function buildViralGraphicPagePrompt(input: { content: string; pageIndex?: number; pageTotal?: number; visualBrief?: string; hasPortrait: boolean }): string {
  if (!input.content.trim()) throw new Error("图文页正文不能为空");
  return `生成一张独立可发布的小红书图文笔记正文图片，竖版9:16。此图是系列第${input.pageIndex ?? 1}/${input.pageTotal ?? 1}页，只呈现本页内容，不生成拼图、分镜格子、联系表或其他页面。\n以与本页内容相符的人物、真实生活场景、可见动作或物件为主体，清晰大标题与简洁正文排版；不要整页小字或纯文字海报。只使用简体中文，不新增统计、承诺、客户故事、联系方式。\n${input.hasPortrait ? "参考照片仅用于人物身份：人物面部辨识度与参考保持一致；服装按系列视觉要求设计，未指定时沿用参考服装，姿态表情可按本页内容自然变化。不要复制照片背景。" : "人物与场景服从系列视觉要求。"}\n【仅供画面设计的系列要求，不得印成正文】\n${input.visualBrief?.trim() || "自然职场摄影质感，统一人物与配色。"}\n【本页必须完整表达的读者内容】\n${input.content.trim()}\n【边界】不要擅自将本页正文切到别页，不要印出内部提示词、制作步骤或上述标签。`;
}

import { listInfographicTemplatesByMode, getInfographicNoteTemplate } from "./infographicNoteTemplates";

/** 与知识卡选择器第一组同源；后续组保留历史定义，但不参与本次新选版。 */
export const knowledgePublicationTemplates = (listInfographicTemplatesByMode()[0]?.items || []).map(t => ({
  id: t.id, label: t.labelZh, description: t.blurbZh, mode: t.heroMode,
}));
export const KNOWLEDGE_TEMPLATE_SELECTION_MARKER = "【按内容自动匹配现有特色模板】";
export const KNOWLEDGE_TEMPLATE_SELECTION_INSTRUCTIONS = `${KNOWLEDGE_TEMPLATE_SELECTION_MARKER}
必须在每页reading增加templateId和templateReason：从下列现有模板中选择最契合本页真实内容、知识关系、配图色调与信息密度的一款，并用简短中文说明具体理由。不同章节可以不同，不要每页无理由固定同一款。候选标签与描述只用于风格选择，不是知识正文，也不要求生成模板中的人物、山水或物件。保留原图，不能借模板更换主题或捏造关系。
只允许使用第一组人景物融合模板；不能选择结构层解构、拆解标注、时间轴、枢纽或左右对比模板。根据正文主题、人物气质和叙事情境选择融合构图，选择理由须说明人物与内景如何契合；不把换颜色、边框或普通表格描述成已实现模板构图。不要为了特色牺牲知识完整性和可读性。只输出候选中存在的templateId，不输出CSS或HTML。templateReason是给用户看的选版理由，不包含模型、通道或内部术语。
候选：${JSON.stringify(knowledgePublicationTemplates)}`;

/** 用户明确指定优先；无指定时采用该页实际模型选择，旧稿不伪造选择回执。 */
export function resolveKnowledgePublicationTemplate(manual?: string, automatic?: string) {
  const id = manual || automatic;
  if (!id || !knowledgePublicationTemplates.some(t => t.id === id)) return null;
  return getInfographicNoteTemplate(id);
}

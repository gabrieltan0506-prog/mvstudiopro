import { planKnowledgeCardPages } from "./knowledgeCardPagination";
import type { LayoutSource } from "./editableLayout";

// 复用实际出图分页；缺图保留原页位置，不将后页配图前移。
export function knowledgeCardLayoutSource(input: {
  owner: string;
  sourceId: string;
  markdown: string;
  distillModel?: string;
  detailLevel?: "concise" | "full";
  infographicTemplateId?: string | null;
  images: readonly string[];
}): LayoutSource {
  const plan = planKnowledgeCardPages(input.markdown, input.distillModel);
  if (!plan.pages.length) throw new Error("请先恢复或填写手册正文");
  if (input.images.length && input.images.length !== plan.pages.length)
    throw new Error("原成品页数与当前分页不一致，未导入错配图片；请先恢复对应成品");
  const images: Record<number, string> = {};
  input.images.forEach((url, index) => { if (url) images[index + 1] = url; });
  const title = input.markdown.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").trim() || "图文知识手册";
  return {
    kind: "knowledge-publication",
    detailLevel: input.detailLevel,
    infographicTemplateId: input.infographicTemplateId || undefined,
    owner: input.owner,
    sourceId: input.sourceId,
    title,
    body: input.markdown,
    pages: plan.pages.map((body, index) => ({
      pageIndex: index + 1,
      headline: body.match(/^##\s+(.+)$/m)?.[1] || `${title} · 第 ${index + 1} 页`,
      body,
    })),
    images,
  };
}

/** 全文和配图分别保留稳定章节；精华配图绝不冒充完整文字底稿。 */
export function synchronizedKnowledgeCardSource(input: {
  owner: string; sourceId: string; fullMarkdown: string; illustrationMarkdown: string;
  detailLevel: "concise" | "full"; distillModel?: string;
  infographicTemplateId?: string | null; imageJobIds: readonly string[];
}): LayoutSource {
  if (!input.fullMarkdown.trim()) throw new Error("缺少完整版文字底稿，请先恢复完整稿；尚未开始出图或整理");
  const reading = knowledgeCardLayoutSource({ ...input, markdown: input.fullMarkdown, images: [] });
  const illustrations = planKnowledgeCardPages(input.illustrationMarkdown, input.distillModel).pages;
  if (!illustrations.length || illustrations.length !== input.imageJobIds.length || new Set(input.imageJobIds).size !== input.imageJobIds.length)
    throw new Error("配图任务与原稿页数不一致，尚未开始生成");
  const textPages = reading.pages!.map(p => ({ ...p, knowledgeRole: "reading" as const }));
  return { ...reading, detailLevel: input.detailLevel, pages: [
    ...textPages,
    ...illustrations.map((body, i) => ({
      pageIndex: textPages.length + i + 1,
      headline: `配图 ${i + 1}｜${body.match(/^##\s+(.+)$/m)?.[1] || reading.title}`,
      body, imageJobId: input.imageJobIds[i], knowledgeRole: "illustration" as const,
    })),
  ] };
}

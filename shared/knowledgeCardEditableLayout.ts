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
  if (!plan.pages.length) throw new Error("请先恢复或填写知识卡正文");
  if (input.images.length && input.images.length !== plan.pages.length)
    throw new Error("原成品页数与当前分页不一致，未导入错配图片；请先恢复对应成品");
  const images: Record<number, string> = {};
  input.images.forEach((url, index) => { if (url) images[index + 1] = url; });
  const title = input.markdown.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").trim() || "知识卡排版稿";
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

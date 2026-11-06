import { knowledgeImageMayRetry } from "../../shared/knowledgeImageRetry";
import { planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
import type { KnowledgeSource, KnowledgePublication } from "../../shared/knowledgePublication";
import { getJobByIdStrict } from "../jobs/repository";
import { getGcsBucketName } from "./gcs";
import { resolveRegisteredPostProdMediaSource, loadSucceededJobOutputSources } from "./postProdMediaSource";

/** 只读取已保存的本人图片任务；绝不从整理链新建/重试图片任务。 */
export async function resolveKnowledgePublicationImages(owner: number, source: KnowledgeSource, indexes?: readonly number[], deps = {
  job: getJobByIdStrict,
  canonical: async (owner: number, url: string) => {
    const sources = await loadSucceededJobOutputSources(String(owner), getGcsBucketName());
    return resolveRegisteredPostProdMediaSource({ userId: String(owner), source: url }, undefined,
      { jobObjects: sources.objects, jobUrls: sources.urls });
  },
}, replacements: Record<string, string> = {}): Promise<KnowledgeSource> {
  const pages = await Promise.all(source.pages.map(async (page, i) => {
    if (!page.imageJobId || (indexes && !indexes.includes(i))) return page;
    const job = await deps.job(replacements[page.imageJobId] || page.imageJobId);
    if (!job || String(job.userId) !== String(owner)) throw new Error("配图任务尚未就绪或不属于当前账号，未开始本批整理");
    const input = job.input as { action?: string; params?: { kind?: string } } | null;
    if (input?.action !== "platform_composite_sheet_progress" || input.params?.kind !== "single_page_knowledge_card")
      throw new Error("配图任务类型不匹配，未读取其它任务内容");
    if (job.status !== "succeeded") throw new Error(job.status === "failed"
      ? "配图任务失败，文字已保留；请恢复原配图后继续整理"
      : "配图仍在生成，文字已保留；请等待原任务完成后继续整理");
    const output = job.output as { compositeImageUrl?: string; imageUrl?: string } | null;
    const url = output?.compositeImageUrl || output?.imageUrl;
    if (!url) throw new Error("配图任务没有有效图片，未执行空图审校");
    return { ...page, imageUrl: await deps.canonical(owner, url) };
  }));
  return { ...source, pages };
}

/** 补图只能首次绑定到失败/尚未提交的原任务，且必须是同一正文页与版式。 */
export async function validateKnowledgeImageReplacements(owner: number, before: KnowledgePublication | undefined, next: KnowledgePublication, read = getJobByIdStrict) {
  const previous = before?.imageReplacements || {}, replacements = next.imageReplacements || {};
  for (const [original, replacement] of Object.entries(previous))
    if (replacements[original] !== replacement) throw new Error("已绑定的补图不能覆盖，请保留原稿");
  for (const [original, replacement] of Object.entries(replacements)) {
    if (previous[original] === replacement) continue;
    const page = next.source.pages.find(p => p.imageJobId === original);
    if (!page || original === replacement) throw new Error("补图未对应原稿中的配图任务");
    const old = await read(original);
    if (old && (String(old.userId) !== String(owner) || !knowledgeImageMayRetry(old))) throw new Error("原配图任务尚未确认失败，不可替换或重复购买");
    const job = await read(replacement);
    const input = job?.input as { action?: string; params?: { kind?: string; scriptContext?: string; distillModel?: string; notePageIndex?: number; infographicTemplateId?: string } } | undefined;
    const params = input?.params;
    if (!job || String(job.userId) !== String(owner) || job.status !== "succeeded" || input?.action !== "platform_composite_sheet_progress" || params?.kind !== "single_page_knowledge_card")
      throw new Error("补图不是当前账号的成功知识配图任务");
    const body = planKnowledgeCardPages(params.scriptContext || "", params.distillModel).pages[(params.notePageIndex || 0) - 1];
    if (body !== page.body || (params.infographicTemplateId || "") !== (next.infographicTemplateId || "")) throw new Error("补图正文或版式与原稿不一致");
  }
}

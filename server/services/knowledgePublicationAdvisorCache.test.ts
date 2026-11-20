// 1119 E3：读档预整理在同一稿件/正文下跨批次复用（键变即失效）；成功任务产物登记在一次核验内只扫一次。
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ jobs: new Map<string, any>(), sourceLoads: 0 }));
vi.mock("../jobs/repository", async importOriginal => ({ ...await importOriginal<any>(), getJobByIdStrict: vi.fn(async (id: string) => state.jobs.get(id) || null) }));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test" }));
vi.mock("./postProdMediaSource", async importOriginal => ({ ...await importOriginal<any>(),
  loadSucceededJobOutputSourcesForJobs: async () => { state.sourceLoads++; return { objects: new Set<string>(), urls: new Set<string>() }; },
  resolveRegisteredPostProdMediaSource: async ({ source }: { source: string }) => source.replace("https://storage.googleapis.com/", "gs://") }));
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource } from "../../shared/editableLayout";
import { compileKnowledgeEditions } from "../../shared/knowledgeCardEdition";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";
import { knowledgeBatchRequestId } from "../../shared/knowledgePublication";
import { clearKnowledgeReadingNotesCache, knowledgeReadingNotesCacheKey, loadKnowledgeReadingNotesForReview, validateKnowledgePublicationAccess } from "./knowledgePublicationAdvisor";

const book = compileKnowledgeEditions("测试", Array.from({ length: 4 }, (_, i) => ({ headline: `节${i}`, body: `第${i}节正文。`.repeat(30), priority: "primary" as const })));
const source = () => {
  const plan = knowledgeEditionImagePlan(book.full)!;
  const imageJobIds = plan.images.map((_, i) => `img-${i}`);
  imageJobIds.forEach((id, i) => state.jobs.set(id, { userId: "7", status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output: { compositeImageUrl: `https://storage.googleapis.com/test/${i}.png` } }));
  return synchronizedKnowledgeCardSource({ owner: "7", sourceId: "c", fullMarkdown: book.full, illustrationMarkdown: book.full, detailLevel: "full", imageJobIds });
};
const link = { jobId: "read-1", documentId: "doc-1", batches: 2 } as any;
const note = (i: number) => ({ kind: "knowledge_publication_v1", title: "t", sourceDigest: "d", pages: [{ id: `n${i}` }] }) as any;
beforeEach(() => { clearKnowledgeReadingNotesCache(); state.sourceLoads = 0; });

it("全部分段已完成：同键第二次零加载；正文改动 / 换读档任务 / 换账号即重读", async () => {
  const doc = layoutFromSource(source()), src = doc.publication!.source;
  const load = vi.fn(async () => [note(0), note(1)]);
  expect(await loadKnowledgeReadingNotesForReview(7, link, src, load)).toHaveLength(2);
  expect(await loadKnowledgeReadingNotesForReview(7, link, src, load)).toHaveLength(2);
  expect(load).toHaveBeenCalledTimes(1);
  const edited = { ...src, pages: src.pages.map((p, i) => i === 0 ? { ...p, body: p.body + "改" } : p) };
  expect(knowledgeReadingNotesCacheKey(7, link, edited)).not.toBe(knowledgeReadingNotesCacheKey(7, link, src));
  await loadKnowledgeReadingNotesForReview(7, link, edited, load);
  await loadKnowledgeReadingNotesForReview(7, { ...link, jobId: "read-2" }, src, load);
  await loadKnowledgeReadingNotesForReview(8, link, src, load);
  expect(load).toHaveBeenCalledTimes(4);
  // 返回副本：调用方改数组不污染缓存。
  const first = await loadKnowledgeReadingNotesForReview(7, link, src, load); first.length = 0;
  expect(await loadKnowledgeReadingNotesForReview(7, link, src, load)).toHaveLength(2);
});

it("仍有分段未完成：不缓存，下次重读拿到新完成的分段；加载失败不缓存", async () => {
  const src = layoutFromSource(source()).publication!.source;
  const load = vi.fn().mockResolvedValueOnce([note(0)]).mockRejectedValueOnce(Error("gcs_download_failed:503")).mockResolvedValue([note(0), note(1)]);
  expect(await loadKnowledgeReadingNotesForReview(7, link, src, load)).toHaveLength(1);
  await expect(loadKnowledgeReadingNotesForReview(7, link, src, load)).rejects.toThrow("503");
  expect(await loadKnowledgeReadingNotesForReview(7, link, src, load)).toHaveLength(2);
  expect(await loadKnowledgeReadingNotesForReview(7, link, src, load)).toHaveLength(2);
  expect(load).toHaveBeenCalledTimes(3);
});

it("一次权限核验只扫一次本人成功任务产物登记（原先配图解析与归属核对各扫一次）；两次核验各扫一次，不跨请求复用", async () => {
  const doc = layoutFromSource(source()) as any;
  const requestId = knowledgeBatchRequestId(doc.publication.requestId, 0, 0);
  const ctx = { documentId: doc.id, batchIndex: 0, attempt: 0 };
  await validateKnowledgePublicationAccess(7, ctx as any, requestId, async () => doc, async () => null);
  expect(state.sourceLoads).toBe(1);
  await validateKnowledgePublicationAccess(7, ctx as any, requestId, async () => doc, async () => null);
  expect(state.sourceLoads).toBe(2);
});

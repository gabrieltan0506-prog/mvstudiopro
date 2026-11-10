import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ jobs: new Map<string, any>(), reads: [] as string[] }));
vi.mock("../jobs/repository", async importOriginal => ({ ...await importOriginal<any>(), getJobByIdStrict: vi.fn(async (id: string) => { state.reads.push(id); return state.jobs.get(id) || null; }) }));
vi.mock("./gcs", async importOriginal => ({ ...await importOriginal<any>(), getGcsBucketName: () => "test", signGsUriV4ReadUrl: (uri: string) => uri.replace("gs://", "https://storage.googleapis.com/") }));
vi.mock("./postProdMediaSource", async importOriginal => ({ ...await importOriginal<any>(), loadSucceededJobOutputSources: async () => ({ objects: new Set(), urls: new Set() }), resolveRegisteredPostProdMediaSource: async ({ source }: { source: string }) => source.replace("https://storage.googleapis.com/", "gs://") }));
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource } from "../../shared/editableLayout";
import { knowledgeManuscript, knowledgeReviewSchema } from "../../shared/knowledgePublication";
import { reviewKnowledgePublication, knowledgeSourceDigest, knowledgeEvidencePrefix, KNOWLEDGE_VISUAL_ADVISOR_MODEL } from "./knowledgePublicationAdvisor";
import { writeLayoutLibrary, readCanonicalLayoutLibrary } from "./editableLayoutStore";
import { loadKnowledgePublicationExport } from "./knowledgePublicationExport";
import { knowledgePresentationInput } from "./knowledgePresentationAdvisor";

describe("同步文字到配图、云稿与导出消费链", () => {
  it("文字先完成、图片未就绪零调用，成功后同册核对并供PPT消费且原source不变", async () => {
    state.jobs.clear(); state.reads.length = 0;
    const doc = layoutFromSource(synchronizedKnowledgeCardSource({ owner: "7", sourceId: "sync", fullMarkdown: "# 河流\n\n## 完整说明\n河流汇集地表径流，通常流向地势较低区域，水量受降水影响。", illustrationMarkdown: "# 河流\n\n## 精华配图\n河流流向低处。", detailLevel: "concise", imageJobIds: ["actual-image-job"] }));
    const source = doc.publication!.source, digest = knowledgeSourceDigest(source), storage = new Map<string, any>(), sha = "a".repeat(64);
    const post = vi.fn(async (request: any) => {
      const payload = request.contents[0].parts.map((p: any) => { try { return JSON.parse(p.text); } catch { return {}; } }).find((p: any) => p.source || p.facts);
      const value = payload.source ? { kind: "knowledge_publication_v1", sourceDigest: digest, title: source.title, pages: payload.source.pages.map((page: any) => ({ id: page.id, headline: page.headline, body: page.body, imageDescription: page.imageUrl ? "蓝色河流向低处流淌" : "", imageStatus: page.imageUrl ? "consistent" : "absent", facts: [{ term: "河流", statement: "通常流向低处" }], cautions: [] })) } : { sourceDigest: digest, findings: [] };
      return { status: 200, text: JSON.stringify({ modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL, usageMetadata: { promptTokensDetails: payload.source?.pages.some((p: any) => p.imageUrl) ? [{ modality: "IMAGE", tokenCount: 10 }] : [] }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }) };
    });
    const deps = { load: async () => doc as any, read: async (name: string) => storage.get(name) || null, save: async (name: string, value: any) => { storage.set(name, structuredClone(value)); }, count: async () => ({ totalTokens: 500, method: "test" }), post, image: async () => ({ buffer: Buffer.from("image"), mimeType: "image/png", width: 10, height: 10, sha256: sha }) };
    const context = { documentId: doc.id, batchIndex: 0, attempt: 0 };
    await reviewKnowledgePublication(7, context, deps);
    expect(state.reads).toEqual([]); expect(post).toHaveBeenCalledTimes(1);
    state.jobs.set("actual-image-job", { userId: "7", status: "running", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } } });
    await expect(reviewKnowledgePublication(7, { ...context, batchIndex: 1 }, deps)).rejects.toThrow("仍在生成");
    expect(post).toHaveBeenCalledTimes(1);
    state.jobs.set("actual-image-job", { ...state.jobs.get("actual-image-job"), status: "succeeded", output: { compositeImageUrl: "https://storage.googleapis.com/test/river.png" } });
    const imageBatch = await reviewKnowledgePublication(7, { ...context, batchIndex: 1 }, deps) as any;
    expect(imageBatch.images).toEqual([{ id: source.pages[1].id, url: "https://storage.googleapis.com/test/river.png" }]);
    const review = knowledgeReviewSchema.parse(await reviewKnowledgePublication(7, { ...context, batchIndex: 2 }, deps));
    // 两批审校均无实际疑点：整套核对按 1108 规则跳过联网、不发模型请求，只留跳过回执
    expect(review.pages).toHaveLength(2); expect(post).toHaveBeenCalledTimes(2);
    expect(storage.get(`${knowledgeEvidencePrefix(7, doc.id, doc.publication!.requestId)}/consistency-0/report.json`)).toMatchObject({ skipped: true, findings: [] });
    expect(review.pages[0].body).toContain("水量受降水影响");
    doc.pages = doc.pages.map((page, i) => ({ ...page, body: review.pages[i].body, headline: review.pages[i].headline, imageUrl: imageBatch.images.find((image: any) => image.id === page.id)?.url || "" }));
    doc.publication = { ...doc.publication!, review, completedBatches: 3, manuscript: knowledgeManuscript(review), confirmedManuscript: knowledgeManuscript(review) };
    let stored: Buffer;
    const libraryIO = { write: async ({ buffer }: any) => { stored = buffer; return { generation: "1" } as any; }, read: async () => ({ buffer: stored!, generation: "1" }) as any };
    await writeLayoutLibrary(7, { version: 1, owner: "7", documents: [doc] }, "0", libraryIO);
    const root = knowledgeEvidencePrefix(7, doc.id, doc.publication.requestId);
    const loaded = await loadKnowledgePublicationExport(7, doc.id, "1", { load: async () => readCanonicalLayoutLibrary(7, libraryIO), review: async () => storage.get(`${root}/report.json`) });
    expect(loaded.doc.pages[1].imageUrl).toBe("gs://test/river.png");
    expect(loaded.doc.publication!.source.pages[1].imageUrl).toBe("gs://test/river.png");
    expect(JSON.parse(stored!.toString()).library.documents[0].publication.source.pages[1].imageUrl).toBe("");
    loaded.doc.publication!.presentationRequest = { id: "55555555-5555-4555-8555-555555555555", minSlides: 3, maxSlides: 5, manuscript: loaded.doc.publication!.manuscript };
    expect(knowledgePresentationInput(loaded.doc).pages[1].imageUrl).toBe("gs://test/river.png");
  });
});

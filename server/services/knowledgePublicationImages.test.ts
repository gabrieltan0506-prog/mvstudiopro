import { describe, it, expect, vi } from "vitest";
import { resolveKnowledgePublicationImages } from "./knowledgePublicationImages";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
const source = { title: "河流", pages: [
  { id: "11111111-1111-4111-8111-111111111111", headline: "完整说明", body: "完整内容", imageUrl: "", role: "reading" as const },
  { id: "22222222-2222-4222-8222-222222222222", headline: "配图", body: "图中内容", imageUrl: "", imageJobId: "existing-job", role: "illustration" as const },
] };
const deps = (status = "succeeded", owner = "7") => ({
  job: vi.fn(async () => ({ userId: owner, status, input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output: { compositeImageUrl: "https://storage.googleapis.com/test/p.png" } } as any)),
  canonical: vi.fn(async () => "gs://test/p.png"),
});
describe("同步配图只读解析", () => {
  it("文字批不等待或读取图片任务", async () => { const d = deps("running"); expect(await resolveKnowledgePublicationImages(7, source, [0], d)).toEqual(source); expect(d.job).not.toHaveBeenCalled(); });
  it("读取本人成功图片且保留原source及稳定摘要", async () => { const d = deps(), resolved = await resolveKnowledgePublicationImages(7, source, undefined, d); expect(resolved.pages[1].imageUrl).toBe("gs://test/p.png"); expect(source.pages[1].imageUrl).toBe(""); expect(knowledgeSourceDigest(resolved)).toBe(knowledgeSourceDigest(source)); });
  it("未完成与他人任务都拒绝，不以无图冒充审校", async () => { await expect(resolveKnowledgePublicationImages(7, source, undefined, deps("running"))).rejects.toThrow("仍在生成"); await expect(resolveKnowledgePublicationImages(7, source, undefined, deps("succeeded", "9"))).rejects.toThrow("不属于"); });
});

import { validateKnowledgeImageReplacements } from "./knowledgePublicationImages";
import type { KnowledgePublication } from "../../shared/knowledgePublication";
describe("失败配图的恢复绑定", () => {
  const publication = (replacements?: Record<string, string>) => ({ version: 1, requestId: "33333333-3333-4333-8333-333333333333", source, completedBatches: 1, attempts: {}, manuscript: "原稿", imageReplacements: replacements } as KnowledgePublication);
  const replacementJob = { userId: "7", status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card", scriptContext: "图中内容", notePageIndex: 1 } }, output: { compositeImageUrl: "https://test.invalid/p.png" } };
  it("同页成功补图可首次绑定，已完成文字不被重置", async () => {
    const read = vi.fn(async (id: string) => id === "existing-job" ? { userId: "7", status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } } as any : replacementJob as any);
    const next = publication({ "existing-job": "replacement" });
    await expect(validateKnowledgeImageReplacements(7, publication(), next, read)).resolves.toBeUndefined();
    expect(next.completedBatches).toBe(1);
  });
  it("原任务未明确失败、正文错页与改绑均拒绝", async () => {
    const next = publication({ "existing-job": "replacement" });
    await expect(validateKnowledgeImageReplacements(7, publication(), next, vi.fn(async () => ({ userId: "7", status: "running" }) as any))).rejects.toThrow("尚未确认失败");
    const wrong = structuredClone(replacementJob); wrong.input.params.scriptContext = "另一份正文";
    await expect(validateKnowledgeImageReplacements(7, publication(), next, vi.fn(async (id: string) => id === "existing-job" ? null : wrong as any))).rejects.toThrow("正文或版式");
    await expect(validateKnowledgeImageReplacements(7, next, publication({ "existing-job": "another" }))).rejects.toThrow("不能覆盖");
  });
});

import { knowledgeCardPageJobId } from "../jobs/knowledgeCardPageTask";
describe("当前补图尝试必须持久保存并对账 KH-SYNC-02", () => {
  const attempt = (n: number) => { const requestId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; return { requestId, jobId: knowledgeCardPageJobId("7", "platform_composite_sheet_progress", requestId) }; };
  const pub = (n?: number): KnowledgePublication => ({ version: 1, requestId: "33333333-3333-4333-8333-333333333333", source, completedBatches: 1, attempts: {}, manuscript: "原稿", ...(n ? { imageAttempts: { "existing-job": attempt(n) } } : {}) });
  const refunded = { userId: "7", status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } };
  for (const [name, job] of Object.entries({ running: { userId: "7", status: "running" }, unknown: { userId: "7", status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "pending" } } }, missing: null, otherOwner: { ...refunded, userId: "8" }, succeeded: { userId: "7", status: "succeeded" } })) it(`${name}不能分配下一次补图`, async () => {
    const read = vi.fn(async () => job as any);
    await expect(validateKnowledgeImageReplacements(7, pub(1), pub(2), read)).rejects.toThrow("不能再次购买");
    expect(read).toHaveBeenCalledWith(attempt(1).jobId);
  });
  it("首次保存和明确退款后的下一次可以通过", async () => {
    const read = vi.fn(async () => refunded as any);
    await expect(validateKnowledgeImageReplacements(7, pub(), pub(1), read)).resolves.toBeUndefined();
    await expect(validateKnowledgeImageReplacements(7, pub(1), pub(2), read)).resolves.toBeUndefined();
    expect(read.mock.calls.map((call: any[]) => call[0])).toEqual(["existing-job", attempt(1).jobId]);
  });
  it("删除、错owner哈希、错原稿及错成功映射都拒绝", async () => {
    await expect(validateKnowledgeImageReplacements(7, pub(1), pub())).rejects.toThrow("不能删除");
    const wrong = pub(1); wrong.imageAttempts!["existing-job"].jobId = "kc_wrong";
    await expect(validateKnowledgeImageReplacements(7, pub(), wrong)).rejects.toThrow("不一致");
    const sourceWrong = pub(1); sourceWrong.imageAttempts = { other: attempt(1) };
    await expect(validateKnowledgeImageReplacements(7, pub(), sourceWrong)).rejects.toThrow("不一致");
    const mappingWrong = pub(1); mappingWrong.imageReplacements = { "existing-job": attempt(2).jobId };
    await expect(validateKnowledgeImageReplacements(7, pub(1), mappingWrong)).rejects.toThrow("当前已登记尝试");
  });
  it("成功映射绑定当前尝试，重复保存不重读或更换任务", async () => {
    const next = pub(1); next.imageReplacements = { "existing-job": attempt(1).jobId };
    const read = vi.fn(async (id: string) => id === "existing-job" ? refunded as any : { userId: "7", status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card", scriptContext: "图中内容", notePageIndex: 1 } } } as any);
    await expect(validateKnowledgeImageReplacements(7, pub(1), next, read)).resolves.toBeUndefined();
    read.mockClear(); await expect(validateKnowledgeImageReplacements(7, next, next, read)).resolves.toBeUndefined(); expect(read).not.toHaveBeenCalled();
  });
});

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

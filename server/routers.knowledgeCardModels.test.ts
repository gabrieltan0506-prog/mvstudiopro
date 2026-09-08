import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepare = vi.hoisted(() => vi.fn());
const extract = vi.hoisted(() => vi.fn());
vi.mock("./services/gcs.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/gcs.js")>(),
  getGcsBucketName: () => "test-bucket",
}));
vi.mock("./services/knowledgeCardDistill.js", () => ({
  prepareKnowledgeCardCopy: prepare,
  extractKnowledgeCardUploads: extract,
  shouldRunKnowledgeCardDistillAsync: () => false,
  estimateKnowledgeCardDistillChunks: () => 1,
}));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({
  recordKnowledgeCardDistillReceipt: vi.fn(),
}));
import { appRouter } from "./routers";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KNOWLEDGE_CARD_DISTILL_MODEL", "");
  prepare.mockImplementation(async (input) => ({
    distilledMarkdown: "# 测试笔记\n\n## 核对材料\n用客户提供的原文核对每项结论。",
    distillModel: input.distillModel,
    sourceChars: 30,
    skippedDistill: false,
    extractionMethods: [],
  }));
});
afterEach(() => vi.unstubAllEnvs());

const caller = () => appRouter.createCaller({ user: { id: 7, role: "user" } } as never);

describe("图文提炼入口仅允许精细和轻量", () => {
  it.each(["gpt-5.6-sol", "qwen3.8-max"] as const)("%s从实际路由传入提炼服务", async (distillModel) => {
    const result = await caller().mvAnalysis.prepareKnowledgeCardCopy({ sourceText: "测试材料", distillModel });
    expect(result.distillModel).toBe(distillModel);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ distillModel }));
  });

  it.each(["claude-opus-5", "moonshotai/kimi-k3"])("旧客户端不能重新提交%s", async (distillModel) => {
    await expect(caller().mvAnalysis.prepareKnowledgeCardCopy({
      sourceText: "测试材料", distillModel,
    } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("旧环境默认值为超凡时，新请求仍传精细且不会调用超凡", async () => {
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_MODEL", "claude-opus-5");
    const result = await caller().mvAnalysis.prepareKnowledgeCardCopy({ sourceText: "测试材料" });
    expect(result.distillModel).toBe("gpt-5.6-sol");
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ distillModel: "gpt-5.6-sol" }));
  });
});


describe("原始文件抽文在提炼前返回完整材料", () => {
  it("本人直传的长文完整返回，未调用模型提炼", async () => {
    const source = "原始内容。".repeat(12000);
    extract.mockResolvedValue({ documentText: source, imageDataUrls: [], methods: ["book.md:text_utf8"] });
    const result = await caller().mvAnalysis.extractPlatformDocumentText({ files: [{ gcsUri: "gs://test-bucket/uploads/u7/book.md", mimeType: "text/markdown", fileName: "book.md" }] });
    expect(result.text).toBe(source);
    expect(prepare).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledTimes(1);
  });
  it("其他账号文件在读取前被拒绝", async () => {
    await expect(caller().mvAnalysis.extractPlatformDocumentText({ files: [{ gcsUri: "gs://test-bucket/uploads/u8/book.md", mimeType: "text/markdown" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(extract).not.toHaveBeenCalled();
  });
  it("空文件入参被拒绝", async () => {
    await expect(caller().mvAnalysis.extractPlatformDocumentText({ files: [{ mimeType: "text/plain" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(extract).not.toHaveBeenCalled();
  });
  it.each(["pdf_strings", "gcs_read_failed", "empty", "none"])("不可靠抽文%s不会作为可提炼原文放行", async (method) => {
    extract.mockResolvedValue({ documentText: "部分正文", imageDataUrls: [], methods: [`book.pdf:${method}`] });
    await expect(caller().mvAnalysis.extractPlatformDocumentText({ files: [{ fileBase64: "dGVzdA==", mimeType: "application/pdf" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prepare).not.toHaveBeenCalled();
  });
});


it.each(["right", "portrait", "", null])("知识卡主体未知位置%s在生产及扣费前由实际API拒绝", async subjectPosition => {
  await expect(caller().mvAnalysis.generatePlatformCompositeSheet({
    sceneId: "test-position", title: "测试笔记", scriptContext: "测试正文", kind: "single_page_knowledge_card", subjectPosition,
  } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

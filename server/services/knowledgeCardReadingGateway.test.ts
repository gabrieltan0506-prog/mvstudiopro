import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), claim: vi.fn(), key: vi.fn() }));
vi.mock("./knowledgeCardReadingStore.js", () => ({ readKnowledgeReadingJson: mocks.read, saveKnowledgeReadingObject: mocks.save, claimKnowledgeReadingCall: mocks.claim }));
vi.mock("./gpt56CopywritingGateway.js", () => ({ getEvolinkApiKey: mocks.key }));
vi.mock("../_core/llm.js", () => ({ extractFirstChoicePlainText: (value: any) => value.choices?.[0]?.message?.content || "" }));
import { invokeKnowledgeReadingJson } from "./knowledgeCardReadingGateway";
const input = { objectPrefix: "test/reading", model: "gpt-5.6-sol" as const, system: "测试阅读", text: "测试原页" };
const envelope = (finish = "stop", content = '{"ok":true}') => JSON.stringify({ model: input.model, choices: [{ finish_reason: finish, message: { content } }] });
describe("阅读网关不可重复购买与完整性", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(null); mocks.save.mockResolvedValue({}); mocks.claim.mockResolvedValue(true); mocks.key.mockReturnValue("test-key"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(envelope()))); });
  afterEach(() => vi.unstubAllGlobals());
  it("保存原始响应后才解析，并保留超过40张的全部输入图片", async () => {
    const images = Array.from({ length: 45 }, (_, i) => ({ pageId: `p${i + 1}`, url: `https://example.invalid/${i + 1}.png` }));
    expect(await invokeKnowledgeReadingJson({ ...input, images })).toEqual({ ok: true });
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(request.messages[1].content.filter((item: any) => item.type === "image_url")).toHaveLength(45);
    expect(request.messages[1].content.at(-1).image_url.url).toContain("45.png");
    expect(JSON.parse(mocks.save.mock.calls[0]![1].toString()).body).toBe(envelope());
  });
  it.each(["length", "content_filter", "tool_calls", null])("拒绝不完整停止原因 %s，重试只读已存响应", async finish => {
    const reply = { status: 200, body: envelope(finish as any), receivedAt: "测试时间" };
    mocks.read.mockResolvedValue(reply);
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未完整返回");
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("解析错误仍永久保存原始响应", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("invalid-json"));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow();
    expect(JSON.parse(mocks.save.mock.calls[0]![1].toString()).body).toBe("invalid-json");
  });
  it("原始响应存储失败立即停止", async () => {
    mocks.save.mockRejectedValue(new Error("测试存储失败"));
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("测试存储失败");
  });
  it("存在占用而无响应时禁止重新请求", async () => {
    mocks.claim.mockResolvedValue(false);
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未重复提交");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("完整缓存直接恢复，不依赖当前凭证", async () => {
    mocks.key.mockReturnValue(undefined); mocks.read.mockResolvedValue({ status: 200, body: envelope() });
    expect(await invokeKnowledgeReadingJson(input)).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.key).not.toHaveBeenCalled();
  });
  it("HTTP失败缓存禁止自动重新购买", async () => {
    mocks.read.mockResolvedValue({ status: 503, body: "测试故障" });
    await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("未自动重复购买"); expect(fetch).not.toHaveBeenCalled();
  });
  it("轻量请求携带正确模型与思考参数", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(envelope().replace("gpt-5.6-sol", "qwen3.8-max")));
    await invokeKnowledgeReadingJson({ ...input, model: "qwen3.8-max" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ model: "qwen3.8-max", enable_thinking: true, max_completion_tokens: 32768 });
    expect(body).not.toHaveProperty("max_tokens");
  });
  it("上游返回另一档位或缺失模型身份时拒绝", async () => {
    for (const model of ["qwen3.8-max", undefined]) {
      mocks.read.mockResolvedValue({ status: 200, body: JSON.stringify({ ...JSON.parse(envelope()), model }) });
      await expect(invokeKnowledgeReadingJson(input)).rejects.toThrow("档位不一致");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

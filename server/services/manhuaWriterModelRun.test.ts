import { beforeEach, expect, it, vi } from "vitest";
const stage = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: stage }));
vi.mock("./gcs", () => ({ uploadBufferToGcs: upload }));
import { createManhuaWriterModelCall } from "./manhuaWriterModelRun";
beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue({});
  stage.mockImplementation(async (_p, _j, _r, trace) => {
    await trace.onRaw('{"choices":[{"message":{"content":"完整剧本"}}]}');
    return { text: "完整剧本", model: trace.modelPreference, settings: { reasoning: "high", maxTokens: 32768 } };
  });
});
it.each(["glm", "deepseek"] as const)("选%s固定传给已有流式路由，全文先落盘再交付", async model => {
  const call = createManhuaWriterModelCall(7, "request", model);
  const result = await call("原始输入", false, "request:script");
  expect(result.text).toBe("完整剧本");
  expect(stage).toHaveBeenCalledWith("原始输入", false, "request:script", expect.objectContaining({ modelPreference: model }));
  const writes = upload.mock.calls.map(([args]) => ({ name: args.objectName.split("/").pop(), value: args.buffer.toString() }));
  expect(writes.map(x => x.name)).toEqual(["input.json", "raw.json", "parsed.json", "manifest.json"]);
  expect(writes[1].value).toContain("完整剧本");
  const manifest = JSON.parse(writes[3].value);
  expect(manifest.raw.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.raw.bytes).toBe(Buffer.byteLength(writes[1].value));
});
it("输入证据写入失败就不调用模型", async () => {
  upload.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(createManhuaWriterModelCall(7,"r","glm")("input",false,"s")).rejects.toThrow("storage unavailable");
  expect(stage).not.toHaveBeenCalled();
});
it("保留真实连接错误，不伪称算力紧张或换到另一模型", async () => {
  stage.mockRejectedValueOnce(new Error("创作模型HTTP 403"));
  await expect(createManhuaWriterModelCall(7,"r","deepseek")("input",false,"s")).rejects.toThrow("DeepSeek：创作模型HTTP 403");
  expect(stage).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls.at(-1)?.[0].objectName).toMatch(/failure.json$/);
});

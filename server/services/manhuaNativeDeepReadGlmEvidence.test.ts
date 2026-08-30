import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createNativeDeepReadGlmEvidenceStore } from "./manhuaNativeDeepReadGlmEvidence";

function fixture(context = { seriesKey: "测试合集", sourceDigest: "a".repeat(64), episodeIndex: 3, batchRequestId: "batch-test", callId: "call-test" }) {
  const saved: Array<{ objectName: string; buffer: Buffer; contentType: string; bucket?: string }> = [];
  const upload = vi.fn(async (input: (typeof saved)[number]) => {
    saved.push(input);
    return { created: true, generation: String(saved.length) };
  });
  const store = createNativeDeepReadGlmEvidenceStore(context, { upload, getBucket: () => "mv-studio-pro-vertex-video-temp" });
  return { saved, upload, store };
}
const request = { system: "系统原文", user: "全量分段证据", maxTokens: 131072, temperature: 0.8, gatewayPolicy: "glm_only" };
const rawEvent = (gateway: "evolink_glm" | "openrouter" = "evolink_glm") => ({
  gateway, model: gateway === "evolink_glm" ? "glm-5.3" : "z-ai/glm-5.3",
  httpStatus: 200, providerRequestId: `request-${gateway}`, contentType: "application/json",
  bodyText: '{"choices":[{"message":{"content":"{\\\"shots\\\":[]}"}}]}',
  bodyComplete: true, receivedBytes: 67,
});

describe("整集GLM永久原始与解析证据", () => {
  it("请求、两个网关原文与解析整集独立保存，完整内容和身份可回溯", async () => {
    const { store, saved } = fixture();
    await store.writeRequest(request);
    await store.writeRawResponse(rawEvent());
    const last = rawEvent("openrouter");
    await store.writeRawResponse(last);
    const parsed = { shots: Array.from({ length: 150 }, (_, index) => ({ startSec: index, detailZh: `第${index}镜` })), subtitles: ["尾字幕"] };
    const evidence = await store.writeParsed(parsed, { gateway: last.gateway, model: last.model });
    expect(saved.map((row) => row.objectName)).toEqual([
      "manhua-template-learn/episode-glm-evidence/call-test/request.json",
      "manhua-template-learn/episode-glm-evidence/call-test/raw-1.json",
      "manhua-template-learn/episode-glm-evidence/call-test/raw-2.json",
      "manhua-template-learn/episode-glm-evidence/call-test/parsed.json",
    ]);
    const payloads = saved.map((row) => JSON.parse(row.buffer.toString("utf8")));
    expect(payloads[0].request).toEqual(request);
    expect(payloads[1].response.bodyText).toBe(rawEvent().bodyText);
    expect(payloads[3].parsed).toEqual(parsed);
    expect(payloads.every((row) => row.seriesKey === "测试合集" && row.episodeIndex === 3 && row.sourceDigest === "a".repeat(64) && row.batchRequestId === "batch-test")).toBe(true);
    expect(payloads[3].rawEvidence).toHaveLength(2);
    expect(evidence.raw.map((row) => row.gateway)).toEqual(["evolink_glm", "openrouter"]);
    expect(evidence.selectedRawObjectName).toBe(evidence.raw[1].objectName);
    for (const receipt of [evidence.request, ...evidence.raw, evidence.parsed]) {
      const object = saved.find((row) => row.objectName === receipt.objectName)!;
      expect(receipt.bytes).toBe(object.buffer.byteLength);
      expect(receipt.sha256).toBe(createHash("sha256").update(object.buffer).digest("hex"));
    }
  });

  it("坏JSON原文仍完整保存，不在raw写端解析或丢掉尾部", async () => {
    const { store, saved } = fixture();
    await store.writeRequest(request);
    await store.writeRawResponse({ ...rawEvent(), bodyText: 'data: {"坏JSON":\n末尾仍保留', bodyComplete: false });
    expect(JSON.parse(saved[1].buffer.toString()).response.bodyText).toBe('data: {"坏JSON":\n末尾仍保留');
    await expect(store.writeParsed({ shots: [] }, { gateway: "evolink_glm", model: "glm-5.3" })).rejects.toThrow("完整原始响应");
    expect(saved).toHaveLength(2);
  });

  it("legacy无上下文使用独立调用UUID，缺失身份明确null，不伪造集号", async () => {
    const upload = vi.fn(async (_input: { buffer: Buffer }) => ({ created: true, generation: "1" }));
    const store = createNativeDeepReadGlmEvidenceStore(undefined, { upload, getBucket: () => "mv-studio-pro-vertex-video-temp" });
    await store.writeRequest(request);
    const input = upload.mock.calls[0][0];
    const payload = JSON.parse(input.buffer.toString());
    expect(payload.identityScope).toBe("standalone");
    expect(payload.callId).toMatch(/^[0-9a-f-]{36}$/);
    expect([payload.seriesKey, payload.sourceDigest, payload.episodeIndex, payload.batchRequestId]).toEqual([null, null, null, null]);
  });

  it("原始响应必须先有关联请求，解析必须先有原文", async () => {
    const { store, upload } = fixture();
    await expect(store.writeRawResponse(rawEvent())).rejects.toThrow("请求证据");
    expect(upload).not.toHaveBeenCalled();
    await store.writeRequest(request);
    await expect(store.writeParsed({}, { gateway: "evolink_glm", model: "glm-5.3" })).rejects.toThrow("完整原始响应");
  });

  it("对象已存在拒绝覆盖，不把旧对象冒充本次证据", async () => {
    const { store, upload } = fixture();
    upload.mockResolvedValueOnce({ created: false, generation: "old" });
    await expect(store.writeRequest(request)).rejects.toThrow("已存在");
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("存储异常隐藏签名URL与原始cause，不能假成功", async () => {
    const { store, upload } = fixture();
    upload.mockRejectedValueOnce(new Error("https://storage.example.invalid/private?token=test-secret"));
    const error = await store.writeRequest(request).catch((value: unknown) => value);
    expect(String(error)).toContain("保存失败");
    expect(String(error)).not.toContain("test-secret");
    expect((error as Error).cause).toBeUndefined();
  });
});

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
it("转发真实字节心跳，持久化失败不吞错", async()=>{
 const onBytes=vi.fn().mockRejectedValue(new Error('heartbeat storage failed'));
 stage.mockImplementationOnce(async(_p,_j,_r,trace)=>{await trace.onBytes(32);});
 await expect(createManhuaWriterModelCall(7,'r','glm')('input',true,'s',{onBytes})).rejects.toThrow('heartbeat storage failed');
 expect(onBytes).toHaveBeenCalledWith(32);
});

it("逐通道输入、原始响应、失败与采用路由进入同一GCS证据清单", async () => {
  stage.mockImplementationOnce(async (_prompt, _json, _stageId, trace) => {
    const first = { attempt: 1, requestId: "s:0", model: "z-ai/glm-5.3-flashx", gateway: "openrouter" };
    const second = { attempt: 2, requestId: "s:1", model: "glm-5.3-flashx", gateway: "evolink" };
    await trace.onRouteEvent({ phase: "input", route: first, request: { model: first.model, messages: [{ role: "user", content: "正文" }] } });
    await trace.onRouteEvent({ phase: "response", route: first, status: 503, contentType: "text/plain", raw: "busy", receivedBytes: 4 });
    await trace.onRouteEvent({ phase: "failure", route: first, status: 503, message: "创作模型HTTP 503", receivedBytes: 4, willFallback: true });
    await trace.onRouteEvent({ phase: "input", route: second, request: { model: second.model, messages: [{ role: "user", content: "正文" }] } });
    await trace.onRaw('{"choices":[{"message":{"content":"完整剧本"}}]}');
    await trace.onRouteEvent({ phase: "response", route: second, status: 200, contentType: "text/event-stream", raw: "data: 完整结果", receivedBytes: 18 });
    await trace.onRouteEvent({ phase: "selected", route: second });
    return { text: "完整剧本", model: second.model, route: second };
  });
  await createManhuaWriterModelCall(7, "parent-request", "glm")("正文", false, "s");
  const writes = upload.mock.calls.map(([args]) => ({ name: args.objectName.split("/").pop(), value: JSON.parse(args.buffer.toString()) }));
  const manifest = writes.find(write => write.name === "manifest.json")!.value;
  expect(manifest.selectedRoute).toMatchObject({ gateway: "evolink", model: "glm-5.3-flashx", attempt: 2 });
  expect(manifest.routeEvents.map((event: any) => event.phase)).toEqual(["input", "response", "failure", "input", "response", "selected"]);
  expect(manifest.routeEvents.every((event: any) => /^[a-f0-9]{64}$/.test(event.evidence.sha256) && event.evidence.bytes > 0)).toBe(true);
  expect(writes.find(write => write.name === "route-1-response.json")!.value).toMatchObject({ requestId: "parent-request", stageId: "s", raw: "busy" });
  expect(writes.find(write => write.name === "route-2-input.json")!.value).toMatchObject({ requestId: "parent-request", request: { model: "glm-5.3-flashx" } });
});

it("失败清单保留已写入的逐路证据和证据失败分类", async () => {
  stage.mockImplementationOnce(async (_prompt, _json, _stageId, trace) => {
    await trace.onRouteEvent({ phase: "input", route: { attempt: 1, requestId: "s:0", model: "z-ai/glm-5.3-flashx", gateway: "openrouter" }, request: { model: "z-ai/glm-5.3-flashx" } });
    throw Object.assign(new Error("创作记录保存失败，停止本次生成"), { code: "NOVEL_EVIDENCE_WRITE_FAILED" });
  });
  await expect(createManhuaWriterModelCall(7, "parent-request", "glm")("正文", false, "s")).rejects.toMatchObject({ code: "NOVEL_EVIDENCE_WRITE_FAILED" });
  const failure = JSON.parse(upload.mock.calls.at(-1)![0].buffer.toString());
  expect(failure.routeEvents).toHaveLength(1);
  expect(failure.routeEvents[0].phase).toBe("input");
});

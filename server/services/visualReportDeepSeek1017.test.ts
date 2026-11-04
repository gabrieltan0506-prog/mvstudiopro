import { afterEach, describe, expect, it, vi } from "vitest";
import { runVisualReportDeepSeek, VISUAL_REPORT_MODEL } from "./visualReportDeepSeek";
import { buildVisualReportFailureTelemetry } from "./visualReportLlm";
const { upload } = vi.hoisted(() => ({ upload: vi.fn().mockResolvedValue({ gcsUri: "gs://test/evidence" }) }));
vi.mock("./gcs", () => ({ uploadBufferToGcs: upload }));
const result = { reportTitle: "报告", insightSummary: ["内容"], trackGrowth: [{name:"题材",growth:"参考"}] };
const params = { reportContract: undefined, systemPrompt: "分析真实作品", userPrompt: "原文", maxTokens: 8192 };
afterEach(()=>{upload.mockReset().mockResolvedValue({gcsUri:"gs://test/evidence"});vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("趋势图固定DeepSeek1017单次请求",()=>{
 it("精确型号、充足推理预算和真实路由回执",async()=>{
  vi.stubEnv("OPENROUTER_API_KEY","test-key");
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:VISUAL_REPORT_MODEL,choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:20}})));
  vi.stubGlobal("fetch",fetchMock);const r=await runVisualReportDeepSeek(params);
  expect(fetchMock).toHaveBeenCalledTimes(1);expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({model:VISUAL_REPORT_MODEL,reasoning:{effort:"high"},temperature:0.8,max_tokens:32768});
  expect(r).toMatchObject({engine:"openrouter_deepseek",gateway:"openrouter",upstreamModel:VISUAL_REPORT_MODEL,gatewayAttemptsPerformed:1});
 });
 it.each(["length","content_filter"])("%s即使附合法JSON也拒绝且不重投",async(reason)=>{
  vi.stubEnv("OPENROUTER_API_KEY","test-key");const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:VISUAL_REPORT_MODEL,choices:[{finish_reason:reason,message:{content:JSON.stringify(result)}}]})));vi.stubGlobal("fetch",f);
  await expect(runVisualReportDeepSeek(params)).rejects.toThrow(/截断|未完整/);expect(f).toHaveBeenCalledTimes(1);expect(upload.mock.calls.map(c=>c[0].objectName.split("/").pop())).toEqual(["request.json","response.raw.json"]);
 });
 it("缺配置/预先取消不外呼，失败遥测不虚增",async()=>{
  vi.stubEnv("OPENROUTER_API_KEY","");const f=vi.fn();vi.stubGlobal("fetch",f);
  const error=await runVisualReportDeepSeek(params).catch(e=>e);expect(buildVisualReportFailureTelemetry({error,llmResult:null,stage:"llm"}).gatewayAttemptsPerformed).toBe(0);expect(f).not.toHaveBeenCalled();
 });
 it("HTTP失败不跨通道且不回传供应商正文",async()=>{
  vi.stubEnv("OPENROUTER_API_KEY","test-key");const f=vi.fn().mockResolvedValue(new Response("private upstream text test-key",{status:429}));vi.stubGlobal("fetch",f);
  await expect(runVisualReportDeepSeek(params)).rejects.toThrow("HTTP 429");expect(f).toHaveBeenCalledTimes(1);
 });
});

it("保存请求失败时不调用付费模型",async()=>{
 vi.stubEnv("OPENROUTER_API_KEY","test-key");upload.mockRejectedValueOnce(Error("storage unavailable"));
 const f=vi.fn();vi.stubGlobal("fetch",f);
 const e=await runVisualReportDeepSeek(params).catch(e=>e);
 expect(e).toBeInstanceOf(Error);expect(f).not.toHaveBeenCalled();
 expect(buildVisualReportFailureTelemetry({error:e,llmResult:null,stage:"llm"}).gatewayAttemptsPerformed).toBe(0);
});
it("原始成功响应先保存，解析结果另存且带原始指纹",async()=>{
 vi.stubEnv("OPENROUTER_API_KEY","test-key");
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({model:VISUAL_REPORT_MODEL,choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}))));
 await runVisualReportDeepSeek(params);
 expect(upload.mock.calls.map(c=>c[0].objectName.split("/").pop())).toEqual(["request.json","response.raw.json","response.parsed.json"]);
 const last=JSON.parse(upload.mock.calls[2][0].buffer.toString());
 expect(last.rawReceipt.sha256).toMatch(/^[a-f0-9]{64}$/);expect(last.parsed).toEqual(result);
});

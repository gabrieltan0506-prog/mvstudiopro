import {afterEach,expect,it,vi} from "vitest";
import {invokeLLM} from "./llm";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("Astra官方精确出站、保留推理与上限、不降为旧模型",async()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-offline-test");
 const request=vi.fn(async()=>new Response(JSON.stringify({model:"gpt-6-astra",choices:[{message:{content:"{}"},finish_reason:"stop"}]}),{status:200,headers:{"content-type":"application/json"}}));
 vi.stubGlobal("fetch",request);
 await invokeLLM({provider:"openai",modelName:"gpt-6-astra",openAiGateway:"official_only",singleAttempt:true,reasoningEffort:"high",max_tokens:32768,temperature:0.7,messages:[{role:"user",content:"离线测试"}]});
 const [url,init]=request.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe("https://api.openai.com/v1/chat/completions");
 const body=JSON.parse(String(init.body));expect(body.model).toBe("gpt-6-astra");expect(body.reasoning_effort).toBe("high");expect(body.max_completion_tokens).toBe(32768);expect(body).not.toHaveProperty("temperature");
 request.mockRejectedValueOnce(Error("network uncertainty"));
 await expect(invokeLLM({provider:"openai",modelName:"gpt-6-astra",openAiGateway:"official_only",singleAttempt:true,messages:[{role:"user",content:"test"}]})).rejects.toThrow("network uncertainty");
 expect(request).toHaveBeenCalledTimes(2);
});
it("Astra拒绝非官方路由",async()=>{
 const request=vi.fn();vi.stubGlobal("fetch",request);
 await expect(invokeLLM({provider:"openai",modelName:"gpt-6-astra",messages:[{role:"user",content:"test"}]})).rejects.toThrow("仅允许官方");expect(request).not.toHaveBeenCalled();
});

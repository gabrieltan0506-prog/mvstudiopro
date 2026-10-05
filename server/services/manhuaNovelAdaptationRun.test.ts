import { describe, it, expect, vi, afterEach } from "vitest";
const gatewayKeys = vi.hoisted(() => ({ openrouter: "test-key", evolink: "" }));
vi.mock("./openrouterGptImage2", () => ({
  getOpenRouterApiKey: () => gatewayKeys.openrouter,
}));
vi.mock("./gpt56CopywritingGateway", () => ({
  getEvolinkApiKey: () => gatewayKeys.evolink,
  getOpenRouterChatHeaders: () => ({}),
  OPENROUTER_CHAT_COMPLETIONS_URL: "https://test.invalid/chat",
  EVOLINK_CHAT_COMPLETIONS_URL: "https://fallback.invalid/chat",
}));
import {
  runManhuaNovelAdaptation,
  callNovelStage,
  type NovelRouteEvent,
} from "./manhuaNovelAdaptationRun";
import { inspectFragmentedDialogue } from "../../shared/manhuaNovelAdaptation";
const source = { label: "神话底本", text: "底本的因果与人物关系。".repeat(20) };
const good = {
  title: "补天人的女儿",
  text:
    "第一章\n" +
    "她把烧红的石头拨到一旁。「你若还要瞒着我，就自己去把那道裂口堵上。」\n母亲没有接碗。「先把门关好。外头的人不能听见。」\n".repeat(
      12
    ),
  adaptationNotes:
    "保留底本核心事件，增加母女之间的选择与代价；沿所选模板安排质问、回避与行动。",
};
const bad = {
  ...good,
  text:
    "第一章\n" + "娘：「那马……」女儿：「娘……」母亲：「走吧。」\n".repeat(30),
};
const input = {
  source,
  topic: "母女视角",
  brief: "偏悬疑",
  template:
    "已核完整模板：人物互相试探，第一次回答避重就轻，行动后才透露代价。",
  episodeCount: 2,
  requestId: "request-test",
  scriptPrompt: (n: any) => `模板=${input.template}\n小说=${n.text}`,
};
const reply = (text: string) => ({ text, model: "z-ai/glm-5.3-flashx" });
describe("底本→小说→模板剧情", () => {
  it("模板从小说阶段进入，下一段读取完整小说，保留原底本指纹", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(reply(JSON.stringify(good)))
      .mockResolvedValueOnce(reply("完整剧本" + good.text));
    const result = await runManhuaNovelAdaptation(input, call);
    expect(call.mock.calls[0][0]).toContain(input.template);
    expect(call.mock.calls[0][0]).toContain(source.text);
    expect(call.mock.calls[0][0]).toContain(input.topic);
    expect(call.mock.calls[1][0]).toContain(good.text);
    expect(call.mock.calls[1][0]).toContain(input.template);
    expect(result.novel.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.novel.text).toBe(good.text.trim());
  });
  it("没有模板零调用", async () => {
    const call = vi.fn();
    await expect(
      runManhuaNovelAdaptation({ ...input, template: "" }, call)
    ).rejects.toThrow("模板");
    expect(call).not.toHaveBeenCalled();
  });
  it("碎句泛滥只集中修一次再进入剧情；偶尔短句不会失败", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(reply(JSON.stringify(bad)))
      .mockResolvedValueOnce(reply(JSON.stringify(good)))
      .mockResolvedValueOnce(reply("剧情" + good.text));
    await runManhuaNovelAdaptation(input, call);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[1][0]).toContain("集中修订");
    expect(inspectFragmentedDialogue(good.text + "「走！」").fragmented).toBe(
      false
    );
  });
  it("反复碎句和格式错误不会进入后续生成", async () => {
    const call = vi.fn().mockResolvedValue(reply(JSON.stringify(bad)));
    await expect(runManhuaNovelAdaptation(input, call)).rejects.toThrow(
      "仍未通过"
    );
    expect(call).toHaveBeenCalledTimes(2);
    const malformed = vi.fn().mockResolvedValue(reply("不是小说JSON"));
    await expect(runManhuaNovelAdaptation(input, malformed)).rejects.toThrow(
      "格式"
    );
    expect(malformed).toHaveBeenCalledTimes(1);
  });
});
function stream(text: string, finish = "stop") {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } }
  );
}
describe("复用模型路由", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("GLM429拥堵自动DeepSeek，固定模型和供应商锁", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(stream("完整结果"));
    vi.stubGlobal("fetch", fetch);
    expect((await callNovelStage("提示词", true, "r")).text).toBe("完整结果");
    const bodies = fetch.mock.calls.map(c => JSON.parse(c[1].body));
    expect(bodies.map(b => b.model)).toEqual([
      "z-ai/glm-5.3-flashx",
      "deepseek/deepseek-v4.1-flash",
    ]);
    expect(bodies[0].provider.order).toEqual(["Z.AI"]);
    expect(bodies[1].reasoning).toEqual({ enabled: true, effort: "high" });
  });
  it.each([401, 403, "content_filter", "safety_violation", "invalid_api_key"])("HTTP200流内%s错误不换模型", async (code) => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify({ error: { code, message: "provider error" } })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    )).mockResolvedValueOnce(stream("不应调用备用模型"));
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("x", false, "r")).rejects.toThrow("旧稿保留");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("HTTP200非SSE错误体不能当作塞车", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 401 } }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("x", false, "r")).rejects.toThrow("格式异常");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("HTTP200流内429拥堵允许备用模型", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify({ error: { code: 429 } })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    )).mockResolvedValueOnce(stream("完整结果"));
    vi.stubGlobal("fetch", fetch);
    expect((await callNovelStage("x", false, "r")).text).toBe("完整结果");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("鉴权失败与内容拦截不当作塞车换模型", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("no", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("x", false, "r")).rejects.toThrow("401");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockReset().mockResolvedValue(stream("", "content_filter"));
    await expect(callNovelStage("x", false, "r")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("证据写入失败不误作拥堵切换上游，避免重复花费", async () => {
  const body='data: '+JSON.stringify({choices:[{delta:{content:'完整结果'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
  const fetch=vi.fn().mockImplementation(async()=>new Response(body,{headers:{'content-type':'text/event-stream'}}));vi.stubGlobal('fetch',fetch);
  await expect(callNovelStage('提示',true,'r',{onBytes:async()=>{throw new Error('database timeout')}})).rejects.toThrow('记录保存失败');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("手动选择DeepSeek直接调用该模型，并使用对应参数与模型回执", async () => {
  const fetch = vi.fn().mockResolvedValue(stream("手动选择结果"));
  vi.stubGlobal("fetch",fetch);
  try {
    const result=await callNovelStage("相同输入",true,"manual",{modelPreference:"deepseek"});
    expect(result.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(result.settings).toEqual({reasoning:"high",maxTokens:32768});
    expect(fetch).toHaveBeenCalledTimes(1);
    const body=JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe(result.model);
    expect(body.reasoning).toEqual({enabled:true,effort:"high"});
    expect(body.provider.order).toEqual(["DeepSeek"]);
  } finally { vi.unstubAllGlobals(); }
});
it.each(["glm","deepseek"] as const)("手动选择%s遇到拥堵不偷偷换模型",async modelPreference=>{
  const fetch=vi.fn().mockResolvedValue(new Response("busy",{status:429}));vi.stubGlobal("fetch",fetch);
  try { await expect(callNovelStage("x",true,"manual",{modelPreference})).rejects.toThrow("429"); expect(fetch).toHaveBeenCalledTimes(1); }
  finally { vi.unstubAllGlobals(); }
});

it("EvoLink DeepSeek仅发送文档支持的thinking开关，不伪造high档", async () => {
  gatewayKeys.openrouter="";gatewayKeys.evolink="test-evolink-key";
  const fetch=vi.fn().mockResolvedValue(stream("启用推理的结果"));vi.stubGlobal("fetch",fetch);
  try {
    const result=await callNovelStage("相同方向",true,"evo",{modelPreference:"deepseek"});
    const body=JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.thinking).toEqual({type:"enabled"});
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("reasoning");
    expect(result.settings).toEqual({reasoning:"enabled",maxTokens:32768});
  } finally { gatewayKeys.openrouter="test-key";gatewayKeys.evolink="";vi.unstubAllGlobals(); }
});

it("输出预算耗尽即停止并保留回执，不把空正文当成功或自动换模型再付费", async () => {
  const fetch = vi.fn().mockResolvedValue(stream("", "length"));
  const onRaw = vi.fn(async (_raw: string) => {});
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(callNovelStage("提示词", true, "budget", { onRaw })).rejects.toThrow("预算耗尽");
    expect(onRaw).toHaveBeenCalledTimes(1);
    expect(onRaw.mock.calls[0][0]).toContain('"finish_reason":"length"');
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});

describe("同模型双通道", () => {
  afterEach(() => {
    gatewayKeys.openrouter = "test-key";
    gatewayKeys.evolink = "";
    vi.unstubAllGlobals();
  });
  it.each([
    ["glm", "z-ai/glm-5.3-flashx", "glm-5.3-flashx"],
    ["deepseek", "deepseek/deepseek-v4.1-flash", "deepseek-v4.1-flash"],
  ] as const)("%s 首路503仅转同模型备用，并保留逐路证据", async (modelPreference, primary, backup) => {
    gatewayKeys.evolink = "test-evolink-key";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(stream("备用完整结果"));
    const events: NovelRouteEvent[] = [];
    vi.stubGlobal("fetch", fetch);
    const result = await callNovelStage("相同正文", true, "same-request", { modelPreference, onRouteEvent: async event => { events.push(event); } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://test.invalid/chat", "https://fallback.invalid/chat"]);
    const requests = fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(requests.map(request => request.model)).toEqual([primary, backup]);
    expect(requests.every(request => request.max_tokens === 32768 && request.stream === true)).toBe(true);
    expect(requests[0].reasoning.effort).toBe("high");
    if (modelPreference === "glm") expect(requests[1].reasoning_effort).toBe("high");
    else expect(requests[1].thinking).toEqual({ type: "enabled" });
    expect(events.map(event => event.phase)).toEqual(["input", "response", "failure", "input", "response", "selected"]);
    expect(events[1]).toMatchObject({ status: 503, raw: "busy", route: { attempt: 1, gateway: "openrouter", model: primary } });
    expect(events[2]).toMatchObject({ willFallback: true });
    expect(events[4]).toMatchObject({ route: { attempt: 2, gateway: "evolink" }, raw: expect.stringContaining("备用完整结果") });
    expect(result.route).toEqual({ attempt: 2, requestId: "same-request:1", model: backup, gateway: "evolink" });
    expect(JSON.stringify(events)).not.toContain("test-key");
    expect(JSON.stringify(events)).not.toContain("test-evolink-key");
  });
  it("auto 先穷尽GLM两路再按旧顺序进入DeepSeek", async () => {
    gatewayKeys.evolink = "test-evolink-key";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(stream("备用模型结果"));
    vi.stubGlobal("fetch", fetch);
    await callNovelStage("正文", false, "auto");
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual([
      "z-ai/glm-5.3-flashx", "glm-5.3-flashx", "deepseek/deepseek-v4.1-flash",
    ]);
  });
  it.each(["glm", "deepseek"] as const)("%s 两路存在首路成功不重发", async modelPreference => {
    gatewayKeys.evolink = "test-evolink-key";
    const fetch = vi.fn().mockResolvedValue(stream("首路完整结果"));
    vi.stubGlobal("fetch", fetch);
    const result = await callNovelStage("正文", false, "first", { modelPreference });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.route?.gateway).toBe("openrouter");
  });
  it.each([
    ["test-key", "", "https://test.invalid/chat"],
    ["", "test-evolink-key", "https://fallback.invalid/chat"],
  ])("跳过缺失的通道配置 (%s / %s)", async (openrouter, evolink, url) => {
    gatewayKeys.openrouter = openrouter;
    gatewayKeys.evolink = evolink;
    const fetch = vi.fn().mockResolvedValue(stream("唯一通道结果"));
    vi.stubGlobal("fetch", fetch);
    await callNovelStage("正文", false, "one-key", { modelPreference: "glm" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(url);
  });
  it("两路均缺失在请求前拒绝", async () => {
    gatewayKeys.openrouter = "";
    gatewayKeys.evolink = "";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("正文", false, "no-key", { modelPreference: "glm" })).rejects.toThrow("尚未连接");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 408, 504])("HTTP %s 不视为可安全重发的拥塞", async status => {
    gatewayKeys.evolink = "test-evolink-key";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("refused", { status })).mockResolvedValueOnce(stream("不得调用"));
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("正文", false, "refused", { modelPreference: "glm" })).rejects.toThrow(String(status));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { content: "半截正文" },
    { reasoning_content: "已经开始推理" },
  ])("已有有效输出后503错误帧也不重发 (%j)", async delta => {
    gatewayKeys.evolink = "test-evolink-key";
    const raw = `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ error: { code: 503 } })}\n\n`;
    const fetch = vi.fn().mockResolvedValueOnce(new Response(raw, { headers: { "content-type": "text/event-stream" } })).mockResolvedValueOnce(stream("不得调用"));
    const events: NovelRouteEvent[] = [];
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("正文", false, "partial", { modelPreference: "glm", onRouteEvent: async event => { events.push(event); } })).rejects.toThrow("流返回错误");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events.find(event => event.phase === "response")).toMatchObject({ raw });
    expect(events.at(-1)).toMatchObject({ phase: "failure", willFallback: false });
  });
  it("已收字节后断流保留半截原始响应，不重发", async () => {
    gatewayKeys.evolink = "test-evolink-key";
    const raw = 'data: {"choices":[{"delta":{"content":"半截正文"}}]}\n\n';
    const fetch = vi.fn().mockResolvedValueOnce(new Response(raw, { headers: { "content-type": "text/event-stream" } })).mockResolvedValueOnce(stream("不得调用"));
    const events: NovelRouteEvent[] = [];
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("正文", false, "broken", { modelPreference: "glm", onRouteEvent: async event => { events.push(event); } })).rejects.toThrow("结束帧");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events.find(event => event.phase === "response")).toMatchObject({ raw });
  });
  it("响应未决的连接超时不重新提交", async () => {
    gatewayKeys.evolink = "test-evolink-key";
    const fetch = vi.fn().mockRejectedValue(new Error("模型连接超时"));
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("正文", false, "timeout", { modelPreference: "glm" })).rejects.toThrow("超时");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("首路503回执保存失败阻止备用提交", async () => {
    gatewayKeys.evolink = "test-evolink-key";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(stream("不得调用"));
    vi.stubGlobal("fetch", fetch);
    await expect(callNovelStage("正文", false, "evidence", { modelPreference: "glm", onRouteEvent: async event => {
      if (event.phase === "response") throw new Error("storage timeout");
    } })).rejects.toThrow("记录保存失败");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

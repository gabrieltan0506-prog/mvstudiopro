import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("./openrouterGptImage2", () => ({
  getOpenRouterApiKey: () => "test-key",
}));
vi.mock("./gpt56CopywritingGateway", () => ({
  getEvolinkApiKey: () => "",
  getOpenRouterChatHeaders: () => ({}),
  OPENROUTER_CHAT_COMPLETIONS_URL: "https://test.invalid/chat",
  EVOLINK_CHAT_COMPLETIONS_URL: "https://fallback.invalid/chat",
}));
import {
  runManhuaNovelAdaptation,
  callNovelStage,
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
    expect(bodies[1].reasoning).toEqual({ enabled: false });
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

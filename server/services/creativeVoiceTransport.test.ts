import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import { connectVoiceTransport, normalizeVoiceMessage, voiceSetup } from "./creativeVoiceTransport";
import { creativeVoiceConnectionPlans, connectCreativeVoiceWithFallback } from "./creativeVoiceFallback";
import { creativeVoiceTurnIdle, creativeVoiceInputSchema } from "../../shared/creativeVoice";
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send = vi.fn(); close = vi.fn(); terminate = vi.fn();
}
function setup() {
  const sockets: Socket[] = [];
  const deps = { socket: vi.fn((_url: string, _headers: Record<string, string>) => { const s = new Socket(); sockets.push(s); return s; }), vertexHeaders: async () => ({ Authorization: "test-only" }), project: () => "test-project", apiKey: () => "test-key" };
  return { sockets, deps };
}
describe("Live真实连接器协议（离线）", () => {
  it("建立失败先清理Vertex再走API，握手之前只发setup，无正文重放", async () => {
    const { sockets, deps } = setup(); const onEvent = vi.fn(), onEnded = vi.fn();
    const promise = connectCreativeVoiceWithFallback({ signal: new AbortController().signal,
      connect: (plan, signal) => connectVoiceTransport({ plan, signal, context: "测试作品", onEvent, onEnded }, deps) });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("open"); expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toHaveProperty("setup");
    sockets[0].emit("close");
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
    sockets[1].emit("open"); sockets[1].emit("message", Buffer.from('{"setupComplete":{}}'));
    const result = await promise; expect(result.plan.route).toBe("gemini-api");
    expect(deps.socket.mock.calls[1][0]).not.toContain("test-key");
    expect(sockets[1].send).toHaveBeenCalledOnce();
    sockets[1].emit("close"); expect(onEnded).toHaveBeenCalledOnce(); expect(deps.socket).toHaveBeenCalledTimes(2);
  });
  it("认证等待时取消，迟到凭证不会建立新连接", async () => {
    const { deps } = setup(); const controller = new AbortController(); let release!: () => void;
    deps.vertexHeaders = () => new Promise(resolve => { release = () => resolve({ Authorization: "late" }); });
    const result = connectVoiceTransport({ plan: creativeVoiceConnectionPlans(false)[0], context: "", signal: controller.signal, onEvent: vi.fn(), onEnded: vi.fn() }, deps);
    controller.abort(); await expect(result).rejects.toThrow("cancelled"); release(); await Promise.resolve(); expect(deps.socket).not.toHaveBeenCalled();
  });
  it("握手超时清理连接", async () => {
    vi.useFakeTimers();
    try {
      const { deps, sockets } = setup();
      const promise = connectVoiceTransport({ plan: creativeVoiceConnectionPlans(true)[0], context: "", signal: new AbortController().signal, onEvent: vi.fn(), onEnded: vi.fn() }, deps);
      const rejected = expect(promise).rejects.toThrow("live_setup_timeout");
      await vi.advanceTimersByTimeAsync(20000); await rejected; expect(sockets[0].terminate).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("设置仅Extended带HIGH，音讯转录、上下文压缩与异步工具明确开启", () => {
    const simple = voiceSetup(creativeVoiceConnectionPlans(false)[0], "作品", "p");
    const extended = voiceSetup(creativeVoiceConnectionPlans(true)[0], "作品");
    expect(simple.setup.generationConfig.thinkingConfig).toBeUndefined();
    expect(extended.setup.generationConfig.thinkingConfig?.thinkingLevel).toBe("HIGH");
    expect(extended.setup.tools[0].functionDeclarations[0].behavior).toBe("NON_BLOCKING");
    expect(simple.setup.model).toContain("us-central1"); expect(simple.setup).toHaveProperty("outputAudioTranscription");
  });
  it("Extended中间发言结束仍等待IDLE，普通Live可以结束一轮", () => {
    const message = { serverContent: { turnComplete: true }, interaction_status: "IN_PROGRESS" };
    expect(creativeVoiceTurnIdle(true, message)).toBe(false); expect(creativeVoiceTurnIdle(false, message)).toBe(true);
    expect(creativeVoiceTurnIdle(true, { interaction_status: "IDLE" })).toBe(true);
  });
  it("遍历所有音讯parts、不读隐含思考，正常转发工具结果和字幕", () => {
    const events = normalizeVoiceMessage(false, { serverContent: { modelTurn: { parts: [{ thought: true, text: "内部" }, { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }, { inlineData: { data: "BBBB", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "公开回答" } }, toolCall: { functionCalls: [{ id: "one", name: "askCreativeAdvisor", args: { question: "请推荐合适的模板" } }] } });
    expect(events.filter(e => e.type === "audio")).toHaveLength(2); expect(JSON.stringify(events)).not.toContain("内部"); expect(events).toContainEqual({ type: "tool", id: "one", question: "请推荐合适的模板" });
  });
  it("拒绝超大帧、非法时间点和没有费用确认的启动", () => {
    expect(creativeVoiceInputSchema.safeParse({ type: "frame", data: "A".repeat(200001), atSec: 1, source: "影片" }).success).toBe(false);
    expect(creativeVoiceInputSchema.safeParse({ type: "frame", data: "AAAA", atSec: -1, source: "影片" }).success).toBe(false);
    expect(creativeVoiceInputSchema.safeParse({ type: "start", purpose: "discussion", context: "", projectKey: "p" }).success).toBe(false);
  });
});
it("视频候选采用工具只传操作，不接受模型跳过确认或自填结果URL", () => {
 const valid=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"video-apply",name:"creativeProduction",args:{action:"media",operation:"applyVideo"}}]}});
 expect(valid).toContainEqual({type:"production",id:"video-apply",action:{action:"media",operation:"applyVideo"}});
 const invalid=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"video-invalid",name:"creativeProduction",args:{action:"media",operation:"applyVideo",confirmed:true,url:"https://foreign/video.mp4"}}]}});
 expect(invalid.some(x=>x.type==="toolRejected")).toBe(true);
});

it("场景工具携带描述形成方案，但不能附带绕过费用确认",()=>{
 const args={action:"world",assetId:"scene-42",question:"保留木廊，月夜冷光，窗内暖灯，先给方案。"};
 const event=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"world-plan",name:"creativeProduction",args}]}});
 expect(event).toContainEqual({type:"production",id:"world-plan",action:args});
 const invalid=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"world-bypass",name:"creativeProduction",args:{...args,confirmed:true}}]}});
 expect(invalid.some(e=>e.type==="toolRejected")).toBe(true);
});

it("影片声音保留非语音输入，不让VAD抛弃环境声和音乐", () => {
  for (const extended of [false, true]) {
    for (const plan of creativeVoiceConnectionPlans(extended)) {
      expect(voiceSetup(plan, "", "p").setup.realtimeInputConfig.turnCoverage).toBe("TURN_INCLUDES_ALL_INPUT");
    }
  }
});
it("语音文字分镜工具声明与事件解析一致，采用不能携带隐式付费授权",()=>{
 const prepare=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"storyboard-test",name:"creativeProduction",args:{action:"prepareStoryboard",episode:1,question:"完整拆分本集镜头"}}]}});
 expect(prepare).toContainEqual({type:"production",id:"storyboard-test",action:{action:"prepareStoryboard",episode:1,question:"完整拆分本集镜头"}});
 const apply=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"adopt-test",name:"creativeProduction",args:{action:"applyStoryboard",episode:1}}]}});
 expect(apply).toContainEqual({type:"production",id:"adopt-test",action:{action:"applyStoryboard",episode:1}});
 const invalid=normalizeVoiceMessage(false,{toolCall:{functionCalls:[{id:"bypass-test",name:"creativeProduction",args:{action:"applyStoryboard",episode:1,confirmed:true}}]}});
 expect(invalid[0]?.type).toBe("toolRejected");
});

/**
 * 终审第三轮回归（0911）：
 * P1 流式完整性——断流的半截正文不得当成稿（真实适配器，只拦 fetch）；
 * P2 锁定自营供应商「无端点」要能换下一跳，安全/隐私拒绝仍终止；
 * P2 经济档跨网关回退记真账（实际外呼次数 + 成功网关 + 累计轨迹）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDistillLlmPossiblyChunked } from "./knowledgeCardDistill";
import { deriveKnowledgeCardCompact } from "./knowledgeCardLevelDerive";
import { invokeDeepSeekJsonChatRaw } from "./platformTopicShortlist";
import { KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK } from "../../shared/knowledgeCardDistillModels";

beforeEach(() => {
  vi.stubEnv("EVOLINK_API_KEY", "evo");
  vi.stubEnv("OPENROUTER_API_KEY", "or");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sg");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SECTIONS = [1, 2, 3]
  .map((n) => `## 第${n}节 现金流\n图：示意 ${n}\n- 先还高息负债，再谈投资比例\n- 留出六个月生活开支作缓冲\n\n| 项 | 值 |\n| - | - |\n| ${n} | ${n} |\n`)
  .join("\n");

const sseBody = (frames: string[]) =>
  new Response(frames.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
const dataFrame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const deltas = (text: string) =>
  (text.match(/[\s\S]{1,60}/g) || []).map((piece) => dataFrame({ model: "m", choices: [{ delta: { content: piece } }] }));
const stopFrame = dataFrame({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 12 } });
const DONE = "data: [DONE]\n\n";

/** 正常完整流 */
const okStream = (text: string) => sseBody([...deltas(text), stopFrame, DONE]);
/** 半截正文 + 上游 error 帧 + DONE */
const errorFrameStream = (text: string) =>
  sseBody([...deltas(text), dataFrame({ error: { code: 502, message: "upstream provider blew up" } }), DONE]);
/** 半截正文 + EOF（没有结束帧） */
const missingTerminalStream = (text: string) => sseBody([...deltas(text)]);
/** 半截正文 + 畸形业务帧 + stop */
const malformedStream = (text: string) =>
  sseBody([...deltas(text), "data: {\"choices\":[{\"delta\":{\"content\"\n\n", stopFrame, DONE]);

function stubFetch(responses: Array<() => Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body || "{}")) });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`多余的第 ${calls.length} 次请求`);
    return next();
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

const distillOnce = (opts?: { minSections?: number }) =>
  invokeDistillLlmPossiblyChunked({
    sourceText: "一段足够短的原稿，直接单发不切段。".repeat(8),
    extraText: "",
    imageUrls: [],
    documents: [],
    modelName: KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    minSectionsTotal: opts?.minSections ?? 2,
    detailLevel: "concise",
  });

describe("P1 流式完整性：断流不得当成稿（主提炼真实链路）", () => {
  it("正常分帧 → stop → DONE：正文完整交付", async () => {
    const { calls } = stubFetch([() => okStream(SECTIONS)]);
    const out = await distillOnce();
    expect(out).toContain("## 第1节");
    expect(out).toContain("## 第3节");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.stream).toBe(true);
    // 0911 用户令：读档链显式发 0.7，不许省略这个键落到供应商默认 1.0
    expect(calls[0]!.body.temperature).toBe(0.7);
  });

  it("末帧不带换行也算完整（收尾解析拿得到 finish_reason）", async () => {
    const frames = [...deltas(SECTIONS), stopFrame.replace(/\n\n$/, "")];
    const { calls } = stubFetch([() => sseBody(frames)]);
    const out = await distillOnce();
    expect(out).toContain("## 第1节");
    expect(calls).toHaveLength(1);
  });

  it("上游忽略 stream 回普通 JSON：兼容路径保留", async () => {
    const { calls } = stubFetch([
      () => new Response(JSON.stringify({ choices: [{ message: { content: SECTIONS }, finish_reason: "stop" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    ]);
    const out = await distillOnce();
    expect(out).toContain("## 第2节");
    expect(calls).toHaveLength(1);
  });

  it("半截正文 + error 帧 + DONE：本跳判失败换下一家，半截不交付", async () => {
    const { calls } = stubFetch([
      () => errorFrameStream(SECTIONS.slice(0, 80)),
      () => okStream(SECTIONS),
    ]);
    const out = await distillOnce();
    // 第二跳（同模型另一家）的完整稿才是结果
    expect(out).toContain("## 第3节");
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]!.url).hostname).toBe("openrouter.ai");
    expect(new URL(calls[1]!.url).hostname).toBe("direct.evolink.ai");
  });

  it("半截正文 + EOF（缺结束帧）：判失败换下一家", async () => {
    const { calls } = stubFetch([
      () => missingTerminalStream(SECTIONS.slice(0, 80)),
      () => okStream(SECTIONS),
    ]);
    const out = await distillOnce();
    expect(out).toContain("## 第3节");
    expect(calls).toHaveLength(2);
  });

  it("半截正文 + 畸形业务帧 + stop：不靠丢帧拼出缺字正文", async () => {
    const { calls } = stubFetch([
      () => malformedStream(SECTIONS.slice(0, 80)),
      () => okStream(SECTIONS),
    ]);
    const out = await distillOnce();
    expect(out).toContain("## 第3节");
    expect(calls).toHaveLength(2);
  });

  it("六跳全部断流：整体失败，不交半截稿", async () => {
    const { calls } = stubFetch(Array.from({ length: 6 }, () => () => errorFrameStream(SECTIONS.slice(0, 60))));
    await expect(distillOnce()).rejects.toThrow();
    expect(calls).toHaveLength(6);
  });
});

describe("P1 流式完整性：派生同样不收半截稿", () => {
  const FULL = `前言\n\n${SECTIONS}\n${SECTIONS.replace(/第(\d)节/g, "第$1x节")}`;
  it("error 帧 / 缺结束帧 / 畸形帧：都换下一跳，最终取完整稿", async () => {
    for (const broken of [errorFrameStream, missingTerminalStream, malformedStream]) {
      const { calls } = stubFetch([() => broken(SECTIONS), () => okStream(SECTIONS)]);
      const r = await deriveKnowledgeCardCompact({ fullMarkdown: FULL, targetSections: 3 });
      expect(r.sections).toBe(3);
      expect(calls).toHaveLength(2);
      vi.unstubAllGlobals();
    }
  });
});

describe("P2 锁定自营供应商无端点：换下一跳；安全拒绝：终止", () => {
  const noEndpoints = () =>
    new Response(JSON.stringify({ error: { code: 404, message: "No endpoints found matching your data policy" } }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  const guardrail = () =>
    new Response(JSON.stringify({ error: { code: 403, message: "Request blocked by provider guardrail (moderation)" } }), {
      status: 403, headers: { "content-type": "application/json" },
    });

  it("OpenRouter 锁定端点 404 No endpoints → 同模型 EvoLink 接住", async () => {
    const { calls } = stubFetch([noEndpoints, () => okStream(SECTIONS)]);
    const out = await distillOnce();
    expect(out).toContain("## 第1节");
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!.url).hostname).toBe("direct.evolink.ai");
  });

  it("同模型两家都 No endpoints → 落到另一档，最后才是 Qwen 两跳", async () => {
    const { calls } = stubFetch([
      noEndpoints, noEndpoints, // deepseek 两家
      noEndpoints, noEndpoints, // glm 两家
      () => okStream(SECTIONS), // 新加坡 Qwen
    ]);
    const out = await distillOnce();
    expect(out).toContain("## 第1节");
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      "openrouter.ai",
      "direct.evolink.ai",
      "openrouter.ai",
      "direct.evolink.ai",
      "token-plan.ap-southeast-1.maas.aliyuncs.com",
    ]);
    expect(calls[4]!.body.model).toBe("qwen3.8-max");
  });

  it("安全/内容策略拒答（guardrail / moderation）：确定性拒绝，整链终止、不再打第二家", async () => {
    const { calls } = stubFetch([guardrail]);
    await expect(distillOnce()).rejects.toThrow(/通道不可用/);
    expect(calls).toHaveLength(1);
  });

  it("「No endpoints … matching your data policy」是本跳不可用，不是安全拒答：照样换下一跳", async () => {
    const { calls } = stubFetch([noEndpoints, () => okStream(SECTIONS)]);
    const out = await distillOnce();
    expect(out).toContain("## 第1节");
    expect(calls).toHaveLength(2);
  });

  it("六跳全失败：抛错，不交空稿", async () => {
    const { calls } = stubFetch(Array.from({ length: 6 }, () => noEndpoints));
    await expect(distillOnce()).rejects.toThrow();
    expect(calls).toHaveLength(6);
  });
});

describe("P2 经济档跨网关回执：实际外呼次数与成功网关记真账", () => {
  const payload = JSON.stringify({ reportTitle: "标题够长", insightSummary: ["一条洞察"], trackGrowth: [{ a: 1 }] });

  it("OpenRouter 直接成功：1 次外呼，gateway=openrouter", async () => {
    const { calls } = stubFetch([() => okStream(payload)]);
    const json = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" });
    expect(calls).toHaveLength(1);
    expect(json.gateway).toBe("openrouter");
    expect(json.gatewayTrace).toEqual([{ gateway: "openrouter", model: "z-ai/glm-5.3", outcome: "ok" }]);
  });

  it("OpenRouter 失败、EvoLink 成功：2 次外呼，gateway=evolink，轨迹两条", async () => {
    const { calls } = stubFetch([
      () => new Response("or down", { status: 503 }),
      () => okStream(payload),
    ]);
    const json = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" });
    expect(calls).toHaveLength(2);
    expect(json.gateway).toBe("evolink");
    expect(json.gatewayTrace?.map((t) => `${t.gateway}:${t.outcome}`)).toEqual(["openrouter:failed", "evolink:ok"]);
    expect(calls[1]!.body.model).toBe("glm-5.3");
  });

  it("两跳都失败：错误带两条轨迹", async () => {
    stubFetch([
      () => new Response("or down", { status: 503 }),
      () => new Response("evo down", { status: 502 }),
    ]);
    const err = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { gatewayTrace?: Array<{ gateway: string; outcome: string }> }).gatewayTrace?.map((t) => `${t.gateway}:${t.outcome}`))
      .toEqual(["openrouter:failed", "evolink:failed"]);
  });

  it("只配了 EvoLink：1 次外呼，OpenRouter 记 skipped 不算外呼", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const { calls } = stubFetch([() => okStream(payload)]);
    const json = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u" });
    expect(calls).toHaveLength(1);
    expect(json.gateway).toBe("evolink");
    expect(json.gatewayTrace?.filter((t) => t.outcome !== "skipped_not_configured")).toHaveLength(1);
    expect(json.gatewayTrace?.some((t) => t.gateway === "openrouter" && t.outcome === "skipped_not_configured")).toBe(true);
  });

  it("调用前已取消：0 次外呼，错误带轨迹且不虚增次数", async () => {
    const { calls } = stubFetch([]);
    const ac = new AbortController();
    ac.abort(new Error("上游任务已截止"));
    const err = await invokeDeepSeekJsonChatRaw({ system: "s", user: "u", abortSignal: ac.signal }).catch((e) => e);
    expect(calls).toHaveLength(0);
    expect((err as { gatewayTrace?: unknown[] }).gatewayTrace?.filter?.(
      (t) => (t as { outcome: string }).outcome !== "skipped_not_configured",
    )).toHaveLength(0);
  });

  it("401 钥匙错：确定性失败不再打第二家", async () => {
    const { calls } = stubFetch([() => new Response("bad key", { status: 401 })]);
    await expect(invokeDeepSeekJsonChatRaw({ system: "s", user: "u" })).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });
});

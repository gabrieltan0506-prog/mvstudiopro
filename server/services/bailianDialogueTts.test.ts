/**
 * 百炼直连 TTS 的路由与参数纪律。**不发任何网络请求。**
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAILIAN_TTS_MODEL,
  BAILIAN_TTS_PATH,
  assertNoBracketEmotionTags,
  buildBailianTtsBody,
  listBailianTtsCredentials,
  normalizeBailianTtsVoice,
} from "./bailianDialogueTts";

afterEach(() => vi.unstubAllEnvs());

describe("路由：新加坡套餐优先，北京套餐兜底", () => {
  it("两区都配时新加坡排第一 —— 用户 0823 定：配音一律走新加坡", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sk-sp-sg");
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-bj");
    const list = listBailianTtsCredentials();
    expect(list.map((c) => c.region)).toEqual(["singapore", "beijing"]);
    expect(list[0]!.endpoint).toContain("token-plan.ap-southeast-1.maas.aliyuncs.com");
    expect(list[1]!.endpoint).toContain("token-plan.cn-beijing.maas.aliyuncs.com");
  });

  it("端点用套餐域，不是工作空间域 —— 套餐 key 打工作空间域是 401", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sk-sp-sg");
    vi.stubEnv("WAN_PLAN_API_KEY", "");
    const [sg] = listBailianTtsCredentials();
    expect(sg!.endpoint).not.toContain("ws-");
    expect(sg!.endpoint.endsWith(BAILIAN_TTS_PATH)).toBe(true);
  });

  it("只配北京时就只有北京", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "");
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-bj");
    expect(listBailianTtsCredentials().map((c) => c.region)).toEqual(["beijing"]);
  });

  it("一个都没配返回空数组，由调用方明确失败 —— 不静默回落按量通道", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "");
    vi.stubEnv("WAN_PLAN_API_KEY", "");
    expect(listBailianTtsCredentials()).toEqual([]);
  });

  it("base 末尾斜杠不会拼出双斜杠", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sk-sp-sg");
    vi.stubEnv("DASHSCOPE_SG_PLAN_BASE", "https://x.example.com/");
    expect(listBailianTtsCredentials()[0]!.endpoint).toBe(`https://x.example.com${BAILIAN_TTS_PATH}`);
  });
});

describe("方括号情绪标签必须拦在发请求之前", () => {
  it("百炼这条路上方括号标签是 411 整单失败，不是不生效", () => {
    expect(() => assertNoBracketEmotionTags("我不会走的[trembling]")).toThrow("411");
  });

  it("常见标签都拦得住", () => {
    for (const t of ["[angry]", "[whispers]", "[very slowly]", "[sad]"]) {
      expect(() => assertNoBracketEmotionTags(`台词${t}`)).toThrow();
    }
  });

  it("中文方括号与普通标点不误伤", () => {
    expect(() => assertNoBracketEmotionTags("他说：「我来了」【第一幕】")).not.toThrow();
  });

  it("instruction 里混进标签也拦", () => {
    expect(() =>
      buildBailianTtsBody({ text: "台词", voice: "longcanzhuyue", instructionZh: "[angry] 愤怒" }),
    ).toThrow("411");
  });
});

describe("voice 参数补全", () => {
  it("597 席后缀自动补完整模型前缀 —— 前缀必带", () => {
    expect(normalizeBailianTtsVoice("longcanzhuyue")).toBe(
      `${BAILIAN_TTS_MODEL}-longcanzhuyue`,
    );
  });

  it("已带前缀的不重复加", () => {
    const full = `${BAILIAN_TTS_MODEL}-longjufuhe`;
    expect(normalizeBailianTtsVoice(full)).toBe(full);
  });

  it("系统音色短名原样透传，不加前缀", () => {
    expect(normalizeBailianTtsVoice("longanhuan_v3.6")).toBe("longanhuan_v3.6");
  });

  it("空 voice 拒绝", () => {
    expect(() => normalizeBailianTtsVoice("  ")).toThrow("voice");
  });
});

describe("请求体", () => {
  it("情绪走 input.instruction 中文指令", () => {
    const b = buildBailianTtsBody({
      text: "我不会走的",
      voice: "longzhiqingxi",
      instructionZh: "压低声音，带着颤抖",
    }) as { model: string; input: Record<string, unknown> };
    expect(b.model).toBe(BAILIAN_TTS_MODEL);
    expect(b.input.text).toBe("我不会走的");
    expect(b.input.voice).toBe(`${BAILIAN_TTS_MODEL}-longzhiqingxi`);
    expect(b.input.instruction).toBe("压低声音，带着颤抖");
  });

  it("没有情绪指令时不带空字段", () => {
    const b = buildBailianTtsBody({ text: "台词", voice: "longcanzhuyue" }) as {
      input: Record<string, unknown>;
    };
    expect("instruction" in b.input).toBe(false);
  });

  it("空文本拒绝", () => {
    expect(() => buildBailianTtsBody({ text: "  ", voice: "longcanzhuyue" })).toThrow("文本");
  });
});

/**
 * 原生精读执行器：开关、format 挑选、prompt 硬约束。
 * 网络与文件系统部分不在此测（那需要真实 CDN/OSS），此处只锁纯逻辑。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNativeDeepReadPrompt,
  isManhuaNativeDeepReadEnabled,
  pickSmallestVideoFormat,
  resolveNativeDeepReadCredentials,
} from "./manhuaNativeDeepReadRunner";

afterEach(() => vi.unstubAllEnvs());

describe("生产开关", () => {
  it("默认关闭 —— 旁路没验稳前学习链路必须原样走抽帧", () => {
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ", "");
    expect(isManhuaNativeDeepReadEnabled()).toBe(false);
  });
  it("只有显式 =1 才开", () => {
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ", "true");
    expect(isManhuaNativeDeepReadEnabled()).toBe(false);
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ", "1");
    expect(isManhuaNativeDeepReadEnabled()).toBe(true);
  });
});

describe("pickSmallestVideoFormat：按体积挑，不按分辨率", () => {
  it("同为 540p 时选体积最小的那个", () => {
    const hit = pickSmallestVideoFormat([
      { format_id: "bytevc1_540p_a", url: "https://a", filesize: 120 * 1048576 },
      { format_id: "bytevc1_540p_b", url: "https://b", filesize: 37 * 1048576 },
    ]);
    expect(hit?.url).toBe("https://b");
    expect(Math.round(hit?.sizeMB ?? 0)).toBe(37);
  });

  it("不选 download_addr —— 它分辨率最低(405p)但体积是 540p 的 3~4 倍", () => {
    const hit = pickSmallestVideoFormat([
      { format_id: "download_addr", url: "https://raw", filesize: 497 * 1048576 },
      { format_id: "bytevc1_540p_x", url: "https://ok", filesize: 121 * 1048576 },
    ]);
    expect(hit?.url).toBe("https://ok");
  });

  it("没有 540p 档时返回 null，让调用方明确失败而不是乱挑", () => {
    expect(
      pickSmallestVideoFormat([{ format_id: "h264_720p", url: "https://x", filesize: 1 }]),
    ).toBeNull();
  });

  it("filesize 缺失的排在最后，不会顶掉有明确体积的候选", () => {
    const hit = pickSmallestVideoFormat([
      { format_id: "bytevc1_540p_nosize", url: "https://nosize" },
      { format_id: "bytevc1_540p_known", url: "https://known", filesize: 50 * 1048576 },
    ]);
    expect(hit?.url).toBe("https://known");
  });
});

describe("精读 prompt 的四条硬约束", () => {
  const p = buildNativeDeepReadPrompt(66, "身份揭穿的对白博弈");

  it("明写片长并要求覆盖到最后一秒（omni 曾只铺到 60/108 秒，根因就是漏了片长）", () => {
    expect(p).toContain("66 秒");
    expect(p).toContain("shots 覆盖 0 到 66 秒");
  });

  it("禁止编造运镜 —— 95 镜实测零套话靠的就是这句", () => {
    expect(p).toContain("看不出运动写「固定机位」");
    expect(p).toContain("禁止套「镜头拉远」");
  });

  it("可复用手法必须脱离剧情，否则产出退化成剧情复述", () => {
    expect(p).toContain("reusableZh 必须脱离具体剧情");
  });

  it("不写外部平台剧名/商标/原台词", () => {
    expect(p).toContain("不写外部平台剧名、商标、原台词原文");
  });

  it("段落提示为空时不留空括号", () => {
    expect(buildNativeDeepReadPrompt(32)).toContain("32 秒的高潮片段，");
    expect(buildNativeDeepReadPrompt(32)).not.toContain("（）");
  });
});


describe("凭证解析：套餐优先（0824 线路实测已验通）", () => {
  it("配了套餐 key 就走 token-plan 端点，不碰按量通道", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-plan");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-payg");
    const c = resolveNativeDeepReadCredentials();
    expect(c.usingPlan).toBe(true);
    expect(c.apiKey).toBe("sk-sp-plan");
    expect(c.endpoint).toContain("token-plan.cn-beijing.maas.aliyuncs.com");
    expect(c.endpoint).toContain("/api/v1/services/aigc/multimodal-generation/generation");
  });

  it("套餐没配才回落按量 —— 套餐额度不用即归零，默认不能选扣钱那条", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-payg");
    const c = resolveNativeDeepReadCredentials();
    expect(c.usingPlan).toBe(false);
    expect(c.apiKey).toBe("sk-ws-payg");
    expect(c.endpoint).toContain("dashscope.aliyuncs.com");
  });

  it("WAN_PLAN_BASE 可覆盖，且末尾斜杠不会拼出双斜杠", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-plan");
    vi.stubEnv("WAN_PLAN_BASE", "https://custom.example.com/");
    expect(resolveNativeDeepReadCredentials().endpoint).toBe(
      "https://custom.example.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  it("端点与 key 必须配对：套餐 key 绝不能拼到公共 dashscope 端点上（会 401）", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-plan");
    const c = resolveNativeDeepReadCredentials();
    expect(c.apiKey.startsWith("sk-sp-") && c.endpoint.includes("token-plan")).toBe(true);
  });
});

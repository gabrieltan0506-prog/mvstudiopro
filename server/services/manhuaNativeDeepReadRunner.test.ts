/**
 * 原生精读执行器：开关、format 挑选、prompt 硬约束。
 * 网络与文件系统部分不在此测（那需要真实 CDN/OSS），此处只锁纯逻辑。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_MODEL,
  assertNativeDeepReadPieceSize,
  buildNativeDeepReadPrompt,
  isManhuaNativeDeepReadEnabled,
  pickSmallestVideoFormat,
  resolveNativeDeepReadCredentials,
  resolveNativeDeepReadExecutionCredentials,
  validateNativeDeepReadSegments,
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

describe("模型名收口", () => {
  it("常量与请求体同源 —— provenance 记的必须是真跑的那个模型", () => {
    const src = readFileSync(
      new URL("./manhuaNativeDeepReadRunner.ts", import.meta.url),
      "utf8",
    );
    // 请求体里只允许引用常量；再出现字面量就是又写了第二遍
    expect(src).toContain("model: NATIVE_DEEP_READ_MODEL,");
    expect(src.match(/model: "qwen[^"]*"/g)).toBeNull();
    expect(NATIVE_DEEP_READ_MODEL).toBe("qwen3.8-max");
  });
});

describe("凭证裁决：组合必须成对，按量通道不许自动接管", () => {
  it("只传 apiKey 拒绝 —— 会把一类凭证配到另一类端点", () => {
    expect(() =>
      resolveNativeDeepReadExecutionCredentials({ apiKey: "sk-sp-x" }),
    ).toThrow("必须同时提供");
  });

  it("只传 endpoint 拒绝", () => {
    expect(() =>
      resolveNativeDeepReadExecutionCredentials({ endpoint: "https://a/b" }),
    ).toThrow("必须同时提供");
  });

  it("自定义 endpoint 必须 HTTPS", () => {
    expect(() =>
      resolveNativeDeepReadExecutionCredentials({ apiKey: "k", endpoint: "http://a/b" }),
    ).toThrow("HTTPS");
  });

  it("成对传入时放行，usingPlanQuota 留空（不是套餐也不是按量，是调用方自带）", () => {
    const c = resolveNativeDeepReadExecutionCredentials({
      apiKey: "k",
      endpoint: "https://a/b",
    });
    expect(c).toEqual({ apiKey: "k", endpoint: "https://a/b", usingPlan: undefined });
  });

  it("套餐没配且没开 ALLOW_PAYG 一律停手 —— 计划报的是套餐，实扣充值余额，检查单拦不住", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-pay");
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ_ALLOW_PAYG", "");
    expect(() => resolveNativeDeepReadExecutionCredentials({})).toThrow("ALLOW_PAYG");
  });

  it("显式 ALLOW_PAYG=1 才允许按量", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-pay");
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ_ALLOW_PAYG", "1");
    expect(resolveNativeDeepReadExecutionCredentials({}).usingPlan).toBe(false);
  });

  it("套餐配了就走套餐，不需要任何额外开关", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-plan");
    expect(resolveNativeDeepReadExecutionCredentials({}).usingPlan).toBe(true);
  });

  it("两把 key 都没有时报缺 key", () => {
    vi.stubEnv("WAN_PLAN_API_KEY", "");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "");
    expect(() => resolveNativeDeepReadExecutionCredentials({})).toThrow("缺少 API key");
  });
});

describe("切片体积闸（原先只是个没人读的常量）", () => {
  it("99,999 字节拒绝 —— CDN 抖动切出的残片喂给模型会报 Invalid video file", () => {
    expect(() => assertNativeDeepReadPieceSize(99_999)).toThrow("字节");
  });

  it("90MB 整放行", () => {
    expect(() => assertNativeDeepReadPieceSize(90 * 1024 * 1024)).not.toThrow();
  });

  it("超过 90MB 拒绝 —— 服务端下载 120 秒超时，超了必挂", () => {
    expect(() => assertNativeDeepReadPieceSize(90 * 1024 * 1024 + 1)).toThrow("上限");
  });

  it("NaN 拒绝", () => {
    expect(() => assertNativeDeepReadPieceSize(Number.NaN)).toThrow();
  });
});

describe("段规格前置校验（任何网络动作之前）", () => {
  it("空数组拒绝", () => {
    expect(() => validateNativeDeepReadSegments([])).toThrow("没有可执行片段");
  });

  it("秒位反了拒绝", () => {
    expect(() =>
      validateNativeDeepReadSegments([{ startSec: 30, endSec: 10 }]),
    ).toThrow("秒位无效");
  });

  it("NaN 拒绝", () => {
    expect(() =>
      validateNativeDeepReadSegments([{ startSec: Number.NaN, endSec: 10 }]),
    ).toThrow("秒位无效");
  });

  it("重复片段拒绝 —— 同段跑两遍，钱花两次、卡里镜头还重复", () => {
    expect(() =>
      validateNativeDeepReadSegments([
        { startSec: 0, endSec: 10 },
        { startSec: 0, endSec: 10 },
      ]),
    ).toThrow("重复片段");
  });

  it("超过 32 段拒绝", () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ startSec: i * 10, endSec: i * 10 + 5 }));
    expect(() => validateNativeDeepReadSegments(many)).toThrow("32段");
  });

  it("合法段原样返回并把秒位归一成数字", () => {
    expect(
      validateNativeDeepReadSegments([{ startSec: "3" as never, endSec: "9" as never }]),
    ).toEqual([{ startSec: 3, endSec: 9 }]);
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

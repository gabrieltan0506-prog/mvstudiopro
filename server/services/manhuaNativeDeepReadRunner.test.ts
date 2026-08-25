/**
 * 原生精读执行器：开关、format 挑选、prompt 硬约束。
 * 网络与文件系统部分不在此测（真实 CDN/GCS 已由 Fly 探针验证），此处锁路由与契约。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS,
  NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS,
  assertNativeDeepReadEpisodeEvidence,
  buildNativeDeepReadPrompt,
  buildSingaporeNativeDeepReadRequest,
  isManhuaNativeDeepReadEnabled,
  pickSmallestVideoFormat,
  packNativeDeepReadEpisodes,
  prepareEpisodeVideos,
  resolveNativeDeepReadBatchMaxPixels,
  resolveNativeDeepReadCredentials,
  resolveNativeDeepReadExecutionCredentials,
  resolveNativeDeepReadInputFps,
  runManhuaNativeDeepReadBatch,
  shouldReadNativeVideoDirectly,
  SINGAPORE_TOKEN_PLAN_CHAT_ENDPOINT,
  validateNativeDeepReadSegments,
  type NativeDeepReadMediaPreparationDeps,
} from "./manhuaNativeDeepReadRunner";
import {
  MANHUA_NATIVE_DEEP_READ_MODEL,
  MANHUA_NATIVE_DEEP_READ_MODEL_LABEL,
} from "../../shared/manhuaNativeDeepReadJob";

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
    expect(NATIVE_DEEP_READ_MODEL).toBe(MANHUA_NATIVE_DEEP_READ_MODEL);
    expect(MANHUA_NATIVE_DEEP_READ_MODEL_LABEL).toBe("Qwen 3.8 Max");
  });
});

describe("原生精读长请求时限", () => {
  it("空闲时限覆盖已实测的 473 秒首字节延迟，且仍短于总时限", () => {
    expect(NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS).toBe(600_000);
    expect(NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS).toBeGreaterThan(473_000);
    expect(NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS).toBe(1_800_000);
    expect(NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS).toBeLessThan(
      NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS,
    );
  });

  it("请求实现使用共享长请求常量，不得退回 120 秒短探活口径", () => {
    const src = readFileSync(
      new URL("./manhuaNativeDeepReadRunner.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("timeoutMs = NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS");
    expect(src).toContain("req.setTimeout(\n      NATIVE_DEEP_READ_REQUEST_IDLE_TIMEOUT_MS,");
    expect(src).not.toContain("req.setTimeout(120_000");
  });
});


describe("凭证裁决：组合必须成对，生产只走新加坡套餐", () => {
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

  it("新加坡套餐没配即停手，即使旧北京与按量 key 都存在也不接管", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "");
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-old-plan");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-pay");
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ_ALLOW_PAYG", "1");
    expect(() => resolveNativeDeepReadExecutionCredentials({})).toThrow(
      "DASHSCOPE_SG_PLAN_KEY",
    );
  });

  it("新加坡套餐配了就走套餐，不需要任何额外开关", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sk-sp-plan");
    expect(resolveNativeDeepReadExecutionCredentials({}).usingPlan).toBe(true);
  });

  it("新加坡 key 没有时报缺配置", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "");
    expect(() => resolveNativeDeepReadExecutionCredentials({})).toThrow("禁止回落按量通道");
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
    expect(p).toContain("分析描述不写外部平台剧名、商标或原台词");
    expect(p).toContain("subtitles 是唯一例外");
  });

  it("段落提示为空时不留空括号", () => {
    expect(buildNativeDeepReadPrompt(32)).toContain("32 秒的完整剧集");
    expect(buildNativeDeepReadPrompt(32)).not.toContain("（）");
  });
});


describe("凭证解析：固定新加坡 Token Plan（0825 真实视频探针已通）", () => {
  it("配了新加坡套餐 key 就走固定 OpenAI 兼容端点", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sk-sp-plan");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-payg");
    const c = resolveNativeDeepReadCredentials();
    expect(c.usingPlan).toBe(true);
    expect(c.apiKey).toBe("sk-sp-plan");
    expect(c.endpoint).toBe(SINGAPORE_TOKEN_PLAN_CHAT_ENDPOINT);
    expect(c.endpoint).toContain("token-plan.ap-southeast-1.maas.aliyuncs.com");
    expect(c.endpoint).toContain("/compatible-mode/v1/chat/completions");
  });

  it("新加坡套餐没配不会读取旧 key", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "");
    vi.stubEnv("WAN_PLAN_API_KEY", "sk-sp-old-plan");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "sk-ws-payg");
    const c = resolveNativeDeepReadCredentials();
    expect(c.usingPlan).toBe(true);
    expect(c.apiKey).toBe("");
    expect(c.endpoint).toBe(SINGAPORE_TOKEN_PLAN_CHAT_ENDPOINT);
  });

  it("普通新加坡业务空间地址不能覆盖套餐端点（实测会 401）", () => {
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sk-sp-plan");
    vi.stubEnv("DASHSCOPE_SG_BASE", "https://workspace.ap-southeast-1.maas.aliyuncs.com");
    const c = resolveNativeDeepReadCredentials();
    expect(c.endpoint).toBe(SINGAPORE_TOKEN_PLAN_CHAT_ENDPOINT);
  });
});

describe("整集直读与自适应采样", () => {
  it("十集90秒装一包，十集18分钟按视觉预算装成三包", () => {
    const short = Array.from({ length: 10 }, () => ({
      durationSec: 90,
      segments: [{ startSec: 0, endSec: 90 }],
    }));
    const long = Array.from({ length: 10 }, () => ({
      durationSec: 1080,
      segments: [
        { startSec: 0, endSec: 360 },
        { startSec: 360, endSec: 720 },
        { startSec: 720, endSec: 1080 },
      ],
    }));
    expect(packNativeDeepReadEpisodes(short)).toHaveLength(1);
    expect(packNativeDeepReadEpisodes(long).map((pack) => pack.length)).toEqual([4, 4, 2]);
    expect(resolveNativeDeepReadBatchMaxPixels(short)).toBeGreaterThanOrEqual(65_536);
  });
  it("151 秒完整单段直接读 CDN，不创建临时片", () => {
    expect(
      shouldReadNativeVideoDirectly({
        sourceDurationSec: 151,
        segments: [{ startSec: 0, endSec: 151 }],
      }),
    ).toBe(true);
  });

  it("18 分钟仍是一个完整单段，文件编码和体积不参与路由", () => {
    expect(
      shouldReadNativeVideoDirectly({
        sourceDurationSec: 1080,
        segments: [{ startSec: 0, endSec: 1080 }],
      }),
    ).toBe(true);
  });

  it("单段没有覆盖完整素材时不得直读，否则秒位会错", () => {
    expect(
      shouldReadNativeVideoDirectly({
        sourceDurationSec: 151,
        segments: [{ startSec: 10, endSec: 100 }],
      }),
    ).toBe(false);
  });

  it("请求体使用 OpenAI video_url 契约与自适应 fps，不残留原生 DashScope input", () => {
    const request = buildSingaporeNativeDeepReadRequest("https://cdn/video", 151);
    expect(request).toMatchObject({
      model: "qwen3.8-max",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "video_url",
              video_url: { url: "https://cdn/video" },
              fps: 10,
              min_pixels: 65_536,
              max_pixels: 655_360,
            },
            { type: "text" },
          ],
        },
      ],
      enable_thinking: true,
      max_tokens: 60_000,
    });
    expect(request).not.toHaveProperty("input");
    expect(request).not.toHaveProperty("parameters");
  });

  it("长片按约 1800 帧反算 fps，仍覆盖全片", () => {
    expect(resolveNativeDeepReadInputFps(1080)).toBe(1.66);
    expect(resolveNativeDeepReadInputFps(3600)).toBe(0.5);
    const request = buildSingaporeNativeDeepReadRequest("https://cdn/long", 3600) as {
      messages: Array<{ content: Array<{ fps?: number; video_url?: { fps?: number } }> }>;
    };
    expect(request.messages[0]?.content[0]?.fps).toBe(0.5);
    expect(request.messages[0]?.content[0]?.video_url).not.toHaveProperty("fps");
  });
});

describe("多分片证据关闭式门禁", () => {
  const segments = [
    { startSec: 0, endSec: 10 },
    { startSec: 10, endSec: 20 },
  ];
  const validRaw = {
    segmentCoverage: [
      { segmentIndex: 0, startSec: 0, endSec: 10, evidenceZh: "室内近景里人物抬手" },
      { segmentIndex: 1, startSec: 10, endSec: 20, evidenceZh: "室外全景里车辆驶过" },
    ],
    shots: [
      { startSec: 0, endSec: 10 },
      { startSec: 10, endSec: 20 },
    ],
  };

  it("每个分片身份、秒位、独有证据齐全且镜头连续时放行", () => {
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 7,
      durationSec: 20,
      segments,
      raw: validRaw,
    })).not.toThrow();
  });

  it.each([
    ["缺片", { ...validRaw, segmentCoverage: validRaw.segmentCoverage.slice(0, 1) }],
    ["重复身份", { ...validRaw, segmentCoverage: [validRaw.segmentCoverage[0], validRaw.segmentCoverage[0]] }],
    ["错秒位", { ...validRaw, segmentCoverage: [validRaw.segmentCoverage[0], { ...validRaw.segmentCoverage[1], startSec: 11 }] }],
    ["非数字秒位", { ...validRaw, segmentCoverage: [validRaw.segmentCoverage[0], { ...validRaw.segmentCoverage[1], startSec: "10" }] }],
    ["空证据", { ...validRaw, segmentCoverage: [validRaw.segmentCoverage[0], { ...validRaw.segmentCoverage[1], evidenceZh: " " }] }],
    ["重复证据", { ...validRaw, segmentCoverage: [validRaw.segmentCoverage[0], { ...validRaw.segmentCoverage[1], evidenceZh: validRaw.segmentCoverage[0].evidenceZh }] }],
    ["镜头缺口", { ...validRaw, shots: [{ startSec: 0, endSec: 8 }, { startSec: 10, endSec: 20 }] }],
  ])("%s 时整集拒绝入库", (_label, raw) => {
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 7,
      durationSec: 20,
      segments,
      raw,
    })).toThrow("整包拒绝入库");
  });
});

describe("模型请求前的媒体准备边界", () => {
  it("整集直读在发出付费请求前才刷新短效 URL", async () => {
    const order: string[] = [];
    const resolveNodes = vi.fn(async () => {
      order.push("refresh-url");
      return [{ url: "https://cdn.example/fresh.mp4" }];
    });
    const post = vi.fn(async (body: unknown) => {
      order.push("post-model");
      const content = (body as {
        messages: Array<{ content: Array<Record<string, unknown>> }>;
      }).messages[0]?.content || [];
      expect(content[1]).toMatchObject({
        type: "video_url",
        video_url: { url: "https://cdn.example/fresh.mp4" },
      });
      return {
        status: 200,
        text: JSON.stringify({
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          choices: [{
            finish_reason: "stop",
            message: { content: JSON.stringify({ episodes: [{
              episodeIndex: 1,
              segmentCoverage: [{ segmentIndex: 0, startSec: 0, endSec: 10, evidenceZh: "人物从门口走到桌前" }],
              shots: [{ startSec: 0, endSec: 10, actionZh: "人物走到桌前", cameraMoveZh: "固定机位" }],
              subtitles: [],
              audioResolution: [],
              beatStructureZh: "进入场景后停步",
            }] }) },
          }],
        }),
      };
    });

    await runManhuaNativeDeepReadBatch({
      episodes: [{
        episodeIndex: 1,
        resolveNodes,
        segments: [{ startSec: 0, endSec: 10 }],
        sourceDurationSec: 10,
      }],
      apiKey: "fake-key",
      endpoint: "https://model.example/v1/chat/completions",
      onModelReceipt: (receipt) => {
        if (receipt.status === "started") order.push("started-receipt");
      },
    }, {
      prepareVideos: prepareEpisodeVideos,
      post: post as never,
      remove: vi.fn(async () => undefined),
    });

    expect(resolveNodes).toHaveBeenCalledTimes(1);
    expect(order.slice(0, 3)).toEqual(["refresh-url", "started-receipt", "post-model"]);
  });

  it("新加坡套餐 400 会把供应商正文与 request-id 写入失败回执", async () => {
    const receipts: Array<Record<string, unknown>> = [];
    const run = runManhuaNativeDeepReadBatch({
      episodes: [{
        episodeIndex: 3,
        resolveNodes: async () => [{ url: "https://cdn.example/fresh.mp4" }],
        segments: [{ startSec: 0, endSec: 10 }],
        sourceDurationSec: 10,
      }],
      apiKey: "fake-key",
      endpoint: "https://model.example/v1/chat/completions",
      onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
    }, {
      prepareVideos: prepareEpisodeVideos,
      post: vi.fn(async () => ({
        status: 400,
        requestId: "req-qwen-400",
        text: JSON.stringify({ error: {
          code: "invalid_parameter",
          message: "video budget exceeded",
          param: "messages[0].content",
          type: "invalid_request_error",
        } }),
      })) as never,
      remove: vi.fn(async () => undefined),
    });
    await expect(run).rejects.toThrow(
      "新加坡 Qwen 3.8 Max Token Plan HTTP 400 · code=invalid_parameter",
    );
    const failed = receipts.find((receipt) => receipt.status === "failed");
    expect(failed).toMatchObject({
      callId: expect.any(String),
      model: "qwen3.8-max",
      route: "singapore_token_plan",
      stage: "visual_model",
      status: "failed",
      providerError: {
        httpStatus: 400,
        code: "invalid_parameter",
        message: "video budget exceeded",
        requestId: "req-qwen-400",
        param: "messages[0].content",
      },
    });
  });

  it("切片失败会刷新媒体节点后安全重试，并清理每次本地临时路径", async () => {
    const resolveNodes = vi.fn()
      .mockResolvedValueOnce([{ url: "https://cdn.example/expired.mp4" }])
      .mockResolvedValueOnce([{ url: "https://cdn.example/fresh.mp4" }]);
    const runMedia = vi.fn()
      .mockRejectedValueOnce(new Error("cdn expired"))
      .mockResolvedValueOnce("");
    const unlinkLocal = vi.fn(async () => undefined);
    const upload = vi.fn(async ({ objectName }: { objectName: string }) => ({
      bucket: "test-bucket",
      objectName,
      gcsUri: `gs://test-bucket/${objectName}`,
    }));
    const deps: NativeDeepReadMediaPreparationDeps = {
      runMedia,
      statLocal: vi.fn(async () => ({ size: 200_000 })),
      readLocal: vi.fn(async () => Buffer.from("fixture")),
      unlinkLocal,
      upload: upload as never,
      remove: vi.fn(async () => undefined),
      signReadUrl: vi.fn(() => "https://gcs.example/signed.mp4"),
    };

    const prepared = await prepareEpisodeVideos({
      episodeIndex: 2,
      resolveNodes,
      segments: [{ startSec: 0, endSec: 10 }],
      sourceDurationSec: 20,
    }, undefined, deps);

    expect(resolveNodes).toHaveBeenCalledTimes(2);
    expect(runMedia).toHaveBeenCalledTimes(2);
    expect(runMedia.mock.calls[0]?.[1]).toContain("https://cdn.example/expired.mp4");
    expect(runMedia.mock.calls[1]?.[1]).toContain("https://cdn.example/fresh.mp4");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(unlinkLocal).toHaveBeenCalledTimes(2);
    expect(prepared).toMatchObject([{
      url: "https://gcs.example/signed.mp4",
      startSec: 0,
      endSec: 10,
      temporaryGcs: { bucket: "test-bucket" },
    }]);
  });
});

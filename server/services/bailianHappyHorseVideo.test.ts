import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BAILIAN_HAPPYHORSE_I2V_MODEL,
  buildBailianHappyHorseSubmitBody,
  isBailianHappyHorseConfigured,
  isBailianHappyHorseSubmitRejected,
  isBailianHappyHorseSubmitUnknown,
  pollBailianHappyHorseOnce,
  submitBailianHappyHorseVideo,
} from "./bailianHappyHorseVideo";

describe("bailianHappyHorseVideo · 百炼官方主通道", () => {
  beforeEach(() => {
    vi.stubEnv("WAN_OFFICIAL_BASE", "https://bl.example.cn");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "bl-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("配置判定:base 与 key 缺一即未配置", () => {
    expect(isBailianHappyHorseConfigured()).toBe(true);
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "");
    expect(isBailianHappyHorseConfigured()).toBe(false);
  });

  it("载荷:官方 i2v 契约——media first_frame、resolution 大写、watermark 关、时长钳 5/10/15", () => {
    const body = buildBailianHappyHorseSubmitBody({
      prompt: "轻风拂面",
      imageUrl: "https://img.example/kf.png",
      duration: 10,
      resolution: "720p",
    }) as {
      model: string;
      input: { prompt: string; media: Array<{ type: string; url: string }> };
      parameters: { resolution: string; duration: number; watermark: boolean };
    };
    expect(body.model).toBe(BAILIAN_HAPPYHORSE_I2V_MODEL);
    expect(body.input.media).toEqual([
      { type: "first_frame", url: "https://img.example/kf.png" },
    ]);
    expect(body.parameters).toEqual({ resolution: "720P", duration: 10, watermark: false });
    expect(() =>
      buildBailianHappyHorseSubmitBody({ prompt: "x", imageUrl: "https://a/b.png", duration: 7 }),
    ).toThrow(/5、10 或 15/);
    expect(() => buildBailianHappyHorseSubmitBody({ prompt: "x", imageUrl: "" })).toThrow(
      /首帧参考图/,
    );
  });

  it("提交:异步头在场,task_id 回填;上游报错原样抛出供回落判断", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ output: { task_id: "t-1" } }), { status: 200 });
      }),
    );
    const out = await submitBailianHappyHorseVideo({
      prompt: "p",
      imageUrl: "https://a/b.png",
      duration: 5,
      resolution: "720p",
    });
    expect(out.bailianTaskId).toBe("t-1");
    expect(calls[0].url).toBe(
      "https://bl.example.cn/api/v1/services/aigc/video-generation/video-synthesis",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-DashScope-Async"]).toBe("enable");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: "Throttling", message: "qps" }), { status: 429 }),
      ),
    );
    await expect(
      submitBailianHappyHorseVideo({ prompt: "p", imageUrl: "https://a/b.png" }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it("提交错误分级(六审第8条):4xx=明确拒绝可回落;网络断/5xx=结果未知禁回落", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "InvalidParameter" }), { status: 400 })),
    );
    const rejected = await submitBailianHappyHorseVideo({ prompt: "p", imageUrl: "https://a/b.png" }).catch((e) => e);
    expect(isBailianHappyHorseSubmitRejected(rejected)).toBe(true);
    expect(isBailianHappyHorseSubmitUnknown(rejected)).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );
    const unknownNet = await submitBailianHappyHorseVideo({ prompt: "p", imageUrl: "https://a/b.png" }).catch((e) => e);
    expect(isBailianHappyHorseSubmitUnknown(unknownNet)).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 502 })));
    const unknown5xx = await submitBailianHappyHorseVideo({ prompt: "p", imageUrl: "https://a/b.png" }).catch((e) => e);
    expect(isBailianHappyHorseSubmitUnknown(unknown5xx)).toBe(true);
    expect(isBailianHappyHorseSubmitRejected(unknown5xx)).toBe(false);
  });

  it("轮询:SUCCEEDED 取 video_url;FAILED 带上游 message;PENDING 继续跑", async () => {
    const seq = [
      { output: { task_status: "PENDING" } },
      { output: { task_status: "FAILED", message: "内容审核未通过" } },
      { output: { task_status: "SUCCEEDED", video_url: "https://oss/v.mp4" } },
    ];
    let i = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(seq[i++]), { status: 200 })),
    );
    expect(await pollBailianHappyHorseOnce("t")).toEqual({ state: "running", status: "pending" });
    expect(await pollBailianHappyHorseOnce("t")).toEqual({
      state: "failed",
      error: "内容审核未通过",
    });
    expect(await pollBailianHappyHorseOnce("t")).toEqual({
      state: "completed",
      sourceUrl: "https://oss/v.mp4",
    });
  });

  it("轮询容错(六审第10条):查询侧任何故障都不冒充生成失败——5xx/网络断/401/404/配置缺失全记瞬态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await pollBailianHappyHorseOnce("t")).toEqual({
      state: "running",
      status: "transient_query_http_503",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await pollBailianHappyHorseOnce("t")).toEqual({
      state: "running",
      status: "transient_fetch_error",
    });
    for (const code of [400, 401, 403, 404]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: code })));
      expect(await pollBailianHappyHorseOnce("t")).toEqual({
        state: "running",
        status: `transient_query_http_${code}`,
      });
    }
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "");
    expect(await pollBailianHappyHorseOnce("t")).toEqual({
      state: "running",
      status: "transient_local_config_unavailable",
    });
  });
});

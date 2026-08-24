/**
 * Wan 3.0 **两套接口**的字段边界。
 *
 * 两套协议不是一套、字段不得混用——最容易栽的是分辨率大小写
 * （百炼 `480P` / WaveSpeed `480p`），抄串就是参数错误，
 * 而异步任务要等轮询才知道失败。
 */
import { describe, expect, it } from "vitest";
import {
  WAN_BAILIAN_ASYNC_HEADER,
  WAN_BAILIAN_MODEL,
  WAN_BAILIAN_PATH,
  buildWanBailianRequest,
  clampWanBailianDuration,
} from "./wanBailianNative";
import {
  WAN30_ASPECT_RATIOS,
  WAN30_DURATION,
  WAN30_POLL_INTERVAL_MS,
  WAN30_REFERENCE_MAX,
  WAN30_SEED_RANGE,
  WAN30_TERMINAL_STATUSES,
  WAN30_WAVESPEED_PATH,
  buildWan30ReferenceToVideoRequest,
  normalizeWan30Seed,
  wan30BilledSeconds,
  wan30EstimatedUsd,
  wan30ResultUrl,
} from "./wanWavespeedModels";

describe("百炼原生", () => {
  it("端点与异步头照官方 curl", () => {
    expect(WAN_BAILIAN_PATH).toBe("/api/v1/services/aigc/video-generation/video-synthesis");
    expect(WAN_BAILIAN_ASYNC_HEADER["X-DashScope-Async"]).toBe("enable");
    expect(WAN_BAILIAN_MODEL).toBe("wan3.0-video");
  });

  it("提示词在 input.prompt，参数在 parameters，分辨率**大写 P**", () => {
    const b = buildWanBailianRequest({ prompt: "小猫在屋顶奔跑", durationSec: 5 });
    expect(b.input.prompt).toBe("小猫在屋顶奔跑");
    expect(b.parameters.resolution).toBe("480P");
    expect(b.parameters.ratio).toBe("adaptive");
    expect(b.parameters.duration).toBe(5);
  });

  it("media 只收 https，且没有素材时不塞空数组", () => {
    expect(
      buildWanBailianRequest({ prompt: "p", media: [{ type: "image", url: "http://x/a.jpg" }] })
        .input.media,
    ).toBeUndefined();
  });

  it("时长夹到 2–30", () => {
    expect(clampWanBailianDuration(1)).toBe(2);
    expect(clampWanBailianDuration(99)).toBe(30);
  });
});

describe("WaveSpeed reference-to-video", () => {
  const base = { prompt: "西部追车", referenceImages: ["https://x/1.jpg"] };

  it("端点与轮询口径照官方", () => {
    expect(WAN30_WAVESPEED_PATH).toBe("/api/v3/alibaba/wan-3.0/reference-to-video");
    expect(WAN30_POLL_INTERVAL_MS).toBe(2000);
    expect([...WAN30_TERMINAL_STATUSES]).toEqual(["completed", "failed", "cancelled", "timeout"]);
    expect(wan30ResultUrl("abc")).toContain("/api/v3/predictions/abc/result");
  });

  it("字段是顶层 prompt ＋ reference_*，分辨率**小写 p** —— 与百炼相反", () => {
    const r = buildWan30ReferenceToVideoRequest({ ...base, resolution: "480p" });
    expect(r.prompt).toBe("西部追车");
    expect(r.reference_images).toEqual(["https://x/1.jpg"]);
    expect(r.resolution).toBe("480p");
    expect("input" in r).toBe(false);
  });

  it("三类参考一个都没有直接拒 —— 上游要求至少一类", () => {
    expect(() => buildWan30ReferenceToVideoRequest({ prompt: "p" })).toThrow("至少需要一类");
  });

  it("参考数量按 10/5/5 截断", () => {
    const r = buildWan30ReferenceToVideoRequest({
      prompt: "p",
      referenceImages: Array.from({ length: 20 }, (_, i) => `https://x/${i}.jpg`),
    });
    expect(r.reference_images).toHaveLength(WAN30_REFERENCE_MAX.image);
  });

  it("默认时长 5 秒 —— **不是 30**。按秒计费向上取整，默认 30s/1080p 一发 $8.40", () => {
    expect(WAN30_DURATION.default).toBe(5);
    expect(buildWan30ReferenceToVideoRequest(base).duration).toBe(5);
    // 范围仍是 2–30，想要 30 秒照样填
    expect(buildWan30ReferenceToVideoRequest({ ...base, durationSec: 30 }).duration).toBe(30);
  });

  it("计费秒数向上取整并夹到 2–30", () => {
    expect(wan30BilledSeconds(4.2)).toBe(5);
    expect(wan30BilledSeconds(0.5)).toBe(2);
    expect(wan30BilledSeconds(99)).toBe(30);
  });

  it("报价与官方例子对得上", () => {
    expect(wan30EstimatedUsd("720p", 5)).toBeCloseTo(0.65, 2);
    expect(wan30EstimatedUsd("1080p", 30)).toBeCloseTo(8.4, 2);
    expect(wan30EstimatedUsd("480p", 2)).toBeCloseTo(0.14, 2);
  });

  it("六档比例齐全（原先漏了 4:3 与 3:4）", () => {
    expect([...WAN30_ASPECT_RATIOS]).toContain("4:3");
    expect([...WAN30_ASPECT_RATIOS]).toContain("3:4");
  });

  it("seed：-1 与缺省＝随机不传；越界夹到上限", () => {
    expect(normalizeWan30Seed(-1)).toBeUndefined();
    expect(normalizeWan30Seed(undefined)).toBeUndefined();
    expect(normalizeWan30Seed(WAN30_SEED_RANGE.max + 5)).toBe(WAN30_SEED_RANGE.max);
    expect(buildWan30ReferenceToVideoRequest({ ...base, seed: 42 }).seed).toBe(42);
  });

  it("enable_audio 显式传，不依赖上游默认值", () => {
    expect(buildWan30ReferenceToVideoRequest(base).enable_audio).toBe(true);
    expect(buildWan30ReferenceToVideoRequest({ ...base, enableAudio: false }).enable_audio).toBe(
      false,
    );
  });

  it("thinking_mode 不开就不传", () => {
    expect("thinking_mode" in buildWan30ReferenceToVideoRequest(base)).toBe(false);
    expect(buildWan30ReferenceToVideoRequest({ ...base, thinkingMode: true }).thinking_mode).toBe(
      true,
    );
  });
});

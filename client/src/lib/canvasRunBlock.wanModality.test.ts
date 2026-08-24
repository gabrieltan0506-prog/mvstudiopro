/**
 * Wan 3.0 四模态契约：卡面宣称「文/图/视频/音频」，请求体就必须真的有。
 *
 * 上一版 UI 收了参考视频，payload 却整份丢掉 —— 不报错，用户以为喂进去了，
 * 成片自然对不上。这条测试就是钉住「宣称＝实发」。
 */
import { describe, expect, it } from "vitest";
import { buildWan30RequestBody, MANHUA_WAN_CLIP_DEFAULT_SEC } from "./canvasRunBlock";

const base = { prompt: "p", images: ["https://i/1.png"], aspectRatio: "9:16" as const };

describe("buildWan30RequestBody · 四模态", () => {
  it("参考视频进请求体，不再被丢掉", () => {
    const body = buildWan30RequestBody({
      ...base,
      videoUrls: ["https://v/1.mp4", "https://v/2.mp4"],
    });
    expect(body.videoUrls).toEqual(["https://v/1.mp4", "https://v/2.mp4"]);
  });

  it("参考视频按 Wan 契约钳到 5 段", () => {
    const body = buildWan30RequestBody({
      ...base,
      videoUrls: Array.from({ length: 9 }, (_, i) => `https://v/${i}.mp4`),
    });
    expect((body.videoUrls as string[]).length).toBe(5);
  });

  it("没有参考视频时是空数组，不是 undefined（下游一律按数组处理）", () => {
    expect(buildWan30RequestBody(base).videoUrls).toEqual([]);
  });

  it("音频仍按 5 段钳制，未受影响", () => {
    const body = buildWan30RequestBody({
      ...base,
      audioUrls: Array.from({ length: 7 }, (_, i) => `https://a/${i}.mp3`),
    });
    expect((body.audioUrls as string[]).length).toBe(5);
  });
});

describe("默认时长 · 漫剧段口径与引擎口径分开", () => {
  it("缺省走漫剧段 30 秒（段表 4 段 × 30s），不是引擎默认 5 秒", () => {
    expect(MANHUA_WAN_CLIP_DEFAULT_SEC).toBe(30);
    expect(buildWan30RequestBody(base).duration).toBe(30);
  });

  it("显式时长优先，且钳在 2–30", () => {
    expect(buildWan30RequestBody({ ...base, duration: 15 }).duration).toBe(15);
    expect(buildWan30RequestBody({ ...base, duration: 99 }).duration).toBe(30);
    expect(buildWan30RequestBody({ ...base, duration: 1 }).duration).toBe(2);
  });
});

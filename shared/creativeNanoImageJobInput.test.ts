import { describe, expect, it } from "vitest";
import {
  CREATIVE_NANO_IMAGE_ACTION,
  CREATIVE_NANO_IMAGE_CREDITS,
  CREATIVE_NANO_IMAGE_QUALITY,
  buildCreativeNanoImageJobInput,
  isCreativeNanoImageJob,
} from "./creativeNanoImageJobInput";

describe("Creative Nano 付费任务契约", () => {
  it("客户端载荷只保留提示词与画幅，价格和 1K 档固定在服务端常量", () => {
    const input = buildCreativeNanoImageJobInput({
      prompt: "  cinematic portrait  ",
      aspectRatio: "16:9",
    });
    expect(input).toEqual({
      action: CREATIVE_NANO_IMAGE_ACTION,
      params: { prompt: "cinematic portrait", aspectRatio: "16:9" },
    });
    expect(CREATIVE_NANO_IMAGE_CREDITS).toBe(35);
    expect(CREATIVE_NANO_IMAGE_QUALITY).toBe("1k");
    expect(input.params).not.toHaveProperty("model");
    expect(input.params).not.toHaveProperty("quality");
    expect(input.params).not.toHaveProperty("credits");
  });

  it("未知画幅钳到 9:16，action 判定不接受数组或近似名称", () => {
    expect(buildCreativeNanoImageJobInput({ prompt: "p", aspectRatio: "4K" }).params.aspectRatio)
      .toBe("9:16");
    expect(isCreativeNanoImageJob({ action: CREATIVE_NANO_IMAGE_ACTION, params: {} })).toBe(true);
    expect(isCreativeNanoImageJob({ action: "creativeNanoImage" })).toBe(false);
    expect(isCreativeNanoImageJob([{ action: CREATIVE_NANO_IMAGE_ACTION }])).toBe(false);
  });
});

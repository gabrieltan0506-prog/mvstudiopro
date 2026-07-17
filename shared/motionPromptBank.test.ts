import { describe, expect, it } from "vitest";
import {
  MOTION_PROMPT_BANK,
  buildMotionPromptInjectBlock,
  getMotionPromptById,
  listMotionPromptsByCategory,
  recommendMotionPromptFromTopic,
} from "./motionPromptBank";

describe("motionPromptBank", () => {
  it("has four categories with expected counts", () => {
    expect(listMotionPromptsByCategory("logo")).toHaveLength(8);
    expect(listMotionPromptsByCategory("product_ad")).toHaveLength(7);
    expect(listMotionPromptsByCategory("data")).toHaveLength(7);
    expect(listMotionPromptsByCategory("caption")).toHaveLength(12);
    expect(MOTION_PROMPT_BANK).toHaveLength(34);
  });

  it("looks up and builds inject block without vendor leak", () => {
    const e = getMotionPromptById("product_05_exploded_view");
    expect(e?.nameZh).toBe("爆炸拆解");
    const block = buildMotionPromptInjectBlock(["caption_09_word_halo", "logo_03_rgb_flash"]);
    expect(block).toContain("词环头顶");
    expect(block).toContain("RGB 色散快闪");
    expect(block).not.toMatch(/HyperFrames|xiaolan|小蓝不打工/i);
  });

  it("recommends motion from product topic", () => {
    const rec = recommendMotionPromptFromTopic("产品拆解种草开箱");
    expect(rec.motionId).toBe("product_05_exploded_view");
    expect(rec.reasonZh).toMatch(/产品|拆解/);
  });

  it("recommends finer motion keywords", () => {
    expect(recommendMotionPromptFromTopic("电竞RGB片头").motionId).toBe("logo_03_rgb_flash");
    expect(recommendMotionPromptFromTopic("KPI看板增长").motionId).toBe("data_01_dashboard");
    expect(recommendMotionPromptFromTopic("反转句揭晓字幕").motionId).toBe("caption_11_mask_wipe");
    expect(recommendMotionPromptFromTopic("今天吃面").motionId).toBeNull();
  });
});

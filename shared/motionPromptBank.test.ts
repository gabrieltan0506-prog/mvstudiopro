import { describe, expect, it } from "vitest";
import {
  MOTION_PROMPT_BANK,
  MOTION_PROMPT_CATEGORY_LABEL_ZH,
  type MotionPromptCategory,
  buildMotionPromptInjectBlock,
  getMotionPromptById,
  listMotionPromptsByCategory,
  recommendMotionPromptFromTopic,
} from "./motionPromptBank";

describe("motionPromptBank", () => {
  it("files every entry under a labelled category", () => {
    expect(listMotionPromptsByCategory("logo")).toHaveLength(8);
    expect(listMotionPromptsByCategory("product_ad")).toHaveLength(7);
    expect(listMotionPromptsByCategory("data")).toHaveLength(7);
    expect(listMotionPromptsByCategory("caption")).toHaveLength(12);
    expect(listMotionPromptsByCategory("scene_steal")).toHaveLength(3);

    // 各类之和须等于总数：新增一类却忘了归档时，这里会直接报出来，
    // 而不是像原先那样只在硬编码的总数上红一行、让人以为改坏了库
    const labelled = (
      Object.keys(MOTION_PROMPT_CATEGORY_LABEL_ZH) as MotionPromptCategory[]
    ).flatMap((c) => listMotionPromptsByCategory(c));
    expect(labelled).toHaveLength(MOTION_PROMPT_BANK.length);
    expect(new Set(MOTION_PROMPT_BANK.map((e) => e.id)).size).toBe(
      MOTION_PROMPT_BANK.length,
    );
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

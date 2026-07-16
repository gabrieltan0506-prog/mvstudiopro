import { describe, expect, it } from "vitest";
import {
  MANHUA_FACTORY_STAGE_ORDER,
  applyTopicToFactoryStory,
  extractFactoryMotionHints,
  resolveManhuaFactoryOrderedIds,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";

describe("canvasDramaStudio factory", () => {
  it("spawns six linked stages with topic", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "星际车站离别",
    });
    expect(blocks).toHaveLength(6);
    expect(edges).toHaveLength(5);
    for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
      expect(blocks.some((b) => b.id.startsWith(`${stage}-`))).toBe(true);
    }
    expect(blocks[0]!.prompt).toContain("星际车站离别");
  });

  it("orders ids through reverse / keyart / clip", () => {
    const { blocks } = spawnManhuaDramaStudio();
    expect(resolveManhuaFactoryOrderedIds(blocks, "reverse")).toHaveLength(4);
    expect(resolveManhuaFactoryOrderedIds(blocks, "keyart")).toHaveLength(5);
    expect(resolveManhuaFactoryOrderedIds(blocks, "clip")).toHaveLength(6);
  });

  it("applies topic to existing story node", () => {
    const { blocks } = spawnManhuaDramaStudio();
    const next = applyTopicToFactoryStory(blocks, "雨夜天台");
    expect(next.find((b) => b.id.startsWith("story-"))!.prompt).toContain("雨夜天台");
  });

  it("extracts motion hints from reverse markdown", () => {
    const md = `## 一句话摘要
星际离别的青涩痛感

## Seedance / I2V 微动提示词（每镜一句）
1. slow push on face

## 可复制总提示（首镜）
slow dolly in, soft rain, trembling hand
`;
    const h = extractFactoryMotionHints(md);
    expect(h.keyArtHint).toContain("星际离别");
    expect(h.seedanceHint).toContain("slow dolly");
  });
});

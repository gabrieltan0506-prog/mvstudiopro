import { describe, expect, it } from "vitest";
import {
  MANHUA_FACTORY_STAGE_ORDER,
  applyTopicToFactoryStory,
  extractFactoryMotionHints,
  isTransientFactoryError,
  resolveFactoryResumeStage,
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

  it("spawns with genre+scene injects scene asset into key art", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "外门弟子闯秘境",
      genreId: "xianxia",
      sceneId: "scene_04",
    });
    const key = blocks.find((b) => b.id.startsWith("keyart-"))!;
    expect(key.prompt).toContain("秘境洞府");
    expect(key.prompt).toContain("发光晶石");
    expect(blocks[0]!.prompt).toContain("仙侠");
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

## 分镜表
| 镜号 | 景别 | 内容 |
| 1 | 近景 | 雨夜月台对视 |

## 角色与场景锁定
女主短发校服，男主黑伞

## Seedance / I2V 微动提示词（每镜一句）
1. slow push on face

## 可复制总提示（首镜）
slow dolly in, soft rain, trembling hand
`;
    const h = extractFactoryMotionHints(md);
    expect(h.keyArtHint).toContain("星际离别");
    expect(h.keyArtHint).toContain("雨夜月台");
    expect(h.keyArtHint).toContain("短发校服");
    expect(h.seedanceHint).toContain("slow dolly");
  });

  it("detects transient errors and resume stage", () => {
    expect(isTransientFactoryError("网关超时，请稍后重试")).toBe(true);
    expect(isTransientFactoryError("积分不足")).toBe(false);
    const { blocks } = spawnManhuaDramaStudio();
    const withError = blocks.map((b) =>
      b.id.startsWith("beats-")
        ? { ...b, status: "error" as const, error: "timeout" }
        : b.id.startsWith("story-") || b.id.startsWith("bible-")
          ? { ...b, status: "done" as const, outputText: "ok" }
          : b,
    );
    expect(resolveFactoryResumeStage(withError)).toBe("beats");
  });
});

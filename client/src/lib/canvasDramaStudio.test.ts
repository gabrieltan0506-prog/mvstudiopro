import { describe, expect, it } from "vitest";
import {
  MANHUA_FACTORY_STAGE_ORDER,
  applyTopicToFactoryStory,
  extractFactoryMotionHints,
  isTransientFactoryError,
  resolveFactoryResumeStage,
  resolveManhuaFactoryOrderedIds,
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import type { CanvasRunDeps } from "./canvasRunBlock";

describe("canvasDramaStudio factory", () => {
  it("spawns seven linked stages with topic (含 Omni 视频改写)", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "星际车站离别",
    });
    expect(blocks).toHaveLength(7);
    expect(edges).toHaveLength(6);
    for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
      expect(blocks.some((b) => b.id.startsWith(`${stage}-`))).toBe(true);
    }
    expect(blocks[0]!.prompt).toContain("星际车站离别");
    const omni = blocks.find((b) => b.id.startsWith("omni_edit-"))!;
    expect(omni.videoModel).toBe("gemini-omni-flash");
    expect(omni.parentId).toMatch(/^clip-/);
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

  it("injects character library anchors into bible", () => {
    const { blocks, characterIds } = spawnManhuaDramaStudio({
      topic: "都市律师对峙",
      characterIds: ["char_f_07", "char_m_02"],
    });
    expect(characterIds).toEqual(["char_f_07", "char_m_02"]);
    const bible = blocks.find((b) => b.id.startsWith("bible-"))!;
    expect(bible.prompt).toContain("唐若曦");
    expect(bible.prompt).toContain("傅临渊");
    expect(bible.prompt).toContain("【角色库锚点】");
  });

  it("infers genre from topic when genreId omitted", () => {
    const spawned = spawnManhuaDramaStudio({
      topic: "星际飞船舷窗离别",
    });
    expect(spawned.genreInferred).toBe(true);
    expect(spawned.resolvedGenreId).toBe("scifi");
    expect(spawned.blocks[0]!.prompt).toContain("科幻");
    expect(spawned.blocks.find((b) => b.id.startsWith("keyart-"))!.prompt).toContain("未来城市");
  });

  it("keeps scene asset in keyart after reverse enrich", async () => {
    const spawned = spawnManhuaDramaStudio({
      genreId: "xianxia",
      sceneId: "scene_04",
      topic: "闯秘境",
    });
    // 预置上游文本段为 done，只跑反推以触发 enrich
    const primed = spawned.blocks.map((b) => {
      if (b.id.startsWith("story-") || b.id.startsWith("bible-") || b.id.startsWith("beats-")) {
        return { ...b, status: "done" as const, outputText: "上游已完成\n角色：青衫弟子" };
      }
      return b;
    });
    const deps: CanvasRunDeps = {
      optimizeCopy: async () => "unused",
    };
    // mock runCanvasBlock via monkey: pipeline calls runCanvasBlock from module — use real reverse path by stubbing is heavy;
    // instead call enrich indirectly: mark reverse done through pipeline with a fake by patching fetch is too heavy.
    // Use extract + manual map check via pipeline with injected done reverse:
    const withReverse = primed.map((b) =>
      b.id.startsWith("reverse-")
        ? {
            ...b,
            status: "done" as const,
            outputText: `## 一句话摘要\n秘境一战\n\n## 可复制总提示（首镜）\nslow push, crystal glow`,
          }
        : b,
    );
    // force re-run reverse with mock: simplest — import and rely on runManhuaDramaFactoryPipeline calling runCanvasBlock
    // We'll stub by making reverse already done and forceFromStage keyart only — enrich only runs after reverse run.
    // So simulate one reverse run with a deps that won't be used if we unit-test strip via spawn+manual:
    const keyBefore = withReverse.find((b) => b.id.startsWith("keyart-"))!.prompt;
    expect(keyBefore).toContain("秘境洞府");

    const { runCanvasBlock } = await import("./canvasRunBlock");
    const original = runCanvasBlock;
    // dynamic mock: pipeline imports runCanvasBlock at top — can't easily replace.
    // Fall back: invoke pipeline until reverse with a custom approach — skip if not mockable.
    // Directly exercise by re-exporting enrich is private; use pipeline with forceFromStage reverse and mock global fetch.
    const reverseMd = `## 一句话摘要
秘境一战

## 分镜表
| 1 | 近景 | 石门 |

## 可复制总提示（首镜）
slow push, crystal glow
`;
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("geminiScript") || url.includes("videoReverse")) {
        return new Response(
          JSON.stringify({
            ok: true,
            text: reverseMd,
            markdown: reverseMd,
            raw: { candidates: [{ content: { parts: [{ text: reverseMd }] } }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    try {
      const result = await runManhuaDramaFactoryPipeline({
        deps,
        blocks: primed,
        edges: spawned.edges,
        untilStage: "reverse",
        forceFromStage: "reverse",
        skipDone: true,
        maxRetries: 0,
      });
      const key = result.blocks.find((b) => b.id.startsWith("keyart-"))!;
      expect(key.prompt).toContain("秘境洞府");
      expect(key.prompt).toContain("发光晶石");
      expect(key.prompt).toContain("来自编导反推");
      expect(key.prompt).toContain("角色卡锚点");
    } finally {
      globalThis.fetch = prevFetch;
      void original;
    }
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
    expect(isTransientFactoryError("算力紧张，请稍后重试（503）")).toBe(true);
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

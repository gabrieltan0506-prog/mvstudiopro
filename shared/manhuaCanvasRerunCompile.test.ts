import { describe, expect, it } from "vitest";
import {
  applyManhuaRerunCompilePatch,
  collectManhuaBlockOutputStash,
  compileManhuaAssetSheetPromptForRerun,
  isManhuaClipBlockId,
  isManhuaKeyartBlockId,
  shouldRecompileManhuaBlockOnRerun,
} from "./manhuaCanvasRerunCompile";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon";

const canon: ManhuaWriterAssetCanon = {
  characters: [
    {
      id: "wa_char_xie",
      role: "character",
      nameZh: "谢无咎",
      lookZh: "白衣古籍修复师，清瘦冷静",
      promptZh: "白衣青年，古籍修复馆侧光",
    },
  ],
  locations: [
    {
      id: "wa_loc_repair",
      role: "scene",
      nameZh: "古籍修复馆",
      lookZh: "现代修复台与暖灯",
      promptZh: "空镜：修复馆长桌与工具",
    },
  ],
  props: [],
  episodeMainSceneId: { 1: "wa_loc_repair" },
};

describe("manhuaCanvasRerunCompile", () => {
  it("设定图与成片需重编译；关键静帧不走本钩子", () => {
    expect(shouldRecompileManhuaBlockOnRerun("charsheet-wa_char_xie")).toBe(true);
    expect(shouldRecompileManhuaBlockOnRerun("clip-e01-g02")).toBe(true);
    expect(isManhuaClipBlockId("clip-e01-g02")).toBe(true);
    expect(isManhuaKeyartBlockId("keyart-e01-s03")).toBe(true);
    expect(shouldRecompileManhuaBlockOnRerun("keyart-e01-s03")).toBe(false);
    expect(shouldRecompileManhuaBlockOnRerun("block-abc")).toBe(false);
  });

  it("设定图重跑按当前编剧表重编译，且旧图进暂存", () => {
    const block = {
      id: "charsheet-wa_char_xie",
      prompt: "旧提示词·含烧字道具",
      outputUrl: "https://cdn.example/old.png",
      outputUrls: ["https://cdn.example/older.png"],
      episodeIndex: 1,
    };
    const compiled = compileManhuaAssetSheetPromptForRerun(block, {
      assetCanon: canon,
      episodeIndex: 1,
      topic: "雁门照山河",
      artStyleId: "photoreal",
      assetBlocks: [
        {
          id: block.id,
          outputUrl: block.outputUrl,
          outputUrls: block.outputUrls,
        },
      ],
    });
    expect(compiled).not.toBeNull();
    expect(compiled!.changed).toBe(true);
    expect(compiled!.afterPrompt).not.toContain("旧提示词");
    expect(compiled!.afterPrompt.length).toBeGreaterThan(20);
    expect(compiled!.stashOutputUrls[0]).toBe("https://cdn.example/old.png");

    const patch = applyManhuaRerunCompilePatch(compiled!);
    expect(patch.prompt).toBe(compiled!.afterPrompt);
    expect(patch.outputUrl).toBeUndefined();
    expect(patch.outputUrls).toEqual(compiled!.stashOutputUrls);
    expect(patch.status).toBe("idle");
  });

  it("禁止 seed 回退：大头照节点不得吃到全身稿 plan", () => {
    const faceId = "charsheet-wa_char_xie-face";
    const compiled = compileManhuaAssetSheetPromptForRerun(
      { id: faceId, prompt: "旧脸稿", episodeIndex: 1 },
      {
        assetCanon: canon,
        episodeIndex: 1,
        topic: "雁门照山河",
        artStyleId: "photoreal",
        assetBlocks: [{ id: "charsheet-wa_char_xie", outputUrl: "https://cdn.example/body.png" }],
      },
    );
    // plan.id 必须精确等于 face 节点；找不到则 null（不得用 body plan）
    expect(compiled).toBeNull();
  });

  it("暂存 URL 去重保序", () => {
    expect(
      collectManhuaBlockOutputStash({
        outputUrl: "https://a",
        outputUrls: ["https://a", "https://b"],
      }),
    ).toEqual(["https://a", "https://b"]);
  });
});

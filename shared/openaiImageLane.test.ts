import { describe, expect, it } from "vitest";
import {
  normalizeOpenAiImageLane,
  OPENAI_IMAGE_LANE_DEFAULT,
  resolveOpenAiImageLaneForBlockId,
} from "./openaiImageLane";

describe("openaiImageLane", () => {
  it("设定图（人物/场景/道具）走 asset 道", () => {
    expect(resolveOpenAiImageLaneForBlockId("charsheet-luqinghe")).toBe("asset");
    expect(resolveOpenAiImageLaneForBlockId("charsheet-face-luqinghe")).toBe("asset");
    expect(resolveOpenAiImageLaneForBlockId("sceneplate-cangyun-inn")).toBe("asset");
    expect(resolveOpenAiImageLaneForBlockId("propplate-jade")).toBe("asset");
    expect(resolveOpenAiImageLaneForBlockId("prop-jade")).toBe("asset");
  });

  it("静帧 / 成片 / 其余画布走 keyart 道", () => {
    expect(resolveOpenAiImageLaneForBlockId("keyart-ep1-s1")).toBe("keyart");
    expect(resolveOpenAiImageLaneForBlockId("clip-ep1-s1")).toBe("keyart");
    expect(resolveOpenAiImageLaneForBlockId("image-free-1")).toBe("keyart");
    expect(resolveOpenAiImageLaneForBlockId("")).toBe(OPENAI_IMAGE_LANE_DEFAULT);
  });

  it("normalize 只认两个合法值", () => {
    expect(normalizeOpenAiImageLane("asset")).toBe("asset");
    expect(normalizeOpenAiImageLane(" KEYART ")).toBe("keyart");
    expect(normalizeOpenAiImageLane("video")).toBeNull();
    expect(normalizeOpenAiImageLane(undefined)).toBeNull();
  });
});

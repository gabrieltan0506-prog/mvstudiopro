import { describe, expect, it } from "vitest";
import { isManhuaKeyartSourceCurrent } from "./manhuaKeyartLookState";

const url = "/api/canvas-media/generated/keyart-s14.png";
const shot = { index: 14, durationSec: 5, cameraZh: "巷口全景→人马近景", actionZh: "阿菁揪住墨屠耳朵" };
const block = (required: Record<string, unknown>, generatedFor: Record<string, unknown> = shot) => ({
  outputUrl: url,
  manhuaKeyartSourceState: { required: JSON.stringify(required), generatedFor: JSON.stringify(generatedFor), generatedUrl: url },
});

describe("静帧来源是否仍是当前画面", () => {
  it("只改镜头时长或制作片段切点：静帧仍是当前的，不要求重出", () => {
    expect(isManhuaKeyartSourceCurrent(block({ ...shot, durationSec: 10.032 }))).toBe(true);
    expect(isManhuaKeyartSourceCurrent(block({ ...shot, durationSec: 6.216, segmentBreakBefore: true }))).toBe(true);
  });
  it("画面内容变了照旧判为已变更；对白变化仍不影响静帧", () => {
    expect(isManhuaKeyartSourceCurrent(block({ ...shot, actionZh: "阿菁松开马耳托稳娘" }))).toBe(false);
    expect(isManhuaKeyartSourceCurrent(block({ ...shot, cameraZh: "低角仰拍" }))).toBe(false);
    expect(isManhuaKeyartSourceCurrent(block({ ...shot, dialogueZh: "喔……好痛" }))).toBe(true);
  });
  it("产物地址对不上仍不是当前", () => {
    expect(isManhuaKeyartSourceCurrent({ ...block(shot), outputUrl: "/other.png" })).toBe(false);
  });
});

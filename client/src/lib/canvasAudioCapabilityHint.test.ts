import { describe, expect, it } from "vitest";
import { canvasAudioCapabilityHint } from "./canvasAudioCapabilityHint";

describe("声音面板能力提示与出片合同", () => {
  it.each(["seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini", "wan-3.0"] as const)("%s明确要求母轨，不误报不支持声音", videoModel => {
    const hint = canvasAudioCapabilityHint({ videoModel });
    expect(hint).toContain("须先把已采用的音轨预混");
    expect(hint).toContain(videoModel === "wan-3.0" ? "15 秒" : "30 秒");
    expect(hint).not.toContain("不支持声音参考");
  });
  it.each([undefined, "reference_to_video"] as const)("加长档%s可消费已采用音轨", seedance25WorkMode => {
    expect(canvasAudioCapabilityHint({ videoModel: "seedance-2.5", seedance25WorkMode })).toContain("可使用已采用的逐段音轨或预混母轨");
  });
  it.each(["text_to_video", "image_to_video", "video_extend"] as const)("%s不能被支持引擎掩盖", seedance25WorkMode => {
    expect(canvasAudioCapabilityHint({ videoModel: "seedance-2.5", seedance25WorkMode })).toContain("当前模式不会消费");
  });
  it.each(["happyhorse-1.1", "minimax-hailuo-3"] as const)("%s仍提示不支持", videoModel => {
    expect(canvasAudioCapabilityHint({ videoModel })).toContain("不支持声音参考");
  });
});

import { expect, it } from "vitest";
import { canvasBgmVoicePrompt } from "./canvasAudioVoiceControl";

it("语音偏好只追加到真实分镜和已有配乐要求，重复准备不堆叠同一要求", () => {
  const first = canvasBgmVoicePrompt("0–5秒：救母，压低音乐", "保留古琴主题", "结尾留白");
  expect(first).toContain("0–5秒：救母，压低音乐");
  expect(first).toContain("保留古琴主题");
  expect(first).toContain("本次用户补充：\n结尾留白");
  expect(canvasBgmVoicePrompt("0–5秒：救母，压低音乐", first, "结尾留白")).toBe(first);
});

it("无分镜剧情时不能只凭语音要求制造配乐剧情", () => {
  expect(() => canvasBgmVoicePrompt("", "已有要求", "激昂")).toThrow("没有可用的分镜剧情");
});

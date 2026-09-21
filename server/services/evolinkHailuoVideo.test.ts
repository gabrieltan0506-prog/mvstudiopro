import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvolinkH3Body, submitEvolinkH3, type EvolinkH3Input } from "./evolinkHailuoVideo.js";

const input: EvolinkH3Input = {
  prompt: "@图片1 的角色按 @视频1 动作，以 @音频1 的声音说话",
  imageUrls: ["https://example.test/face.png"],
  videoUrls: ["https://example.test/move.mp4"],
  audioUrls: ["https://example.test/voice.wav"],
  duration: 5, resolution: "2K", aspectRatio: "9:16",
};
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("H3 EvoLink 参考提交合同", () => {
  it("保全三类参考及各自编号，只发官方参数", () => {
    expect(buildEvolinkH3Body(input)).toEqual({
      model: "minimax-h3-reference-to-video",
      prompt: "Image 1 的角色按 Video 1 动作，以 Audio 1 的声音说话",
      image_urls: input.imageUrls, video_urls: input.videoUrls, audio_urls: input.audioUrls,
      duration: 5, quality: "2k", aspect_ratio: "9:16",
    });
  });
  it("仅音频参考合法，不能无素材", () => {
    expect(buildEvolinkH3Body({ ...input, imageUrls: [], videoUrls: [] }).audio_urls).toEqual(input.audioUrls);
    expect(() => buildEvolinkH3Body({ ...input, imageUrls: [], videoUrls: [], audioUrls: [] })).toThrow("1–12");
  });
  it("超总量与分项量均在网络提交前拒绝，不裁剪", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); vi.stubEnv("EVOLINK_API_KEY", "test-key");
    await expect(submitEvolinkH3({ ...input, imageUrls: Array(9).fill(input.imageUrls![0]), videoUrls: Array(3).fill(input.videoUrls![0]), audioUrls: Array(1).fill(input.audioUrls![0]) })).rejects.toMatchObject({ kind: "rejected" });
    await expect(submitEvolinkH3({ ...input, audioUrls: Array(4).fill(input.audioUrls![0]) })).rejects.toMatchObject({ kind: "rejected" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([3, 16, 5.5])("不归一非法时长 %s 后按另一档扣费", duration => {
    expect(() => buildEvolinkH3Body({ ...input, duration })).toThrow("4–15");
  });
  it.each([400, 422, 500, 429])("HTTP %s 保留明确拒绝与结果未知的边界", async status => {
    vi.stubEnv("EVOLINK_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status })); vi.stubGlobal("fetch", fetch);
    await expect(submitEvolinkH3(input)).rejects.toMatchObject({ kind: [400, 422].includes(status) ? "rejected" : "unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("成功只返回原任务号，缺号或网络断不重试", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"id":"h3-one"}')).mockResolvedValueOnce(new Response("{}")).mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", fetch);
    await expect(submitEvolinkH3(input)).resolves.toEqual({ evolinkTaskId: "h3-one" });
    await expect(submitEvolinkH3(input)).rejects.toMatchObject({ kind: "unknown" });
    await expect(submitEvolinkH3(input)).rejects.toMatchObject({ kind: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

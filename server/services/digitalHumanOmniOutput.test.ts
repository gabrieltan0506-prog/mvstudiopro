import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  download: vi.fn(),
  video: vi.fn(),
  audio: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("./postProduction", () => ({
  fetchPostProdSourceToFile: f.download,
  probe: f.video,
  probeAudio: f.audio,
  uploadResult: f.upload,
}));
import {
  saveDigitalHumanOmniOutput,
  DigitalHumanOmniOutputQualityError,
} from "./digitalHumanOmniOutput";
beforeEach(() => {
  Object.values(f).forEach(mock => mock.mockReset());
  f.download.mockResolvedValue(1024);
  f.video.mockResolvedValue({
    width: 720,
    height: 1280,
    durationSec: 45,
    hasAudio: true,
  });
  f.audio.mockResolvedValue(45);
  f.upload.mockResolvedValue({
    gcsUri: "gs://test/original.mp4",
    url: "https://example.test/original.mp4",
    bytes: 1024,
  });
});
it("原片音画完整才持久保存，保留实际尺寸", async () => {
  expect(
    await saveDigitalHumanOmniOutput(7, "https://example.test/source.mp4", 45)
  ).toMatchObject({
    width: 720,
    height: 1280,
    durationSec: 45,
    gcsUri: "gs://test/original.mp4",
  });
  expect(f.upload).toHaveBeenCalledTimes(1);
});
it("缺音轨及短片明确拒收，不因供应商completed冒充可用", async () => {
  f.video.mockResolvedValueOnce({
    width: 720,
    height: 1280,
    durationSec: 45,
    hasAudio: false,
  });
  await expect(
    saveDigitalHumanOmniOutput(7, "https://example.test/source.mp4", 45)
  ).rejects.toBeInstanceOf(DigitalHumanOmniOutputQualityError);
  f.audio.mockResolvedValue(20);
  await expect(
    saveDigitalHumanOmniOutput(7, "https://example.test/source.mp4", 45)
  ).rejects.toBeInstanceOf(DigitalHumanOmniOutputQualityError);
  expect(f.upload).not.toHaveBeenCalled();
});
it("下载网络故障保持可恢复，不误判原片质量失败", async () => {
  const error = new Error("network interrupted");
  f.download.mockRejectedValue(error);
  await expect(
    saveDigitalHumanOmniOutput(7, "https://example.test/source.mp4", 45)
  ).rejects.toBe(error);
  expect(f.upload).not.toHaveBeenCalled();
});

import { describe, expect, it } from "vitest";
import { validateH3MediaProbe } from "./hailuoReferencePreflight.js";

describe("H3真实媒体元数据边界", () => {
  const video = { streams: [{ codec_type: "video", codec_name: "h264", width: 720, height: 1280, avg_frame_rate: "30000/1001" }], format: { duration: "5.04", format_name: "mov,mp4,m4a,3gp,3g2,mj2" } };
  it("保留原秒数，不能向下取整绕过容量", () => {
    expect(validateH3MediaProbe(video, "video")).toBe(5.04);
    expect(() => validateH3MediaProbe({ ...video, format: { ...video.format, duration: "15.01" } }, "video")).toThrow("2–15");
  });
  it("没有对应媒体流不能把format时长当合格参考", () => {
    expect(() => validateH3MediaProbe(video, "audio")).toThrow("2–15");
  });
  it("低帧率白模与错误编码要修输入，不能直接交给供应商", () => {
    expect(() => validateH3MediaProbe({ ...video, streams: [{ ...video.streams[0], avg_frame_rate: "12/1" }] }, "video")).toThrow("帧率");
    expect(() => validateH3MediaProbe({ ...video, streams: [{ ...video.streams[0], codec_name: "vp9" }] }, "video")).toThrow("编码");
  });
  it("WAV原声可用，M4A不能冒充WAV", () => {
    const audio = { streams: [{ codec_type: "audio", codec_name: "pcm_s16le" }], format: { duration: "4.944", format_name: "wav" } };
    expect(validateH3MediaProbe(audio, "audio")).toBe(4.944);
    expect(() => validateH3MediaProbe({ ...audio, format: { ...audio.format, format_name: "mov,mp4,m4a" } }, "audio")).toThrow("WAV");
  });
});

import { describe, expect, it } from "vitest";
import { assertOwnedReference, resolveReferenceVoiceWorkspace } from "./canvasVoiceReference";

describe("参考音色服务端边界", () => {
  it("只接受本人上传的音档，不能借用他人对象", () => {
    expect(() => assertOwnedReference(7, "gs://mv-studio-pro-vertex-video-temp/uploads/u7/a.wav")).not.toThrow();
    expect(() => assertOwnedReference(7, "gs://mv-studio-pro-vertex-video-temp/uploads/u8/a.wav")).toThrow();
    expect(() => assertOwnedReference(7, "gs://mv-studio-pro-vertex-video-temp/uploads/u7/a.mp4")).toThrow();
  });
  it("只从官方业务空间组成建声与同源TTS地址", () => {
    const config = resolveReferenceVoiceWorkspace({ DASHSCOPE_SG_BASE: "https://workspace123.ap-southeast-1.maas.aliyuncs.com/api/v1", DASHSCOPE_SG_API_KEY: "test-key" });
    expect(config.customizationUrl).toBe("https://workspace123.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/customization");
    expect(config.websocketUrl).toBe("wss://workspace123.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference");
    expect(() => resolveReferenceVoiceWorkspace({ DASHSCOPE_SG_BASE: "https://evil.invalid", DASHSCOPE_SG_API_KEY: "test-key" })).toThrow();
  });
});

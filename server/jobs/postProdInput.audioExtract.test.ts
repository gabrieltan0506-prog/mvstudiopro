import { describe, expect, it } from "vitest";
import { postProdJobInputSchema } from "./postProdInput";

describe("audio_extract 后期任务入参", () => {
  it("默认 m4a；wav 可选；多余字段与坏格式拒绝", () => {
    const parsed = postProdJobInputSchema.parse({ action: "audio_extract", params: { videoUri: "gs://b/post-prod/1/final.mp4" } });
    expect(parsed).toEqual({ action: "audio_extract", params: { videoUri: "gs://b/post-prod/1/final.mp4", format: "m4a" } });
    expect(postProdJobInputSchema.parse({ action: "audio_extract", params: { videoUri: "https://x/final.mp4", format: "wav" } }).params).toMatchObject({ format: "wav" });
    expect(() => postProdJobInputSchema.parse({ action: "audio_extract", params: { videoUri: "gs://b/x.mp4", format: "mp3" } })).toThrow();
    expect(() => postProdJobInputSchema.parse({ action: "audio_extract", params: { videoUri: "gs://b/x.mp4", extra: 1 } })).toThrow();
  });
});

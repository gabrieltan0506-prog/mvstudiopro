import { describe, expect, it } from "vitest";
import {
  classifyRemoteFfmpegFailure,
  isManhuaDenseFrameSampleSuccessful,
} from "./manhuaRemoteMediaSampler";

describe("manhua remote dense frame sample", () => {
  it("requires at least 65 percent of the planned dense frames", () => {
    expect(isManhuaDenseFrameSampleSuccessful(200, 130)).toBe(true);
    expect(isManhuaDenseFrameSampleSuccessful(200, 129)).toBe(false);
    expect(isManhuaDenseFrameSampleSuccessful(1, 1)).toBe(false);
    expect(isManhuaDenseFrameSampleSuccessful(1, 2)).toBe(true);
  });
});

describe("manhua remote media failure classification", () => {
  it("将可读容器头后的 AAC/H264 解码损坏归类为数据体损坏", () => {
    expect(classifyRemoteFfmpegFailure(
      "channel element 2.7 is not allocated; non-existing PPS 0 referenced",
      "语音流提取失败",
    )).toBe("媒体数据体损坏或不可解码");
  });

  it("只返回脱敏错误分类，不透传媒体地址", () => {
    expect(classifyRemoteFfmpegFailure(
      "https://signed.example/video.mp4: Server returned 404 Not Found",
      "语音流提取失败",
    )).toBe("媒体地址已失效");
  });
});

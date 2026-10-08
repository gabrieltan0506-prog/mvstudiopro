import { describe, expect, it } from "vitest";
import {
  classifyRemoteFfmpegFailure,
} from "./manhuaRemoteMediaSampler";

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

// The incident returned valid header metadata before a DNS failure in decoding.
describe("media DNS regression", () => {
  it.each([
    "[tcp] Failed to resolve hostname cdn.example: Name or service not known",
    "Temporary failure in name resolution",
    "getaddrinfo ENOTFOUND cdn.example",
    "getaddrinfo EAI_AGAIN cdn.example",
  ])("preserves DNS classification without exposing signed input: %s", detail => {
    expect(classifyRemoteFfmpegFailure(detail + " https://cdn.example/a?token=TEST_ONLY", "媒体数据体损坏或不可解码"))
      .toBe("媒体域名暂时无法解析");
  });
});

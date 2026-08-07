import { describe, expect, it } from "vitest";
import { buildOpenRouterVideoDownloadHeaders } from "./openrouterVideoCore";

describe("openrouterVideoCore", () => {
  it("OpenRouter 自有成片地址携带下载授权", () => {
    expect(
      buildOpenRouterVideoDownloadHeaders(
        "https://openrouter.ai/api/v1/videos/job/content?index=0",
        "test-key"
      )
    ).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("第三方 CDN 地址绝不携带 OpenRouter 授权", () => {
    expect(
      buildOpenRouterVideoDownloadHeaders(
        "https://cdn.example.com/video.mp4",
        "test-key"
      )
    ).toEqual({});
  });
});

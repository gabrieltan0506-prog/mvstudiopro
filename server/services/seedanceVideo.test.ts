import { describe, expect, it } from "vitest";
import { isBrowserReadableVideoUrl } from "./seedanceVideo";

describe("isBrowserReadableVideoUrl", () => {
  it("拒绝私有桶未签名 home-photo 直链", () => {
    expect(
      isBrowserReadableVideoUrl(
        "https://storage.googleapis.com/polished-pond-5133/home-photo/animation-1.mp4",
      ),
    ).toBe(false);
  });

  it("接受 GCS V4 签名与 Blob 公链", () => {
    expect(
      isBrowserReadableVideoUrl(
        "https://storage.googleapis.com/bucket/v.mp4?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc",
      ),
    ).toBe(true);
    expect(
      isBrowserReadableVideoUrl(
        "https://abc.public.blob.vercel-storage.com/home-photo/animation-1.mp4",
      ),
    ).toBe(true);
  });
});

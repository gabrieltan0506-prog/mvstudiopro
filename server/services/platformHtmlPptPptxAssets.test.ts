import { describe, expect, it } from "vitest";
import { isAllowedHtmlPptPptxImageUrl } from "./platformHtmlPptPptxAssets";

describe("isAllowedHtmlPptPptxImageUrl", () => {
  it("allows GCS and blob hosts", () => {
    expect(
      isAllowedHtmlPptPptxImageUrl(
        "https://storage.googleapis.com/mv-studio-pro-vertex-video-temp/generated/html-ppt-slides/a.png",
      ),
    ).toBe(true);
    expect(
      isAllowedHtmlPptPptxImageUrl("https://xyz.public.blob.vercel-storage.com/file.png"),
    ).toBe(true);
  });

  it("rejects arbitrary hosts", () => {
    expect(isAllowedHtmlPptPptxImageUrl("https://evil.example/x.png")).toBe(false);
    expect(isAllowedHtmlPptPptxImageUrl("ftp://storage.googleapis.com/a.png")).toBe(false);
  });
});

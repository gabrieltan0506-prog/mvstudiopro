import { describe, expect, it, vi } from "vitest";
import { refreshManhuaDraftSignedUrls } from "./manhuaDraftUrlRefresh.js";

const BUCKET = "test-bucket";
const signedUrl = (object: string) =>
  `https://storage.googleapis.com/${BUCKET}/${object}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=deadbeef`;

describe("refreshManhuaDraftSignedUrls", () => {
  it("re-signs expired bucket urls anywhere in the payload", () => {
    const sign = vi.fn((gcsUri: string) => `https://fresh.example/${gcsUri}`);
    const payload = {
      canvas: {
        blocks: [
          {
            outputUrl: signedUrl("canvas/image/a.png"),
            uploadedAssets: [{ url: signedUrl("uploads/u1/b%20c.mp3") }],
            note: "普通文字不动",
          },
        ],
      },
    };
    const { payload: out, stats } = refreshManhuaDraftSignedUrls(payload, {
      bucketName: BUCKET,
      sign,
    });
    expect(out.canvas.blocks[0]!.outputUrl).toBe(
      `https://fresh.example/gs://${BUCKET}/canvas/image/a.png`
    );
    // 百分号编码的对象名要解码后再签
    expect(sign).toHaveBeenCalledWith(`gs://${BUCKET}/uploads/u1/b c.mp3`, 7 * 24 * 3600);
    expect(out.canvas.blocks[0]!.note).toBe("普通文字不动");
    expect(stats.refreshed).toBe(2);
  });

  it("leaves foreign buckets, unsigned urls and non-gcs strings untouched", () => {
    const sign = vi.fn(() => "https://fresh.example/x");
    const payload = {
      a: `https://storage.googleapis.com/other-bucket/x.png?X-Goog-Signature=1`,
      b: `https://storage.googleapis.com/${BUCKET}/public.png`,
      c: "https://example.com/x.png",
      d: 42,
      e: null,
    };
    const { payload: out, stats } = refreshManhuaDraftSignedUrls(payload, {
      bucketName: BUCKET,
      sign,
    });
    expect(out).toEqual(payload);
    expect(stats.refreshed).toBe(0);
    expect(sign).not.toHaveBeenCalled();
  });

  it("keeps the original url when signing throws", () => {
    const bad = signedUrl("canvas/image/a.png");
    const { payload: out } = refreshManhuaDraftSignedUrls(
      { url: bad },
      {
        bucketName: BUCKET,
        sign: () => {
          throw new Error("boom");
        },
      }
    );
    expect(out.url).toBe(bad);
  });
});

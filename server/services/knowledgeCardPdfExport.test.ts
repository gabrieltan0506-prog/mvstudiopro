import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildKnowledgeCardPdf, normalizeKnowledgeCardPage, resolveKnowledgeCardImageObjectName } from "./knowledgeCardPdfExport";

describe("knowledgeCardPdfExport", () => {
  it("only accepts this bucket's knowledge card outputs", () => {
    const b = "my-bucket";
    expect(resolveKnowledgeCardImageObjectName("gs://my-bucket/generated/platform_knowledge_card/a.png", b)).toBe("generated/platform_knowledge_card/a.png");
    expect(resolveKnowledgeCardImageObjectName("https://storage.googleapis.com/my-bucket/generated/platform_knowledge_card/a.png?X-Goog-Signature=x", b)).toBe("generated/platform_knowledge_card/a.png");
    expect(resolveKnowledgeCardImageObjectName("https://storage.googleapis.com/other/generated/platform_knowledge_card/a.png", b)).toBeNull();
    expect(resolveKnowledgeCardImageObjectName("https://storage.googleapis.com/my-bucket/uploads/u1/x.png", b)).toBeNull();
    expect(resolveKnowledgeCardImageObjectName("https://evil.example/generated/platform_knowledge_card/a.png", b)).toBeNull();
    expect(resolveKnowledgeCardImageObjectName("gs://my-bucket/generated/platform_knowledge_card/../secret.png", b)).toBeNull();
  });

  it("normalizes 3:2 pages to 3840×2160 with edge-colored padding and keeps 16:9 as is", async () => {
    const wide = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: "#123456" } }).png().toBuffer();
    const narrow = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#f0e6d2" } }).png().toBuffer();
    for (const buf of [wide, narrow]) {
      const out = await normalizeKnowledgeCardPage(buf);
      const meta = await sharp(out).metadata();
      expect([meta.width, meta.height]).toEqual([3840, 2160]);
    }
    const padded = await normalizeKnowledgeCardPage(narrow);
    const corner = await sharp(padded).extract({ left: 0, top: 0, width: 4, height: 4 }).stats();
    // 补边色 ≈ 图边缘色（#f0e6d2）
    expect(Math.abs(corner.channels[0]!.mean - 0xf0)).toBeLessThan(6);
  });

  it("builds a multi-page PDF", async () => {
    const a = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const b = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#cccccc" } }).png().toBuffer();
    const pdf = await buildKnowledgeCardPdf([a, b]);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(2);
  }, 60_000);
});

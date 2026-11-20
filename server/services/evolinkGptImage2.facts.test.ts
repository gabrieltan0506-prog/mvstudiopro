/** D4：上传时一次性算 SHA-256 与宽高并登记；旧输出无该字段时读者回退。不发真实上传。 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const gcs = vi.hoisted(() => ({ upload: vi.fn(), sign: vi.fn() }));
vi.mock("./gcs.js", () => ({ uploadBufferToGcs: gcs.upload, signGsUriV4ReadUrl: gcs.sign }));
vi.mock("../config/platformSwitches.js", () => ({ resolvePlatformImageStorageDriver: () => "gcs" }));

import { uploadBufferToPlatformStorage, takePlatformStoredImageFacts, readPlatformStoredImageFacts, platformImageDimensions, computePlatformStoredImageFacts } from "./evolinkGptImage2";

let n = 0;
beforeEach(() => {
  gcs.upload.mockReset().mockImplementation(async ({ objectName }: { objectName: string }) => ({ gcsUri: `gs://bucket/${objectName}` }));
  gcs.sign.mockReset().mockImplementation(async (uri: string) => `https://signed.invalid/${uri.slice(5)}?n=${++n}`);
});

describe("D4 落盘图片指纹", () => {
  it("PNG/JPEG 上传后登记 SHA-256、字节数与宽高，一次性取走", async () => {
    for (const format of ["png", "jpeg"] as const) {
      const buffer = await sharp({ create: { width: 37, height: 21, channels: 3, background: "#336699" } })[format]().toBuffer();
      const url = await uploadBufferToPlatformStorage(buffer, "knowledge_card");
      const facts = takePlatformStoredImageFacts(url);
      expect(facts).toEqual({ version: 1, sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length,
        mimeType: format === "png" ? "image/png" : "image/jpeg", width: 37, height: 21 });
      expect(takePlatformStoredImageFacts(url)).toBeUndefined();
      // 写进 job 输出后，读者按同一形状取回。
      expect(readPlatformStoredImageFacts({ compositeImageUrl: url, compositeImageFacts: facts })).toEqual(facts);
    }
  });

  it("上传失败不留登记；无法识别尺寸时只记哈希不猜宽高", async () => {
    gcs.upload.mockRejectedValueOnce(new Error("ENOSPC"));
    const png = await sharp({ create: { width: 5, height: 6, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(uploadBufferToPlatformStorage(png, "x")).rejects.toThrow("ENOSPC");
    expect(gcs.sign).not.toHaveBeenCalled();
    const junk = Buffer.from("not an image at all, 32 bytes...");
    expect(platformImageDimensions(junk)).toBeUndefined();
    const facts = computePlatformStoredImageFacts(junk);
    expect(facts.width).toBeUndefined(); expect(facts.height).toBeUndefined(); expect(facts.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("旧输出（无字段）与形状不合格的字段都返回 undefined，读者回退原逻辑", () => {
    expect(readPlatformStoredImageFacts(null)).toBeUndefined();
    expect(readPlatformStoredImageFacts({ compositeImageUrl: "https://x.invalid/a.png" })).toBeUndefined();
    expect(readPlatformStoredImageFacts({ compositeImageFacts: { version: 1, sha256: "zz", bytes: 1, mimeType: "image/png" } })).toBeUndefined();
    expect(readPlatformStoredImageFacts({ compositeImageFacts: { version: 2, sha256: "a".repeat(64), bytes: 1, mimeType: "image/png" } })).toBeUndefined();
    expect(readPlatformStoredImageFacts({ compositeImageFacts: { version: 1, sha256: "a".repeat(64), bytes: 9, mimeType: "image/png", width: 0, height: 4 } }))
      .toEqual({ version: 1, sha256: "a".repeat(64), bytes: 9, mimeType: "image/png" });
  });
});

describe("D4 现有读者对新旧输出都照常工作", () => {
  it("resolveKnowledgePublicationImages 读 compositeImageUrl，不受新字段影响", async () => {
    const { resolveKnowledgePublicationImages } = await import("./knowledgePublicationImages");
    const facts = { version: 1, sha256: "b".repeat(64), bytes: 10, mimeType: "image/png", width: 3, height: 4 };
    for (const output of [{ compositeImageUrl: "https://x.invalid/a.png" }, { compositeImageUrl: "https://x.invalid/a.png", compositeImageFacts: facts }]) {
      const deps = { job: async () => ({ userId: 7, status: "succeeded", input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card" } }, output }),
        canonical: async (_o: number, url: string) => `canon:${url}` } as any;
      const out = await resolveKnowledgePublicationImages(7, { title: "t", pages: [{ id: "p", headline: "h", body: "b", imageUrl: "", imageJobId: "kc_x" }] } as any, undefined, deps);
      expect(out.pages[0]!.imageUrl).toBe("canon:https://x.invalid/a.png");
    }
  });
});

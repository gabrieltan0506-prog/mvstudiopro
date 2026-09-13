import express from "express";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, it, expect, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn(async () => ({ id: 7 })));
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: auth } }));
vi.mock("../services/gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  signGsUriV4ReadUrl: (url: string) => `https://signed.test/${url.slice(5)}`,
}));
import * as mediaInput from "../services/photoMediaInput";
import { registerPhotoTemporaryMedia } from "./photoTemporaryMedia";
import { PHOTO_TEMP_TTL_MS } from "../services/photoTemporaryMedia";

describe("Fly临时空间真实HTTP链", () => {
  it("登录上传原图→直读相同字节/Range→下载附件→12h过期，未登录不得上传", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-temp-http-"));
    vi.stubEnv("PHOTO_TEMP_MEDIA_DIR", dir);
    const app = express();
    app.use(express.json());
    const dispose = registerPhotoTemporaryMedia(app);
    const server = await new Promise<Server>(resolve => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    vi.stubEnv("PHOTO_TEMP_PUBLIC_ORIGIN", origin);
    try {
      const image = await sharp({
        create: { width: 300, height: 300, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer();
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(image)], { type: "image/png" }),
        "原图.png"
      );
      const uploaded = await fetch(`${origin}/api/photo-media/upload`, {
        method: "POST",
        body: form,
      });
      expect(uploaded.status).toBe(200);
      const data = await uploaded.json();
      expect(new URL(data.url).origin).toBe(origin);
      const read = await fetch(data.url);
      expect(read.status).toBe(200);
      expect(Buffer.from(await read.arrayBuffer()).equals(image)).toBe(true);
      const range = await fetch(data.url, { headers: { Range: "bytes=0-31" } });
      expect(range.status).toBe(206);
      expect((await range.arrayBuffer()).byteLength).toBe(32);
      const download = await fetch(data.url + "?download=photo.png");
      expect(download.headers.get("content-disposition")).toContain(
        "attachment"
      );
      await download.arrayBuffer();
      const sourceDownload = vi
        .spyOn(mediaInput, "downloadPhotoMedia")
        .mockImplementation(async (_url, _limit, destination) => {
          if (destination) await fs.writeFile(destination, image);
          return destination ? Buffer.alloc(0) : image;
        });
      const card = await fetch(`${origin}/api/photo-media/cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          url: "https://storage.googleapis.com/test-bucket/generated/platform_knowledge_card/u7/card.png?expired=true",
        }),
      });
      expect(card.status).toBe(200);
      const cached = await card.json();
      expect(new URL(cached.url).origin).toBe(origin);
      expect(sourceDownload.mock.calls[0][0]).toBe(
        "https://signed.test/test-bucket/generated/platform_knowledge_card/u7/card.png"
      );
      expect(
        Buffer.from(await (await fetch(cached.url)).arrayBuffer()).equals(image)
      ).toBe(true);
      const other = await fetch(`${origin}/api/photo-media/cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          url: "https://storage.googleapis.com/test-bucket/generated/platform_knowledge_card/u8/card.png",
        }),
      });
      expect(other.status).toBe(403);
      sourceDownload.mockRestore();
      const old = `${Date.now() - PHOTO_TEMP_TTL_MS - 1000}_12345678-1234-1234-1234-123456789012.png`;
      await fs.writeFile(path.join(dir, old), image);
      expect((await fetch(`${origin}/api/photo-media/${old}`)).status).toBe(
        410
      );
      auth.mockRejectedValueOnce(new Error("Unauthorized"));
      const denied = await fetch(`${origin}/api/photo-media/upload`, {
        method: "POST",
        body: form,
      });
      expect(denied.status).toBe(401);
    } finally {
      dispose();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.unstubAllEnvs();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

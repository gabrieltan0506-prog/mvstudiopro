import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const source = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./photoMediaInput.js", () => ({
  downloadPhotoMedia: async (...args: unknown[]) =>
    (await source.fetch(...args)).buffer,
}));
import {
  buildHomePhotoVideoRequest,
  validateHomePhotoVideoImage,
  submitHomePhotoVideo,
  pollHomePhotoVideo,
} from "./homePhotoVideo.js";
let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-video-"));
  vi.stubEnv("HOME_PHOTO_VIDEO_EVIDENCE_DIR", dir);
  vi.stubEnv("EVOLINK_API_KEY", "test-key");
  source.fetch.mockReset();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(dir, { recursive: true, force: true });
});
describe("照片独立双模型真实请求", () => {
  it.each(["seedance-2.0", "wan-3.0"] as const)(
    "%s 单图进入正确ITV字段，原文和720p不变",
    async modelChoice => {
      const f = vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "task-real-shape" }), {
            status: 200,
          })
      );
      vi.stubGlobal("fetch", f);
      const prompt = "左侧男子说{生日快乐}，其余人闭嘴";
      const r = await submitHomePhotoVideo({
        taskId: "hpa_test",
        modelChoice,
        imageUrl: "https://example.com/photo.png",
        prompt,
        duration: 10,
      });
      expect(r.evolinkTaskId).toBe("task-real-shape");
      const body = JSON.parse(
        (f.mock.calls[0] as unknown as [unknown, RequestInit])[1].body as string
      );
      expect(body).toMatchObject({
        prompt,
        duration: 10,
        quality: "720p",
        generate_audio: true,
      });
      expect(body.model).toBe(
        modelChoice === "wan-3.0"
          ? "wan3.0-image-to-video"
          : "seedance-2.0-image-to-video"
      );
      expect(
        modelChoice === "wan-3.0" ? body.image_start : body.image_urls[0]
      ).toBe("https://example.com/photo.png");
      expect(
        await fs.readFile(path.join(dir, "hpa_test", "submit-raw.json"), "utf8")
      ).toContain("task-real-shape");
    }
  );
  it.each([500, 429, 200])("HTTP%s不明返回不允许重新购买", async status => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status }))
    );
    await expect(
      submitHomePhotoVideo({
        taskId: "hpa_test",
        modelChoice: "seedance-2.0",
        imageUrl: "https://example.com/a",
        prompt: "测试",
        duration: 10,
      })
    ).rejects.toMatchObject({ kind: "unknown" });
  });
  it("明确拒绝与unknown区分", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":{"message":"bad image"}}', { status: 413 })
      )
    );
    await expect(
      submitHomePhotoVideo({
        taskId: "hpa_test",
        modelChoice: "wan-3.0",
        imageUrl: "https://example.com/a",
        prompt: "测试",
        duration: 10,
      })
    ).rejects.toMatchObject({ kind: "rejected" });
  });
  it("HTML 413仍是明确拒绝，不能误入扣款对账", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>too large</html>", { status: 413 }))
    );
    await expect(
      submitHomePhotoVideo({
        taskId: "html",
        modelChoice: "wan-3.0",
        imageUrl: "https://example.com/a",
        prompt: "测试",
        duration: 10,
      })
    ).rejects.toMatchObject({ kind: "rejected" });
  });
  it("证据盘不可写时未发送任何付费请求", async () => {
    vi.stubEnv("HOME_PHOTO_VIDEO_EVIDENCE_DIR", "/dev/null");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      submitHomePhotoVideo({
        taskId: "disk",
        modelChoice: "wan-3.0",
        imageUrl: "https://example.com/a",
        prompt: "测试",
        duration: 10,
      })
    ).rejects.toMatchObject({ kind: "rejected" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("公开原图实际解码校验，不上传或改写", async () => {
    const buffer = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    source.fetch.mockResolvedValue({ buffer, contentType: "image/png" });
    expect(
      await validateHomePhotoVideoImage("https://example.com/a", "wan-3.0")
    ).toMatchObject({ bytes: buffer.length, width: 800, height: 600 });
    expect(source.fetch).toHaveBeenCalledWith(
      "https://example.com/a",
      20_000_000
    );
  });
  it("超限在上游提交之前反馈，不压缩", async () => {
    source.fetch.mockRejectedValue(new Error("image_too_large"));
    await expect(
      validateHomePhotoVideoImage("https://example.com/a", "wan-3.0")
    ).rejects.toThrow("20MB");
  });
  it("成片轮询保留原始和解析回执，成功URL非空", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"status":"completed","results":["https://example.com/out.mp4"]}'
          )
      )
    );
    expect(await pollHomePhotoVideo("hpa_test", "upstream_id")).toEqual({
      state: "completed",
      sourceUrl: "https://example.com/out.mp4",
    });
    expect(
      (await fs.readdir(path.join(dir, "hpa_test"))).filter(n =>
        n.endsWith("-raw.json")
      )
    ).toHaveLength(1);
  });
});

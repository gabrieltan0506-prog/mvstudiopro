import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cleanupPhotoTemp,
  photoTempExpires,
  photoTempName,
  PHOTO_TEMP_TTL_MS,
} from "./photoTemporaryMedia";
import {
  isUnsafePhotoAddress,
  parsePhotoVideoMetadata,
} from "./photoMediaInput";
describe("照片临时空间与真实计费边界", () => {
  it.each([
    "127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::1",
    "10.1.2.3",
    "fd00::1",
  ])("阻止内部地址%s", value => expect(isUnsafePhotoAddress(value)).toBe(true));
  it("允许公网上传素材地址", () =>
    expect(isUnsafePhotoAddress("8.8.8.8")).toBe(false));
  it("实际宽高与时长决定超分档和计费秒数", () => {
    expect(
      parsePhotoVideoMetadata(
        JSON.stringify({
          format: { duration: "15.072" },
          streams: [{ codec_type: "video", width: 1176, height: 788 }],
        })
      )
    ).toEqual({
      width: 1176,
      height: 788,
      durationSec: 15,
      sourceResolution: "1080p",
    });
    expect(() =>
      parsePhotoVideoMetadata('{"format":{"duration":601},"streams":[]}')
    ).toThrow();
  });
  it("12小时只清除专用目录到期媒体，保留JSON回执和未过期原片", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-ttl-test-"));
    vi.stubEnv("PHOTO_TEMP_MEDIA_DIR", dir);
    try {
      const name = photoTempName("mp4");
      const expires = photoTempExpires(name);
      await fs.writeFile(path.join(dir, name), "video");
      await fs.writeFile(path.join(dir, "receipt.json"), "{}");
      await cleanupPhotoTemp(expires - 1);
      expect(await fs.readdir(dir)).toContain(name);
      await cleanupPhotoTemp(expires);
      expect(await fs.readdir(dir)).toEqual(["receipt.json"]);
      expect(expires - Number(name.split("_")[0])).toBe(PHOTO_TEMP_TTL_MS);
      expect(photoTempExpires("../outside.mp4")).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

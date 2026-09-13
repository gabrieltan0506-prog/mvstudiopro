import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { parsePhotoVideoMetadata } from "./photoMediaInput";
it("真实ffprobe读取24fps文件，费用用真实秒数且不是客户端填写值", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-metadata-real-"));
  try {
    const file = path.join(dir, "source.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=1280x720:r=24", "-t", "1.08", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", file]);
    const raw = execFileSync("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" });
    expect(parsePhotoVideoMetadata(raw)).toMatchObject({ width: 1280, height: 720, durationSec: 1, sourceResolution: "720p" });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

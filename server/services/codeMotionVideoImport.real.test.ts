import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { videoImportDeps } from "./codeMotionVideoImport";
import { runMediaTool } from "./postProduction";
it("已有MP4完整解码并提取真实单音轨，静音片没有虚构音源", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ink-import-proof-"));
  try {
    const file = path.join(root, "source.mp4");
    await runMediaTool(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x90:r=30:d=4",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-shortest",
        file,
      ],
      AbortSignal.timeout(30000)
    );
    const result = await videoImportDeps.inspect(await readFile(file));
    expect(result.duration).toBeCloseTo(4, 2);
    expect(result.audio!.toString("ascii", 0, 4)).toBe("RIFF");
    expect(result.audio!.length).toBeGreaterThan(700000);
    const silent = path.join(root, "silent.mp4");
    await runMediaTool(
      "ffmpeg",
      ["-v", "error", "-i", file, "-an", "-c:v", "copy", silent],
      AbortSignal.timeout(30000)
    );
    expect(
      (await videoImportDeps.inspect(await readFile(silent))).audio
    ).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

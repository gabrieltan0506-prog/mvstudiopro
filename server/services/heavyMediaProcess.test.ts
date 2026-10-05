import { describe, expect, it } from "vitest";
import { execHeavyMedia, heavyMediaChildrenBusy } from "./heavyMediaProcess";
import { assertHeavyLearnCommand } from "./heavyLearnMedia";
describe("heavy media process safety", () => {
  it("records child completion and drains an explicitly cancelled subprocess", async () => {
    const controller = new AbortController();
    const running = execHeavyMedia(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal }
    );
    const rejected = expect(running).rejects.toThrow();
    expect(heavyMediaChildrenBusy()).toBe(true);
    controller.abort(new Error("cancel test fixture"));
    await rejected;
    expect(heavyMediaChildrenBusy()).toBe(false);
  });
  it("preserves full stdout instead of fixed-count truncation", async () => {
    const output = await execHeavyMedia(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify(Array.from({length: 140}, (_, i) => i)))",
      ],
      { maxBuffer: 65536 }
    );
    expect(JSON.parse(output.stdout)).toHaveLength(140);
    expect(heavyMediaChildrenBusy()).toBe(false);
  });
  it("denies credentials, arbitrary binaries, file paths and non-null decoder output", () => {
    expect(() =>
      assertHeavyLearnCommand("sh", ["-c", "echo unsafe"])
    ).toThrow();
    expect(() =>
      assertHeavyLearnCommand("yt-dlp", ["-J", "--cookies", "/tmp/cookie"])
    ).toThrow();
    expect(() =>
      assertHeavyLearnCommand("ffprobe", ["file:/data/secret"])
    ).toThrow();
    expect(() =>
      assertHeavyLearnCommand("ffmpeg", [
        "-i",
        "https://fixture.invalid/video.mp4",
        "/tmp/output.mp4",
      ])
    ).toThrow();
    expect(() =>
      assertHeavyLearnCommand("ffmpeg", [
        "-i",
        "https://fixture.invalid/video.mp4",
        "-t",
        "2",
        "-f",
        "null",
        "-",
      ])
    ).not.toThrow();
  });
});

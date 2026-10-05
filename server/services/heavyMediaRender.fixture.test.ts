import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execHeavyMedia } from "./heavyMediaProcess";
import {
  heavyMediaSignal,
  withHeavyMediaContext,
} from "../jobs/heavyMediaContext";
import { executeHeavyMedia } from "../jobs/heavyMediaWorker";
const saved = vi.hoisted(() => ({ file: "" }));
vi.mock("./publicRenderMedia", () => ({
  uploadFileToPublicRenderMedia: async (file: string) => {
    const fs = await import("node:fs/promises");
    await fs.copyFile(file, saved.file);
    return "https://fixture.invalid/rendered.mp4";
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("real FFmpeg fixture goes through the existing final renderer and returns audio, video and actual subtitle timeline", async () => {
  vi.stubEnv("JOB_WORKER_ROLE", "rig");
  vi.stubEnv("MANHUA_HEAVY_WORKER_SPLIT", "1");
  const dir = await mkdtemp(join(tmpdir(), "heavy-media-fixture-"));
  const source = join(dir, "source.mp4");
  saved.file = join(dir, "final.mp4");
  try {
    await execHeavyMedia("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=30:d=1.2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1.2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ]);
    const bytes = await readFile(source);
    const fetch = vi.fn(async (url: unknown) => {
      if (url !== "https://fixture.invalid/source.mp4")
        throw new Error("Network prohibited in offline fixture");
      return new Response(bytes);
    });
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const result = (await withHeavyMediaContext(
      { userId: "7", executionId: "fixture" },
      () =>
        heavyMediaSignal.run(signal, () =>
          executeHeavyMedia(
            {
              kind: "final_render",
              input: {
                preserveSourceAudio: true,
                resolution: "720p",
                transition: "cut",
                sceneVideos: [
                  {
                    url: "https://fixture.invalid/source.mp4",
                    subtitleSource: {
                      shots: [
                        { shotIndex: 1, durationSec: 1.2, textZh: "測試原聲" },
                      ],
                    },
                  },
                ],
              },
            },
            signal,
            async () => {}
          )
        )
    )) as any;
    const probe = JSON.parse(
      (
        await execHeavyMedia("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          saved.file,
        ])
      ).stdout
    );
    expect(probe.streams.map((s: any) => s.codec_type)).toEqual(
      expect.arrayContaining(["video", "audio"])
    );
    expect(Number(probe.format.duration)).toBeCloseTo(1.2, 1);
    expect(result).toMatchObject({
      url: "https://fixture.invalid/rendered.mp4",
      subtitleTimeline: { durationSec: 1.2, cues: [{ textZh: "測試原聲" }] },
    });
    expect(fetch).toHaveBeenCalledOnce();
    if (process.env.HEAVY_FIXTURE_EVIDENCE_DIR) {
      await writeFile(
        join(process.env.HEAVY_FIXTURE_EVIDENCE_DIR, "fixture-result.json"),
        JSON.stringify({ result, probe }, null, 2)
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

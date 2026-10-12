import sharp from "sharp";
import {
  applyCodeMotionTiming,
  codeMotionTimingSchema,
} from "../../shared/codeMotionTiming";
import { codeMotionCompositionSchema } from "../../shared/codeMotionComposition";
import { beforeAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const archive = new Map<string, Buffer>();
const dir = path.resolve("docs/evidence/ink-1011-video-consumer");
vi.mock("./artMotionEvidenceStore", () => ({
  persistArtMotionEvidence: async (
    _u: string,
    _r: string,
    name: string,
    bytes: Buffer
  ) => {
    archive.set(path.basename(name), Buffer.from(bytes));
    await writeFile(path.join(dir, path.basename(name)), bytes);
    return {
      gcsUri: `gs://fixture/${name}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  },
}));
vi.mock("./postProduction", async importOriginal => ({
  ...(await importOriginal<typeof import("./postProduction")>()),
  fetchPostProdSourceToFile: async (uri: string, target: string) => {
    await writeFile(
      target,
      await readFile(
        path.join(
          dir,
          uri.endsWith(".mp4")
            ? "source.mp4"
            : uri.endsWith(".png")
              ? "source.png"
              : "narration.wav"
        )
      )
    );
  },
  uploadResult: async ({ filePath }: { filePath: string }) => {
    await writeFile(
      path.join(dir, "mixed-result.mp4"),
      await readFile(filePath)
    );
    return {
      gcsUri: "gs://fixture/mixed.mp4",
      url: "https://fixture.invalid/mixed.mp4",
    };
  },
}));
import { renderArtMotion } from "./artMotionRender";
import { prepareCodeMotionVideoFrames } from "./codeMotionVideoFrames";
import { codeMotionVideoSchema } from "../../shared/codeMotionVideo";
beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#123456" },
  })
    .png()
    .toFile(path.join(dir, "source.png"));
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=24:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-y",
    path.join(dir, "source.mp4"),
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=6",
    "-y",
    path.join(dir, "narration.wav"),
  ]);
});
it("actual exporter mixes 4-second FFmpeg clip with code scenes and only the final narration track", async () => {
  const sha256 = createHash("sha256")
    .update(await readFile(path.join(dir, "source.mp4")))
    .digest("hex");
  const codeVideo = {
    version: 1,
    assets: [
      {
        id: "clip",
        videoUri: "gs://fixture/source.mp4",
        sha256,
        durationSec: 4,
      },
    ],
    clips: [
      { assetId: "clip", at: 1, duration: 4, sourceStartSec: 0, fit: "cover" },
    ],
  };
  const timing = codeMotionTimingSchema.parse({
    version: 1,
    sourceId: "22222222-2222-4222-8222-222222222222",
    sourceSha256: "a".repeat(64),
    method: "manual",
    review: "confirmed",
    words: [
      {
        id: "jump",
        text: "JUMP",
        startSec: 2.13,
        endSec: 2.73,
        confidence: 1,
        action: "rise",
      },
    ],
    beats: [{ id: "beat", at: 2.41, strength: 0.8 }],
  });
  const composition = applyCodeMotionTiming(
    codeMotionCompositionSchema.parse({
      version: 1,
      scenes: [
        {
          id: "code",
          duration: 6,
          background: "#0000ff",
          elements: [
            {
              id: "photo",
              type: "image",
              imageUri: "gs://fixture/source.png",
              width: 1,
              height: 1,
              fit: "cover",
              transform: { x: 0.5, y: 0.5 },
            },
            {
              id: "motion",
              type: "shape",
              shape: "rect",
              width: 0.1,
              height: 0.1,
              layer: 1,
              transform: { x: 0.2, y: 0.3, fill: "#ffcc00" },
              keyframes: [
                { at: 0, x: 0.2 },
                { at: 6, x: 0.8 },
              ],
            },
          ],
        },
      ],
    }),
    timing,
    [
      {
        sourceId: timing.sourceId,
        role: "narration",
        at: 0,
        trimStart: 0,
        duration: 6,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
    ]
  );
  const result = await renderArtMotion(
    {
      action: "art_motion",
      scopeKey: "code-motion:fixture",
      requestId: "c1007000-1234-4234-8234-123456789abc",
      params: {
        version: 1,
        mode: "animation",
        grammar: "y5_kinetic_type",
        duration: 6,
        width: 1280,
        height: 720,
        fps: 24,
        cues: [{ at: 0, kind: "image", imageUri: "gs://fixture/source.png" }],
        composition,
        codeVideo,
        audioUri: "gs://fixture/narration.wav",
      },
    },
    "fixture",
    new AbortController().signal
  );
  expect(result.frameCount).toBe(144);
  const frames = JSON.parse(archive.get("frames.json")!.toString());
  expect(frames).toMatchObject({
    frameCount: 144,
    ffmpegVideoFrames: 96,
    canvasFrames: 48,
    complete: true,
  });
  expect(frames.timingOverlayFrames).toBeGreaterThan(12);
  const probe = JSON.parse(archive.get("probe.raw.json")!.toString());
  expect(
    probe.streams.filter((s: any) => s.codec_type === "audio")
  ).toHaveLength(1);
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "2",
    "-i",
    path.join(dir, "mixed-result.mp4"),
    "-t",
    "0.25",
    "-ar",
    "8000",
    "-ac",
    "1",
    "-f",
    "s16le",
    "-",
  ]);
  const energy = (hz: number) => {
    let re = 0,
      im = 0;
    for (let i = 0; i < pcm.length / 2; i++) {
      const x = pcm.readInt16LE(i * 2);
      re += x * Math.cos((2 * Math.PI * hz * i) / 8000);
      im += x * Math.sin((2 * Math.PI * hz * i) / 8000);
    }
    return re * re + im * im;
  };
  const audio = {
    narration440Hz: energy(440),
    suppressedSource880Hz: energy(880),
  };
  expect(audio.narration440Hz).toBeGreaterThan(
    audio.suppressedSource880Hz * 100
  );
  const snapshot = (name: string, time: number) => {
    const file = path.join(dir, name);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      path.join(dir, "mixed-result.mp4"),
      "-ss",
      String(time),
      "-frames:v",
      "1",
      "-y",
      file,
    ]);
    return file;
  };
  const withOverlay = snapshot("frame-video-word.png", 2.5),
    before = snapshot("frame-static-code.png", 0.5),
    after = snapshot("frame-code-return.png", 5.5);
  const captionPixels = await sharp(withOverlay)
    .extract({ left: 400, top: 530, width: 480, height: 160 })
    .raw()
    .toBuffer();
  let white = 0;
  for (let i = 0; i < captionPixels.length; i += 3)
    if (
      captionPixels[i] > 220 &&
      captionPixels[i + 1] > 220 &&
      captionPixels[i + 2] > 220
    )
      white++;
  expect(white).toBeGreaterThan(300);
  const corner = await sharp(before)
    .extract({ left: 20, top: 20, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect(Math.abs(corner[0] - 18)).toBeLessThan(8);
  expect(Math.abs(corner[1] - 52)).toBeLessThan(8);
  expect(await sharp(after).metadata()).toMatchObject({
    width: 1280,
    height: 720,
  });
  await writeFile(
    path.join(dir, "fixture-result.json"),
    JSON.stringify(
      {
        frameCount: 144,
        ffmpegVideoFrames: 96,
        canvasFrames: 48,
        timingOverlayFrames: frames.timingOverlayFrames,
        wordOverlayWhitePixels: white,
        audio,
        inputSha256: sha256,
      },
      null,
      2
    )
  );
}, 120000);
it("rejects a source whose real bytes differ from the saved fingerprint", async () => {
  const bad = codeMotionVideoSchema.parse({
    version: 1,
    assets: [
      {
        id: "clip",
        videoUri: "gs://fixture/source.mp4",
        sha256: "0".repeat(64),
        durationSec: 4,
      },
    ],
    clips: [{ assetId: "clip", at: 0, duration: 4 }],
  });
  await expect(
    prepareCodeMotionVideoFrames(
      bad,
      { width: 1280, height: 720, fps: 24 },
      dir,
      new AbortController().signal,
      async () => {}
    )
  ).rejects.toThrow("指纹变化");
});

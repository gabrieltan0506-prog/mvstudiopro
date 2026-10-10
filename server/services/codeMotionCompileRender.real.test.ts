import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
const paths = new Map<string, string>(),
  evidence = new Map<string, Buffer>();
const dir = path.resolve("docs/evidence/ink-1011-video-consumer/compile-30s");
vi.mock("./postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: async ({
    source,
  }: {
    source: string;
  }) => {
    if (!paths.has(source)) throw Error("Fixture forbids unregistered source");
    return source;
  },
}));
vi.mock("./artMotionEvidenceStore", () => ({
  persistArtMotionEvidence: async (
    _u: string,
    _r: string,
    name: string,
    bytes: Buffer
  ) => {
    const file = path.basename(name);
    evidence.set(file, Buffer.from(bytes));
    await writeFile(path.join(dir, file), bytes);
    return {
      gcsUri: `gs://fixture/${file}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  },
}));
vi.mock("./postProduction", async original => ({
  ...(await original<typeof import("./postProduction")>()),
  fetchPostProdSourceToFile: async (uri: string, file: string) => {
    const local = paths.get(uri);
    if (!local) throw Error("Fixture forbids non-registered network");
    await writeFile(file, await readFile(local));
  },
  uploadResult: async ({ filePath }: { filePath: string }) => {
    await writeFile(path.join(dir, "mixed-30s.mp4"), await readFile(filePath));
    return {
      gcsUri: "gs://fixture/mixed-30s.mp4",
      url: "https://fixture.invalid/mixed-30s.mp4",
    };
  },
}));
import {
  compileCodeMotion,
  codeMotionProjectSchema,
} from "../../shared/codeMotion";
import { renderArtMotion } from "./artMotionRender";
it("formal CodeMotion compile to 30-second six-scene render with images, semantic timing, 5s video and single voice/BGM mix", async () => {
  await mkdir(dir, { recursive: true });
  const projectId = "11111111-1111-4111-8111-111111111111",
    userId = "12";
  const images = [];
  const colors = [
    "#123456",
    "#345612",
    "#561234",
    "#654321",
    "#216543",
    "#432165",
  ];
  for (let i = 0; i < 6; i++) {
    const id = `44444444-4444-4444-8444-${String(i + 1).padStart(12, "0")}`,
      file = path.join(dir, `scene-${i + 1}.png`),
      gcsUri = `gs://fixture/scene-${i + 1}.png`;
    await sharp({
      create: { width: 320, height: 180, channels: 3, background: colors[i] },
    })
      .png()
      .toFile(file);
    paths.set(gcsUri, file);
    images.push({ id, name: `TEST_ONLY scene ${i + 1}`, gcsUri });
  }
  const audios = [];
  for (let index = 0; index < 2; index++) {
    const hz = [440, 660][index];
    const file = path.join(dir, index ? "bgm.wav" : "narration.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${hz}:duration=30`,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-y",
      file,
    ]);
    const bytes = await readFile(file),
      sha256 = createHash("sha256").update(bytes).digest("hex"),
      id = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
      gcsUri = `gs://fixture/post-prod/${userId}/code-motion/${projectId}/audio/${id}/${sha256}.wav`;
    paths.set(gcsUri, file);
    audios.push({
      id,
      name: index ? "TEST_ONLY BGM 660Hz" : "TEST_ONLY narration 440Hz",
      gcsUri,
      duration: 30,
      mimeType: "audio/wav",
      sha256,
      bytes: bytes.length,
    });
  }
  const video = path.join(dir, "video-5s.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=30:duration=5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-y",
    video,
  ]);
  const videoUri = "gs://fixture/video-5s.mp4";
  paths.set(videoUri, video);
  const videoSha = createHash("sha256")
    .update(await readFile(video))
    .digest("hex");
  const project = codeMotionProjectSchema.parse({
    id: projectId,
    brief: {
      title: "TEST_ONLY formal 30s",
      request: "六镜技术夹具：真实图片、代码动画、视频、词拍和单次原声混音",
      text: "Synthetic fixture only, no paid generation",
      style: "scenes",
      duration: 30,
      orientation: "landscape",
      images,
      audios,
    },
    plan: {
      version: 1,
      summary: "TEST_ONLY six scenes",
      scenes: images.map((image, i) => ({
        heading: `Scene ${i + 1}`,
        body: "TEST_ONLY",
        duration: 5,
        production: {
          imagePrompt: "fixture actual PNG",
          motion: i === 2 ? "natural" : "code",
          videoPrompt: i === 2 ? "fixture actual 5s MP4" : "",
        },
        composition: {
          id: `scene-${i}`,
          duration: 5,
          elements: [
            {
              id: `image-${i}`,
              type: "image",
              imageId: image.id,
              width: 1,
              height: 1,
              fit: "cover",
            },
            {
              id: `title-${i}`,
              type: "text",
              text: `SCENE ${i + 1}`,
              fontSize: 0.09,
              transform: { x: 0.5, y: 0.3, fill: "#ffffff" },
              keyframes: [
                { at: 0, scale: 0.7, opacity: 0 },
                { at: 0.4, scale: 1, opacity: 1 },
              ],
            },
            {
              id: `motion-${i}`,
              type: "shape",
              shape: "rect",
              width: 0.1,
              height: 0.1,
              transform: { x: 0.2, y: 0.55, fill: "#ffcc00" },
              keyframes: [
                { at: 0, x: 0.2, rotation: 0 },
                { at: 5, x: 0.8, rotation: 180 },
              ],
            },
          ],
        },
      })),
      audioTimeline: audios.map((a, i) => ({
        sourceId: a.id,
        role: i ? "bgm" : "narration",
        at: 0,
        trimStart: 0,
        duration: 30,
        volume: i ? 0.2 : 0.8,
        fadeIn: 0,
        fadeOut: 0,
      })),
      codeVideo: {
        version: 1,
        assets: [{ id: "video", videoUri, sha256: videoSha, durationSec: 5 }],
        clips: [
          {
            assetId: "video",
            at: 10,
            duration: 5,
            sourceStartSec: 0,
            fit: "cover",
          },
        ],
      },
      timing: {
        version: 1,
        sourceId: audios[0].id,
        sourceSha256: audios[0].sha256,
        method: "manual",
        review: "confirmed",
        words: [
          {
            id: "one",
            text: "RISE",
            startSec: 0.13,
            endSec: 0.83,
            confidence: 1,
            action: "rise",
          },
          {
            id: "two",
            text: "JUMP",
            startSec: 11.13,
            endSec: 11.73,
            confidence: 1,
            action: "pop",
          },
          {
            id: "three",
            text: "SPIN",
            startSec: 26.12,
            endSec: 26.85,
            confidence: 1,
            action: "spin",
          },
        ],
        beats: [{ id: "beat", at: 11.41, strength: 0.8 }],
      },
    },
  });
  await writeFile(
    path.join(dir, "project.validated.json"),
    JSON.stringify(project, null, 2)
  );
  const spec = compileCodeMotion(project.brief, project.plan);
  expect(spec.duration).toBe(30);
  expect(spec.composition!.scenes).toHaveLength(6);
  const result = await renderArtMotion(
    {
      action: "art_motion",
      requestId: "c1007000-1234-4234-8234-123456789abd",
      scopeKey: `code-motion:${projectId}`,
      params: spec,
    },
    userId,
    new AbortController().signal
  );
  expect(result.frameCount).toBe(900);
  const frames = JSON.parse(evidence.get("frames.json")!.toString());
  expect(frames).toMatchObject({
    complete: true,
    frameCount: 900,
    ffmpegVideoFrames: 150,
    canvasFrames: 750,
  });
  expect(frames.timingOverlayFrames).toBeGreaterThan(15);
  const probe = JSON.parse(evidence.get("probe.raw.json")!.toString());
  expect(Number(probe.format.duration)).toBeCloseTo(30, 1);
  expect(
    probe.streams.filter((s: any) => s.codec_type === "audio")
  ).toHaveLength(1);
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "12",
    "-i",
    path.join(dir, "mixed-30s.mp4"),
    "-t",
    "0.5",
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
    bgm660Hz: energy(660),
    suppressedVideo880Hz: energy(880),
  };
  expect(audio.narration440Hz).toBeGreaterThan(
    audio.suppressedVideo880Hz * 100
  );
  expect(audio.bgm660Hz).toBeGreaterThan(audio.suppressedVideo880Hz * 100);
  for (const [name, time] of [
    ["scene-1", 0.5],
    ["video-word", 11.5],
    ["scene-6", 26.5],
  ] as const)
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      path.join(dir, "mixed-30s.mp4"),
      "-ss",
      String(time),
      "-frames:v",
      "1",
      "-y",
      path.join(dir, `frame-${name}.png`),
    ]);
  await writeFile(
    path.join(dir, "fixture-result.json"),
    JSON.stringify(
      {
        classification:
          "TEST_ONLY synthetic local assets; no paid generation or online acceptance",
        entry:
          "codeMotionProjectSchema -> compileCodeMotion -> renderArtMotion -> renderCodeMotionAudio",
        duration: 30,
        frameCount: 900,
        ffmpegVideoFrames: 150,
        canvasFrames: 750,
        timingOverlayFrames: frames.timingOverlayFrames,
        audio,
        videoSha256: videoSha,
        audioSourceHashes: audios.map(a => a.sha256),
        outputSha256: createHash("sha256")
          .update(await readFile(path.join(dir, "mixed-30s.mp4")))
          .digest("hex"),
      },
      null,
      2
    )
  );
}, 600000);

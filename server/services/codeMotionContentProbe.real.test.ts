/** Opt-in private-media content probe. No user media or outputs are written into the repository. */
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const paths = new Map<string, string>();
const dir = path.resolve(
  process.env.INK_CONTENT_PROBE_DIR || "../pr1697-content-probe"
);
let runName = "original";
vi.mock("./postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: async ({
    source,
  }: {
    source: string;
  }) => {
    if (!paths.has(source))
      throw Error("Private probe forbids unregistered source");
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
    const folder = path.join(dir, runName);
    await mkdir(folder, { recursive: true });
    const file = path.basename(name);
    await writeFile(path.join(folder, file), bytes);
    return {
      gcsUri: `gs://private-fixture/${runName}/${file}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  },
}));
vi.mock("./postProduction", async original => ({
  ...(await original<typeof import("./postProduction")>()),
  fetchPostProdSourceToFile: async (uri: string, file: string) => {
    const local = paths.get(uri);
    if (!local) throw Error("Private probe forbids external network");
    await writeFile(file, await readFile(local));
  },
  uploadResult: async ({ filePath }: { filePath: string }) => {
    await writeFile(path.join(dir, `${runName}.mp4`), await readFile(filePath));
    return {
      gcsUri: `gs://private-fixture/${runName}.mp4`,
      url: `https://fixture.invalid/${runName}.mp4`,
    };
  },
}));
import {
  compileCodeMotion,
  codeMotionProjectSchema,
  type CodeMotionProject,
} from "../../shared/codeMotion";
import { renderArtMotion } from "./artMotionRender";
it.skipIf(process.env.INK_CONTENT_PROBE !== "1")(
  "real content: six semantic scenes with existing reference narration, reference clip and editable scene",
  async () => {
    await mkdir(dir, { recursive: true });
    const config = JSON.parse(
      await readFile(path.join(dir, "project-plan.json"), "utf8")
    );
    const source = config.sourceVideoPath,
      sourceWindowStart = config.sourceWindowStart ?? 50.8;
    const videoAt = config.referenceVideoAt ?? 15;
    const projectId = "11111111-1111-4111-8111-111111111112",
      userId = "12";
    const images: CodeMotionProject["brief"]["images"] = [];
    for (let i = 0; i < 6; i++) {
      const id = `44444444-4444-4444-8444-${String(i + 101).padStart(12, "0")}`,
        file = path.join(dir, `source-scene-${i + 1}.png`),
        gcsUri = `gs://private-fixture/source-scene-${i + 1}.png`;
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(sourceWindowStart + i * 5 + 2.5),
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        "crop=592:334:0:412",
        "-y",
        file,
      ]);
      paths.set(gcsUri, file);
      images.push({ id, name: `既有参考片画面${i + 1}`, gcsUri });
    }
    const audioFile = path.join(dir, "reference-narration.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      source,
      "-ss",
      String(sourceWindowStart),
      "-t",
      "30",
      "-map",
      "0:a:0",
      "-vn",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-y",
      audioFile,
    ]);
    const audioBytes = await readFile(audioFile),
      audioSha = createHash("sha256").update(audioBytes).digest("hex"),
      audioId = "22222222-2222-4222-8222-222222222223",
      audioUri = `gs://private-fixture/post-prod/${userId}/code-motion/${projectId}/audio/${audioId}/${audioSha}.wav`;
    paths.set(audioUri, audioFile);
    const audio = {
      id: audioId,
      name: "用户参考片既有口播与配乐（录屏原速1.5x）",
      gcsUri: audioUri,
      duration: 30,
      mimeType: "audio/wav",
      sha256: audioSha,
      bytes: audioBytes.length,
    };
    const video = path.join(dir, "existing-reference-5s.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      source,
      "-ss",
      String(config.referenceVideoSourceStart ?? sourceWindowStart + videoAt),
      "-t",
      "5",
      "-vf",
      "crop=592:334:0:412,fps=30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-y",
      video,
    ]);
    const videoUri = "gs://private-fixture/existing-reference-5s.mp4";
    paths.set(videoUri, video);
    const videoSha = createHash("sha256")
      .update(await readFile(video))
      .digest("hex");
    const supplied =
      config.scenes || config.plan?.scenes || config.project?.plan?.scenes;
    if (!Array.isArray(supplied) || supplied.length !== 6)
      throw Error("Content plan requires six authored scenes");
    const scenes = supplied.map((raw: any, i: number) => {
      const composition = raw.composition || raw;
      const elements = composition.elements.map((e: any) =>
        e.type === "image" ? { ...e, imageId: images[i].id } : e
      );
      if (!elements.some((e: any) => e.type === "image"))
        elements.unshift({
          id: `reference-${i}`,
          type: "image",
          imageId: images[i].id,
          width: 1,
          height: 1,
          fit: "cover",
          transform: { x: 0.5, y: 0.5, opacity: 1 },
          layer: -10,
        });
      return {
        heading: raw.heading || `镜${i + 1}`,
        body: raw.body || "既有原音内容探针",
        duration: 5,
        composition: {
          ...composition,
          id: composition.id || `content-${i}`,
          duration: 5,
          elements,
        },
      };
    });
    const project = codeMotionProjectSchema.parse({
      id: projectId,
      brief: {
        title:
          config.title ||
          config.project?.brief?.title ||
          "从歌词到可修改的动画",
        request:
          "基于用户参考片已有口播，逐镜解释动作、镜头、衔接、制作、预览、核对；不是新生成口播或画面",
        text: "既有素材内容探针",
        style: "scenes",
        duration: 30,
        orientation: "landscape",
        images,
        audios: [audio],
      },
      plan: {
        version: 1,
        summary: "既有原声与六镜语义编排",
        scenes,
        audioTimeline: [
          {
            sourceId: audioId,
            role: "narration",
            at: 0,
            trimStart: 0,
            duration: 30,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
          },
        ],
        codeVideo: {
          version: 1,
          assets: [
            {
              id: "existing-reference",
              videoUri,
              sha256: videoSha,
              durationSec: 5,
            },
          ],
          clips: [
            {
              assetId: "existing-reference",
              at: videoAt,
              duration: 5,
              sourceStartSec: 0,
              fit: "cover",
            },
          ],
        },
        ...(config.timing
          ? {
              timing: {
                ...config.timing,
                sourceId: audioId,
                sourceSha256: audioSha,
              },
            }
          : {}),
      },
    });
    await writeFile(
      path.join(dir, "project.original.json"),
      JSON.stringify(project, null, 2)
    );
    const spec = compileCodeMotion(project.brief, project.plan);
    await renderArtMotion(
      {
        action: "art_motion",
        requestId: "c1007000-1234-4234-8234-123456789abe",
        scopeKey: `code-motion:${projectId}`,
        params: spec,
      },
      userId,
      new AbortController().signal
    );
    const edited = codeMotionProjectSchema.parse(
        JSON.parse(JSON.stringify(project))
      ),
      index = config.editSceneIndex ?? 5;
    const element = edited.plan!.scenes[index].composition!.elements.find(
      e => e.type === "text" && e.id === "caption"
    );
    if (!element || element.type !== "text")
      throw Error("Editable content scene requires text");
    const beforeText = element.text;
    element.text = config.editText || "只核對聲音，其他畫面與秒窗保持不變";
    const focus = edited.plan!.scenes[index].composition!.elements.find(
      e => e.id === "focus"
    );
    if (focus) focus.transform = { ...focus.transform, x: 0.5 };
    element.transform = { ...element.transform, fill: "#f6b951" };
    await writeFile(
      path.join(dir, "project.edited.json"),
      JSON.stringify(edited, null, 2)
    );
    const after = compileCodeMotion(edited.brief, edited.plan),
      single = {
        ...after,
        duration: 5,
        composition: {
          version: 1 as const,
          scenes: [after.composition!.scenes[index]],
        },
        codeVideo: undefined,
        codeAudio: {
          sources: after.codeAudio!.sources,
          audioTimeline: [
            {
              ...after.codeAudio!.audioTimeline[0],
              at: 0,
              trimStart: index * 5,
              duration: 5,
            },
          ],
        },
      };
    runName = "edited-scene";
    await renderArtMotion(
      {
        action: "art_motion",
        requestId: "c1007000-1234-4234-8234-123456789abf",
        scopeKey: `code-motion:${projectId}`,
        params: single,
      },
      userId,
      new AbortController().signal
    );
    for (const [name, file, time] of [
      ["original-scene", "original.mp4", index * 5 + 2.5],
      ["edited-scene", "edited-scene.mp4", 2.5],
      ["content-action", "original.mp4", 2.5],
      ["existing-video", "original.mp4", videoAt + 2.5],
    ] as const)
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        path.join(dir, file),
        "-ss",
        String(time),
        "-frames:v",
        "1",
        "-y",
        path.join(dir, `${name}.png`),
      ]);
    const probe = JSON.parse(
      await readFile(path.join(dir, "original/probe.raw.json"), "utf8")
    );
    expect(Number(probe.format.duration)).toBeCloseTo(30, 1);
    expect(
      probe.streams.filter((s: any) => s.codec_type === "audio")
    ).toHaveLength(1);
    const originalPcm = execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        audioFile,
        "-ss",
        String(videoAt + 2),
        "-t",
        "1",
        "-ar",
        "8000",
        "-ac",
        "1",
        "-f",
        "s16le",
        "-",
      ]),
      renderPcm = execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        path.join(dir, "original.mp4"),
        "-ss",
        String(videoAt + 2),
        "-t",
        "1",
        "-ar",
        "8000",
        "-ac",
        "1",
        "-f",
        "s16le",
        "-",
      ]);
    let aa = 0,
      bb = 0,
      ab = 0;
    for (
      let i = 0;
      i < Math.min(originalPcm.length, renderPcm.length);
      i += 2
    ) {
      const a = originalPcm.readInt16LE(i),
        b = renderPcm.readInt16LE(i);
      aa += a * a;
      bb += b * b;
      ab += a * b;
    }
    const correlation = ab / Math.sqrt(aa * bb),
      gain = Math.sqrt(bb / aa);
    expect(correlation).toBeGreaterThan(0.97);
    expect(gain).toBeGreaterThan(0.95);
    expect(gain).toBeLessThan(1.05);
    await writeFile(
      path.join(dir, "probe.json"),
      JSON.stringify(
        {
          classification:
            "PRIVATE content probe using provided reference media; not generated assets or online acceptance",
          sourceWindowStart,
          duration: 30,
          sourcePlayback:
            "as provided 1.5x screen recording; no speed correction",
          referenceVideoWindow: [
            config.referenceVideoSourceStart ?? sourceWindowStart + videoAt,
            (config.referenceVideoSourceStart ?? sourceWindowStart + videoAt) +
              5,
          ],
          referenceVideoIsGenerated: false,
          entry:
            "codeMotionProjectSchema -> compileCodeMotion -> renderArtMotion -> renderCodeMotionAudio",
          audio: { streams: 1, correlation, gain, sourceSha256: audioSha },
          edit: {
            scene: index + 1,
            beforeText,
            afterText: element.text,
            onlyOneSceneChanged:
              edited.plan!.scenes.filter(
                (s, i) =>
                  JSON.stringify(s) !== JSON.stringify(project.plan!.scenes[i])
              ).length === 1,
          },
          outputSha256: createHash("sha256")
            .update(await readFile(path.join(dir, "original.mp4")))
            .digest("hex"),
        },
        null,
        2
      )
    );
  },
  600000
);

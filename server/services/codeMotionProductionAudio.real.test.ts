import { afterAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  sources: new Map<string, string>(),
  output: Buffer.alloc(0),
  filters: [] as string[],
  renderCalls: 0,
}));
vi.mock("./codeMotionStore", () => ({
  codeMotionStorage: {
    read: async (n: string) =>
      state.files.has(n) ? { body: state.files.get(n), generation: "1" } : null,
    write: async (n: string, b: Buffer) => {
      state.files.set(n, b);
      return "1";
    },
    list: async () => [],
  },
  loadCodeMotion: vi.fn(),
}));
vi.mock("./gcs", async importOriginal => ({
  ...(await importOriginal<any>()),
  getGcsBucketName: () => "probe-bucket",
  uploadBufferToGcsIfAbsent: vi.fn(async ({ buffer }: any) => {
    state.output = buffer;
    return true;
  }),
}));
vi.mock("./postProdMediaSource", async importOriginal => ({
  ...(await importOriginal<any>()),
  resolveRegisteredPostProdMediaSource: async ({ source }: any) => source,
}));
vi.mock("./postProduction", async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    fetchPostProdSourceToFile: async (uri: string, file: string) => {
      const source = state.sources.get(uri);
      if (!source) throw Error("unregistered fixture");
      await copyFile(source, file);
      return (await readFile(source)).length;
    },
    runMediaTool: async (cmd: any, args: any, signal: any) => {
      if (cmd === "ffmpeg" && args.includes("-af"))
        state.filters.push(args[args.indexOf("-af") + 1]);
      return actual.runMediaTool(cmd, args, signal);
    },
  };
});
vi.mock("./codeMotionAudio", async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    renderCodeMotionAudio: async (...args: any[]) => {
      state.renderCalls++;
      return actual.renderCodeMotionAudio(...args);
    },
  };
});
import {
  codeMotionProductionAudioFingerprint,
  prepareCodeMotionProductionAudio,
  getCodeMotionProductionAudio,
} from "./codeMotionProductionAudio";
import { runMediaTool, probeAudio } from "./postProduction";
import type { CodeMotionProject } from "../../shared/codeMotion";
let root = "";
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("正式混音器与每镜参考音真实FFmpeg探针", () => {
  it("440/880Hz20秒技术音沿正式混音保存为5–10秒窗，精确240000帧且两频都在；恢复零重混", async () => {
    root = await mkdtemp(path.join(tmpdir(), "ink-audio-proof-"));
    const signal = AbortSignal.timeout(90_000),
      projectId = "11111111-1111-4111-8111-111111111111";
    const sources = [];
    for (let i = 0; i < 2; i++) {
      const file = path.join(root, `tone-${i}.wav`);
      await runMediaTool(
        "ffmpeg",
        [
          "-y",
          "-nostdin",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${i ? 880 : 440}:sample_rate=48000:duration=20`,
          "-ac",
          "2",
          "-c:a",
          "pcm_s16le",
          file,
        ],
        signal
      );
      const bytes = await readFile(file),
        sha256 = createHash("sha256").update(bytes).digest("hex"),
        id = i
          ? "33333333-3333-4333-8333-333333333333"
          : "22222222-2222-4222-8222-222222222222",
        gcsUri = `gs://probe-bucket/post-prod/7/code-motion/${projectId}/audio/${id}/${sha256}.wav`;
      state.sources.set(gcsUri, file);
      sources.push({
        id,
        name: `技术${i ? 880 : 440}Hz`,
        gcsUri,
        duration: 20,
        mimeType: "audio/wav" as const,
        sha256,
        bytes: bytes.length,
      });
    }
    const project = {
      id: projectId,
      brief: {
        title: "音短窗技术探针",
        request: "测试音讯参考",
        text: "",
        style: "words",
        duration: 20,
        orientation: "landscape",
        images: [],
        audios: sources,
        data: [],
        unit: "",
        chart: "bar",
        period: "",
        source: "",
      },
      plan: {
        version: 1,
        summary: "技术探针",
        scenes: Array.from({ length: 4 }, () => ({
          heading: "技术",
          body: "音讯窗口",
          duration: 5,
        })),
        audioTimeline: sources.map((s, i) => ({
          sourceId: s.id,
          role: i ? "bgm" : "narration",
          at: 0,
          duration: 20,
          trimStart: 0,
          volume: i ? 0.3 : 0.8,
          fadeIn: 2,
          fadeOut: 2,
        })),
      },
    } as CodeMotionProject;
    const shot = {
      at: 5,
      duration: 5,
      audioFingerprint: codeMotionProductionAudioFingerprint(project, 5, 5),
    };
    const urls = await prepareCodeMotionProductionAudio("7", project, shot);
    expect(urls).toHaveLength(1);
    const output = path.join(root, "reference.wav");
    await writeFile(output, state.output);
    expect(await probeAudio(output, signal)).toBe(5);
    expect(state.filters).toContain(
      "atrim=start_sample=240000:end_sample=480000,asetpts=PTS-STARTPTS"
    );
    const raw = path.join(root, "reference.pcm");
    await runMediaTool(
      "ffmpeg",
      [
        "-y",
        "-i",
        output,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "s16le",
        raw,
      ],
      signal
    );
    const pcm = await readFile(raw);
    expect(pcm.length / 2).toBe(240000);
    function energy(f: number) {
      let re = 0,
        im = 0;
      for (let n = 0; n < 48000; n++) {
        const v = pcm.readInt16LE(n * 2) / 32768;
        re += v * Math.cos((2 * Math.PI * f * n) / 48000);
        im += v * Math.sin((2 * Math.PI * f * n) / 48000);
      }
      return Math.sqrt(re * re + im * im) / 48000;
    }
    const energy440 = energy(440),
      energy880 = energy(880);
    expect(energy440).toBeGreaterThan(0.02);
    expect(energy880).toBeGreaterThan(0.008);
    expect(energy440).toBeGreaterThan(energy880 * 2);
    const receipt = await getCodeMotionProductionAudio(
      "7",
      project.id,
      shot.audioFingerprint
    );
    expect(receipt?.durationSec).toBe(5);
    await expect(
      prepareCodeMotionProductionAudio("7", project, shot)
    ).resolves.toEqual(urls);
    expect(state.renderCalls).toBe(1);
    const report = {
      fixture: "440Hz narration + 880Hz BGM; both 20s, stereo 48kHz",
      sourceWindow: { at: 5, duration: 5 },
      sampleFrames: pcm.length / 2,
      referenceDurationSec: 5,
      energy440,
      energy880,
      filters: state.filters,
      receipt,
      renderCallsAfterRestore: state.renderCalls,
      providerCalls: 0,
    };
    const evidence = process.env.INK_PRODUCTION_AUDIO_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await copyFile(output, path.join(evidence, "five-second-reference.wav"));
      await writeFile(
        path.join(evidence, "audio-reference-probe.json"),
        JSON.stringify(report, null, 2)
      );
    }
    console.log(JSON.stringify(report));
  }, 90000);
});

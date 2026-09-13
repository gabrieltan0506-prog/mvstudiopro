import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import {
  buildPrevisLayerBundle,
  validatePrevisLayerBundle,
  layerSha,
} from "./manhuaPrevisLayers";
import { renderManhuaPrevis } from "./manhuaPrevisRender";
import {
  recoverPrevisResult,
  type PrevisRecoveryRow,
} from "./manhuaPrevisRecovery";
import { previsTaskId } from "./manhuaPrevisTask";
const scene = Buffer.alloc(1300, 7);
async function fixture(folder?: string) {
  const studio = createManhuaPrevisStudio(
    2,
    "11111111-1111-4111-8111-111111111111"
  );
  studio.spec.exportLayers = true;
  const dir =
    folder ?? (await mkdtemp(path.join(tmpdir(), "previs-layers-test-")));
  const mask = await sharp({
    create: { width: 960, height: 540, channels: 3, background: "#808080" },
  })
    .toColourspace("b-w")
    .png()
    .toBuffer();
  const depth = await sharp({
    create: { width: 960, height: 540, channels: 3, background: "#808080" },
  })
    .toColourspace("grey16")
    .png()
    .toBuffer();
  const files: Array<{
    layer: string;
    frame: number;
    path: string;
    bytes: number;
    sha256: string;
  }> = [];
  for (const layer of ["actors", "effects", "depth"]) {
    await mkdir(path.join(dir, layer), { recursive: true });
    for (let frame = 1; frame <= 48; frame++) {
      const name = `${layer}/frame-${String(frame).padStart(4, "0")}.png`,
        bytes = layer === "depth" ? depth : mask;
      await writeFile(path.join(dir, name), bytes);
      files.push({
        layer,
        frame,
        path: name,
        bytes: bytes.length,
        sha256: layerSha(bytes),
      });
    }
  }
  const meta = {
    version: 1,
    kind: "geometry_masks_depth_v1",
    complete: true,
    fps: 24,
    frameCount: 48,
    selectedFrames: Array.from({ length: 48 }, (_, i) => i + 1),
    width: 960,
    height: 540,
    sceneSha256: layerSha(scene),
    depth: {
      encoding: "linear_z_pass_clip_normalized_u16",
      nearValue: 0,
      farValue: 1,
      backgroundValue: 1,
    },
    cameras: Array.from({ length: 48 }, (_, i) => ({
      frame: i + 1,
      clipStart: 0.1,
      clipEnd: 100,
    })),
    files,
    boundaryZh: "测试生成灰度PNG，仅验证打包和恢复契约，不是实际渲染",
  };
  const raw = Buffer.from(JSON.stringify(meta));
  await writeFile(path.join(dir, "meta.json"), raw);
  return { dir, spec: studio.spec, meta, raw };
}
describe("分层包固定文件与恢复边界", () => {
  it("144帧PNG完整解码并打包，无额外目录与路径", async () => {
    const f = await fixture();
    const b = await buildPrevisLayerBundle(
      f.dir,
      f.raw,
      f.spec,
      layerSha(scene)
    );
    expect(
      (await validatePrevisLayerBundle(b.bytes, f.spec, layerSha(scene))).files
    ).toHaveLength(144);
  });
  it.each(["partial", "duplicate", "frame", "hash", "depth"])(
    "拒绝%s不完整或假层",
    async mode => {
      const f = await fixture();
      if (mode === "partial") f.meta.complete = false;
      if (mode === "duplicate") f.meta.files[1] = f.meta.files[0];
      if (mode === "frame") f.meta.selectedFrames[1] = 1;
      if (mode === "hash") f.meta.files[0].sha256 = "0".repeat(64);
      if (mode === "depth") {
        const file = f.meta.files.find(x => x.layer === "depth")!;
        const wrong = await readFile(path.join(f.dir, f.meta.files[0].path));
        file.bytes = wrong.length;
        file.sha256 = layerSha(wrong);
        await writeFile(path.join(f.dir, file.path), wrong);
      }
      await expect(
        buildPrevisLayerBundle(
          f.dir,
          Buffer.from(JSON.stringify(f.meta)),
          f.spec,
          layerSha(scene)
        )
      ).rejects.toThrow();
    }
  );
  it.each(["deflate", "traversal", "extra"])(
    "恢复拒绝%sZIP而不解压到本地",
    async mode => {
      const zip = new JSZip();
      zip.file(mode === "traversal" ? "../meta.json" : "meta.json", "{}");
      if (mode === "extra") zip.file("extra.txt", "x");
      const bytes = await zip.generateAsync({
        type: "nodebuffer",
        compression: mode === "deflate" ? "DEFLATE" : "STORE",
      });
      const spec = createManhuaPrevisStudio(2).spec;
      spec.exportLayers = true;
      await expect(
        validatePrevisLayerBundle(bytes, spec, layerSha(scene))
      ).rejects.toThrow();
    }
  );
  it.each(["success", "partial-failure", "disabled"])(
    "生产入口%s层输出与旧回执保护",
    async mode => {
      const f = await fixture();
      const objects = new Map<string, Buffer>(),
        runs: string[][] = [];
      const input = {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: "11111111-1111-4111-8111-111111111111",
        clipId: "clip-layer",
        spec: f.spec,
      };
      if (mode === "disabled") delete input.spec.exportLayers;
      const task = renderManhuaPrevis(
        input,
        "7",
        { signal: AbortSignal.timeout(30000) },
        {
          blender: "test-blender",
          useXvfb: false,
          upload: async ({ objectName, buffer }) => {
            objects.set(`gs://test/${objectName}`, buffer);
            return {
              bucket: "test",
              objectName,
              gcsUri: `gs://test/${objectName}`,
            };
          },
          run: async (command, args) => {
            runs.push(args);
            const script = args.indexOf("--python");
            if (
              script >= 0 &&
              args[script + 1].endsWith("render-manhua-previs.py")
            ) {
              const dir = args.at(-1)!;
              await writeFile(path.join(dir, "scene.blend"), scene);
              await writeFile(
                path.join(dir, "report.json"),
                JSON.stringify({
                  frames: 48,
                  fps: 24,
                  actors: [
                    {
                      id: "actor-1",
                      nameZh: "角色 1",
                      bones: 16,
                      contactError: 0,
                      stanceDrift: 0,
                      offscreenFrames: [],
                    },
                  ],
                  warnings: [],
                })
              );
              await mkdir(path.join(dir, "frames"));
              for (let i = 1; i <= 48; i++)
                await writeFile(
                  path.join(
                    dir,
                    `frames/frame-${String(i).padStart(4, "0")}.png`
                  ),
                  Buffer.from("test-frame")
                );
            }
            if (
              script >= 0 &&
              args[script + 1].endsWith("render_previs_layers.py")
            ) {
              expect(path.isAbsolute(args.at(-3)!)).toBe(true);
              expect(path.basename(args.at(-2)!)).toBe("spec.json");
              await cp(f.dir, path.join(args.at(-1)!, "layers"), {
                recursive: true,
              });
              if (mode === "partial-failure") {
                await writeFile(
                  path.join(args.at(-1)!, "layers/meta.json"),
                  JSON.stringify({ ...f.meta, complete: false })
                );
                throw Error("测试层渲染中止");
              }
            }
            if (command === "ffmpeg")
              await writeFile(args.at(-1)!, Buffer.alloc(1200, 3));
            if (command === "ffprobe")
              return JSON.stringify({
                streams: [{ width: 960, height: 540, nb_read_frames: "48" }],
                format: { duration: "2" },
              });
            return "";
          },
        }
      );
      const prefix = `gs://test/post-prod/7/previs/${input.requestId}/`;
      if (mode === "partial-failure") {
        await expect(task).rejects.toThrow("测试层渲染中止");
        expect(
          JSON.parse(objects.get(prefix + "layers.meta.json")!.toString())
            .complete
        ).toBe(false);
        expect(objects.has(prefix + "preview.mp4")).toBe(true);
        expect(objects.has(prefix + "layer-bundle.zip")).toBe(false);
        expect(objects.has(prefix + "result.json")).toBe(false);
        expect(
          runs.filter(a => a.some(x => x.endsWith("render_previs_layers.py")))
        ).toHaveLength(1);
        return;
      }
      const result = await task;
      if (mode === "disabled") {
        expect("layerBundle" in result).toBe(false);
        expect(
          runs.some(a => a.some(x => x.endsWith("render_previs_layers.py")))
        ).toBe(false);
        expect(
          Array.from(objects.keys()).some(
            n => n.includes("layers.meta") || n.endsWith("layer-bundle.zip")
          )
        ).toBe(false);
        return;
      }
      expect(result.layerBundle?.format).toBe("previs-layers-v1");
      expect(
        runs.filter(a => a.some(x => x.endsWith("render_previs_layers.py")))
      ).toHaveLength(1);
      expect(objects.get(prefix + "layers.meta.json")).toEqual(f.raw);
      expect(objects.has(prefix + "layers.meta.parsed.json")).toBe(true);
      const row = {
        id: previsTaskId(7, input.requestId),
        userId: "7",
        type: "post_prod",
        provider: "blender-previs",
        status: "failed",
        input: { action: "manhua_previs", params: input },
        output: null,
      } as PrevisRecoveryRow;
      const save = vi.fn(
        async (r: PrevisRecoveryRow, output: Record<string, unknown>) => ({
          ...r,
          status: "succeeded",
          output,
        })
      );
      const inspect = vi.fn(async ({ gcsUri, maxBytes, onChunk }: any) => {
        const b = objects.get(gcsUri);
        if (!b || b.length > maxBytes) throw Error("missing");
        onChunk?.(b);
        return { byteLength: b.length, sha256: layerSha(b) };
      });
      expect(
        (
          await recoverPrevisResult(row, 7, {
            bucket: () => "test",
            inspect: inspect as never,
            save,
          })
        ).status
      ).toBe("succeeded");
      save.mockClear();
      inspect.mockClear();
      expect(
        await recoverPrevisResult(row, 8, {
          bucket: () => "test",
          inspect: inspect as never,
          save,
        })
      ).toBe(row);
      expect(inspect).not.toHaveBeenCalled();
      const originalResult = objects.get(prefix + "result.json")!;
      const originalManifest = objects.get(prefix + "result-evidence.json")!;
      const foreign = JSON.parse(originalResult.toString());
      foreign.layerBundle.gcsUri =
        "gs://test/post-prod/8/previs/foreign/layer-bundle.zip";
      const changed = Buffer.from(JSON.stringify(foreign)),
        manifest = JSON.parse(originalManifest.toString());
      manifest.result.bytes = changed.length;
      manifest.result.sha256 = layerSha(changed);
      objects.set(prefix + "result.json", changed);
      objects.set(
        prefix + "result-evidence.json",
        Buffer.from(JSON.stringify(manifest))
      );
      expect(
        await recoverPrevisResult(row, 7, {
          bucket: () => "test",
          inspect: inspect as never,
          save,
        })
      ).toBe(row);
      expect(
        inspect.mock.calls.some(
          ([arg]) => arg.gcsUri === foreign.layerBundle.gcsUri
        )
      ).toBe(false);
      objects.set(prefix + "result.json", originalResult);
      objects.set(prefix + "result-evidence.json", originalManifest);
      objects.set(prefix + "layer-bundle.zip", Buffer.from("corrupt"));
      expect(
        await recoverPrevisResult(row, 7, {
          bucket: () => "test",
          inspect: inspect as never,
          save,
        })
      ).toBe(row);
      expect(save).not.toHaveBeenCalled();
    }
  );
});
it.skipIf(!process.env.PREVIS_LAYERS_EVIDENCE)(
  "消费真实本地三层产物并逐PNG解码，零新渲染",
  async () => {
    const root = process.env.PREVIS_LAYERS_EVIDENCE!;
    const spec = JSON.parse(
      await readFile(path.join(root, "spec.json"), "utf8")
    );
    const blend = await readFile(path.join(root, "scene.blend"));
    const raw = await readFile(path.join(root, "layers/meta.json"));
    const bundle = await buildPrevisLayerBundle(
      path.join(root, "layers"),
      raw,
      spec,
      layerSha(blend)
    );
    const checked = await validatePrevisLayerBundle(
      bundle.bytes,
      spec,
      layerSha(blend)
    );
    expect(checked.files).toHaveLength(spec.durationSec * 24 * 3);
    await writeFile(path.join(root, "layer-bundle.zip"), bundle.bytes);
  },
  120000
);

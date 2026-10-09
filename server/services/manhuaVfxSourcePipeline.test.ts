/** 无媒体验证：注入进程/存储，帧使用仓库既有PNG，不执行FFmpeg或Blender渲染。 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { makeManhuaVfxEffect } from "../../client/src/lib/manhuaVfxWorkflow";
import { renderManhuaVfx, buildVfxCompositeArgs, validateVfxBullet3dManifest } from "./manhuaVfxRender";
import type { ManhuaVfxEffect } from "../../shared/manhuaVfx";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const meta = { width: 512, height: 512, fps: 24, durationSec: 1, hasAudio: true };
const probe = (audio: boolean) => JSON.stringify({ format: { duration: "1" }, streams: [{ codec_type: "video", width: 512, height: 512, avg_frame_rate: "24/1", duration: "1" }, ...(audio ? [{ codec_type: "audio" }] : [])] });
function orbitManifest(effect: ManhuaVfxEffect) {
  const p = effect.bullet!, geometrySha = "b".repeat(64);
  return { complete: true, eventId: effect.id, sceneJobId: p.sceneJobId, sceneSha256: "a".repeat(64), frozenGeometrySHA: geometrySha, width: 512, height: 512, fps: 24, frameCount: 24, alpha: "straight", colorSpace: "sRGB", vertexFrames: 8 * 24, sourceGeometry: { meshes: 1, vertices: 8, minimum: [-1, -1, 0], maximum: [1, 1, 2], nonPlanarThickness: 2 }, sourceScene: { fps: 24, frameStart: 1, frameEnd: 48, freezeSec: p.freezeSec, frozenFrame: 1 + p.freezeSec * 24 }, visibilitySamples: Array.from({ length: 13 }, (_, index) => ({ progress: index / 12, visibleVertices: 8 })), files: [] as Array<{frame:number;path:string;bytes:number;sha256:string}>, frames: Array.from({ length: 24 }, (_, index) => {
    const angle = (p.startAngleDeg + p.sweepDeg * index / 23) * Math.PI / 180;
    const position = [p.target[0] + p.radius * Math.cos(angle), p.target[1] + p.radius * Math.sin(angle), p.target[2] + p.height];
    const distance = Math.hypot(...position.map((value, axis) => p.target[axis] - value));
    const forward = position.map((value, axis) => (p.target[axis] - value) / distance);
    return { frame: index + 1, timeSec: index / 24, active: true, frozenGeometrySHA: geometrySha, camera: { type: "PERSP", position, target: p.target, lensMm: p.lensMm, frozenGeometrySHA: geometrySha, matrixWorld: [[1,0,-forward[0],position[0]], [0,1,-forward[1],position[1]], [0,0,-forward[2],position[2]], [0,0,0,1]] } };
  }) };
}
async function pipeline(effect: ManhuaVfxEffect, failPixels = false) {
  const png = await readFile("client/public/pwa-icon-512.png"), archives = new Map<string, Buffer>(), calls: string[] = [];
  let compositeArgs: string[] = [];
  const request = { action: "manhua_vfx", scopeKey: "offline", requestId: "10090000-1234-4234-8234-123456789abc", params: { videoUri: "gs://test/source.mp4", sourceKey: "current", composition: { version: 1, seed: 42, effects: [effect] } } };
  const result = await renderManhuaVfx(request, "7", new AbortController().signal, {
    fetch: async (_uri, file) => { await writeFile(file, "source-byte-fixture"); return 19; },
    upload: async ({ objectName, buffer }) => { archives.set(path.basename(objectName), buffer); return { bucket: "test", objectName, gcsUri: `gs://test/${objectName}` }; },
    prepareScene: async (_params, id, _user, root) => { calls.push("resolve-owned-scene"); return { scenePath: path.join(root, "scenes", `scene-${id}.blend`), sceneSha256: "a".repeat(64), receipt: { gcsUri: "gs://test/scene.blend", contentType: "application/octet-stream", fileName: "scene.blend", sha256: "a".repeat(64), sourceRequestId: "request", sourceScopeId: "scope", sourceClipId: "clip", durationSec: 2, bytes: 1024 } }; },
    runBlender: async (_command, args) => {
      const script = args[args.indexOf("--python") + 1]; calls.push(path.basename(script));
      if (script.endsWith("manhua_vfx_liquid_ghost.py")) {
        const output = args.at(-1)!;
        if (failPixels) throw Error("pixel process failed");
        const bytes = Buffer.from("processed-byte-fixture"); await writeFile(output, bytes);
        await writeFile(output + ".json", JSON.stringify({ version: 1, frames: 24, width: 512, height: 512, fps: 24, audio: "original-source-only", bytes: bytes.length, effects: [effect.id], decodedOutputSha256: "c".repeat(64) }));
        return "process fixture";
      }
      const output = args.at(-1)!; await mkdir(output, { recursive: true });
      const specPath = script.endsWith("manhua_vfx_bullet3d.py") ? args.at(-3)! : args.at(-2)!;
      const raw = await readFile(specPath), spec = JSON.parse(raw.toString());
      const files = [];
      for (let frame = 1; frame <= 24; frame++) { const name = `frame-${String(frame).padStart(6, "0")}.png`; await writeFile(path.join(output, name), png); files.push({ frame, path: name, bytes: png.length, sha256: sha(png) }); }
      const manifest = script.endsWith("manhua_vfx_bullet3d.py") ? { ...orbitManifest(effect), files } : { complete: true, width: 512, height: 512, fps: 24, frameCount: 24, alpha: "straight", colorSpace: "sRGB", files, frames: files.map((file, index) => ({ frame: file.frame, timeSec: index / 24, effects: spec.effects.map((item: ManhuaVfxEffect) => ({ id: item.id, kind: item.kind, active: true, progress: index / 24, opacity: .5, position: [.5, .5] })) })) };
      await writeFile(path.join(output, "input.raw.json"), raw); await writeFile(path.join(output, "spec.normalized.json"), raw); await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest)); return "renderer fixture";
    },
    runMedia: async (command, args) => { if (command === "ffprobe") return { stdout: probe(!args.at(-1)!.endsWith("processed.mkv")), stderr: "" }; compositeArgs = args; calls.push("composite"); await writeFile(args.at(-1)!, "result-byte-fixture"); return { stdout: "", stderr: "" }; },
    uploadResult: async () => { calls.push("upload-result"); return { gcsUri: "gs://test/result.mp4", url: "https://example.invalid/result.mp4", bytes: 19 }; },
  });
  return { result, calls, archives, compositeArgs };
}
it.each(["liquid_mirror", "motion_ghost", "bullet_wave"] as const)("%s进入实际像素处理调用后合成，原声映射原始文件", async kind => {
  const effect = makeManhuaVfxEffect(kind, "pixel"); const p = await pipeline(effect);
  expect(p.calls).toEqual(["manhua_vfx_liquid_ghost.py", "manhua_vfx.py", "composite", "upload-result"]);
  expect(p.compositeArgs[p.compositeArgs.indexOf("-map") + 3]).toBe("2:a?");
  expect(p.compositeArgs.some(arg => arg.endsWith("processed.mkv"))).toBe(true);
  expect(p.result.composition.effects[0]).toEqual(effect);
  expect(p.archives.has("source-pixels.raw.json")).toBe(true); expect(p.archives.has("source-pixels-identity.json")).toBe(true);
});
it("真三维单效果只调用三维消费者，不把空二维层当成3D；保留原音轨", async () => {
  const effect = makeManhuaVfxEffect("bullet_time", "orbit"); effect.bullet = { ...effect.bullet!, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" };
  const p = await pipeline(effect);
  expect(p.calls).toEqual(["resolve-owned-scene", "manhua_vfx_bullet3d.py", "composite", "upload-result"]);
  expect(p.result.coordinateSpace).toBe("screen-and-world3d"); expect(p.archives.has("real3d-manifest.parsed.json")).toBe(true);
  expect(p.compositeArgs[p.compositeArgs.indexOf("-map") + 3]).toBe("0:a?");
  expect(p.compositeArgs.some(arg => arg.includes("scene-layers/frame-%06d.png"))).toBe(true);
});
it("原片像素处理失败时不合成、不上传候选；多输入合成映射正确原声", async () => {
  await expect(pipeline(makeManhuaVfxEffect("liquid_mirror", "pixel"), true)).rejects.toThrow("不会自动重做");
  const args = buildVfxCompositeArgs("processed.mkv", "layers", 24, "result.mp4", "original.mp4", "real3d");
  expect(args[args.indexOf("-map") + 3]).toBe("3:a?"); expect(args).toContain("[vfx2]");
});
it("三维回执拒绝相机不环绕、非透视、朝向错误及冻结几何变化", () => {
  const effect = makeManhuaVfxEffect("bullet_time", "orbit"); effect.bullet = { ...effect.bullet!, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" };
  const manifest = orbitManifest(effect); manifest.files = Array.from({ length: 24 }, (_, index) => ({ frame: index + 1, path: `frame-${String(index + 1).padStart(6, "0")}.png`, bytes: 1, sha256: "d".repeat(64) }));
  expect(() => validateVfxBullet3dManifest(manifest, { ...effect, sceneSha256: "a".repeat(64) }, meta)).not.toThrow();
  for (const change of [(m: typeof manifest) => { m.frames[1].camera.position[0] += 1; }, (m: typeof manifest) => { m.frames[1].camera.matrixWorld[2][2] += 1; }, (m: typeof manifest) => { m.frames[1].frozenGeometrySHA = "c".repeat(64); }, (m: typeof manifest) => { (m.frames[1].camera as {type:string}).type = "ORTHO"; }]) { const bad = structuredClone(manifest); change(bad); expect(() => validateVfxBullet3dManifest(bad, { ...effect, sceneSha256: "a".repeat(64) }, meta)).toThrow(); }
});

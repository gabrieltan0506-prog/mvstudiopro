import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
/** 无媒体验证：注入进程/存储，帧使用仓库既有PNG，不执行FFmpeg或Blender渲染。 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { makeManhuaVfxEffect } from "../../client/src/lib/manhuaVfxWorkflow";
import { renderManhuaVfx, buildVfxCompositeArgs, validateVfxBullet3dManifest, validateVfxWorldManifest } from "./manhuaVfxRender";
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
function shapeProof(effect: ManhuaVfxEffect, time: number) {
  if (effect.city) {
    const p = effect.city, q = Math.max(0, Math.min(1, (time - p.foldStartSec) / (p.foldEndSec - p.foldStartSec)));
    const angle = p.foldDeg * q * q * (3 - 2 * q), a = angle * Math.PI / 180;
    return { geometry: "procedural-street-hinged-world3d", meshCount: 6 + 2 * p.blocks, vertexCount: 1024, foldDeg: angle,
      hingeMatrix: [[1,0,0,0],[0,Math.cos(a),-Math.sin(a),18],[0,Math.sin(a),Math.cos(a),0],[0,0,0,1]],
      movingMatrixSha256: "c".repeat(64), camera: { type: "PERSP", lensMm: p.lensMm, position: [0,-9,3.2] } };
  }
  if (effect.prop) {
    const cup = (effect.world?.propKind || effect.kind) === "cup_fracture", p = effect.prop;
    const groups = Array.from({ length: cup ? 1 : 4 }, (_, group) => time >= p.impactSec + group * p.staggerSec).filter(Boolean).length;
    return { geometry: cup ? "closed-ceramic-and-handle" : "fruit-wedges-crates-petals-paper", fragmentCount: cup ? 116 : 216,
      explodedFragments: groups * (cup ? 116 : 54), visibleFragments: cup ? 76 + groups * 40 : 168 + groups * 12, poseSha256: "c".repeat(64), held: time >= p.holdStartSec && time < p.holdStartSec + p.holdDurationSec, ...(effect.world ? { sourceFrame: 1 + time * 24, actorPoseSha256: Math.round(time * 24).toString(16).padStart(64, "0"), cameraType: "PERSP" } : {}) };
  }
  return {};
}
async function pipeline(effect: ManhuaVfxEffect, failPixels = false) {
  const png = await readFile("client/public/pwa-icon-512.png"), archives = new Map<string, Buffer>(), calls: string[] = [];
  let compositeArgs: string[] = [];
  const request = { action: "manhua_vfx", scopeKey: "offline", requestId: "10090000-1234-4234-8234-123456789abc", params: { videoUri: "gs://test/source.mp4", sourceKey: "current", composition: { version: 1, seed: 42, effects: [effect] } } };
  const result = await renderManhuaVfx(request, "7", new AbortController().signal, {
    fetch: async (_uri, file) => { await writeFile(file, "source-byte-fixture"); return 19; },
    upload: async ({ objectName, buffer }) => { archives.set(path.basename(objectName), buffer); return { bucket: "test", objectName, gcsUri: `gs://test/${objectName}` }; },
    prepareScene: async (_params, id, _user, root) => { calls.push("resolve-owned-scene"); return { scenePath: path.join(root, "scenes", `scene-${id}.blend`), sceneSha256: "a".repeat(64), sceneActors: [], receipt: { fullMaterials: false, spec: createManhuaPrevisStudio(2).spec, gcsUri: "gs://test/scene.blend", contentType: "application/octet-stream", fileName: "scene.blend", sha256: "a".repeat(64), sourceRequestId: "request", sourceScopeId: "scope", sourceClipId: "clip", durationSec: 2, bytes: 1024 } }; },
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
      const specPath = (script.endsWith("manhua_vfx_bullet3d.py") || script.endsWith("manhua_vfx_world_props.py")) ? args.at(-3)! : args.at(-2)!;
      const raw = await readFile(specPath), spec = JSON.parse(raw.toString());
      const files = [];
      for (let frame = 1; frame <= 24; frame++) { const name = `frame-${String(frame).padStart(6, "0")}.png`; await writeFile(path.join(output, name), png); files.push({ frame, path: name, bytes: png.length, sha256: sha(png) }); }
      const manifest = script.endsWith("manhua_vfx_bullet3d.py") ? { ...orbitManifest(effect), files } : { complete: true, width: 512, height: 512, fps: 24, frameCount: 24, alpha: "straight", colorSpace: "sRGB", ...(effect.world ? { eventId: effect.id, sceneJobId: effect.world.sceneJobId, sceneSha256: "a".repeat(64), sourceFps: 24, sourceFrameStart: 1, sourceFrameEnd: 48, sourceVertices: 8, actorMeshes: ["test-only-rigged-mesh"] } : {}), files, frames: files.map((file, index) => ({ frame: file.frame, timeSec: index / 24, effects: spec.effects.map((item: ManhuaVfxEffect) => ({ id: item.id, kind: item.kind, active: true, progress: index / 24, opacity: .5, position: [.5, .5], ...shapeProof(item, index / 24) })) })) };
      await writeFile(path.join(output, "input.raw.json"), raw); await writeFile(path.join(output, "spec.normalized.json"), raw); await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest)); return "renderer fixture";
    },
    runMedia: async (command, args) => { if (command === "ffprobe") return { stdout: probe(!args.at(-1)!.endsWith("processed.mkv")), stderr: "" }; compositeArgs = args; calls.push("composite"); await writeFile(args.at(-1)!, "result-byte-fixture"); return { stdout: "", stderr: "" }; },
    uploadResult: async () => { calls.push("upload-result"); return { gcsUri: "gs://test/result.mp4", url: "https://example.invalid/result.mp4", bytes: 19 }; },
  });
  return { result, calls, archives, compositeArgs };
}
it.each(["mirror_corridor", "floating_paper", "liquid_mirror", "motion_ghost", "bullet_wave"] as const)("%s进入实际像素处理调用后合成，原声映射原始文件", async kind => {
  const effect = makeManhuaVfxEffect(kind, "pixel"); const p = await pipeline(effect);
  expect(p.calls).toEqual(["manhua_vfx_liquid_ghost.py", "manhua_vfx.py", "composite", "upload-result"]);
  expect(p.compositeArgs[p.compositeArgs.indexOf("-map") + 3]).toBe("2:a?");
  expect(p.compositeArgs.some(arg => arg.endsWith("processed.mkv"))).toBe(true);
  expect(p.result.composition.effects[0]).toEqual(effect);
  expect(p.archives.has("source-pixels.raw.json")).toBe(true); expect(p.archives.has("source-pixels-identity.json")).toBe(true);
});
it.each(["mirror_corridor", "floating_paper"] as const)("%s像素处理失败时保留错误证据，不上传或自动重做候选", async kind => {
  await expect(pipeline(makeManhuaVfxEffect(kind, "dream"), true)).rejects.toThrow("不会自动重做");
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

it.each(["cup_fracture", "fruit_stall_fracture", "city_fold", "prop_scene"] as const)("%s经既有服务端渲染链消费，保留原音轨和实际参数", async kind => {
  const effect = { ...makeManhuaVfxEffect(kind, "scene"), durationSec: 1 };
  if (effect.city) effect.city = { ...effect.city, foldStartSec: .1, foldEndSec: .8 };
  if (effect.prop) effect.prop = { ...effect.prop, holdStartSec: .7, holdDurationSec: .2 };
  if (effect.world) effect.world = { ...effect.world, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" };
  const result = await pipeline(effect);
  expect(result.calls).toEqual(effect.world ? ["resolve-owned-scene", "manhua_vfx_world_props.py", "composite", "upload-result"] : ["manhua_vfx.py", "composite", "upload-result"]);
  expect(result.result.composition.effects[0]).toEqual(effect);
  expect(result.compositeArgs[result.compositeArgs.indexOf("-map") + 3]).toBe("0:a?");
  expect(result.archives.has(kind === "city_fold" ? "city3d-manifest.parsed.json" : kind === "prop_scene" ? "world3d-manifest.parsed.json" : "renderer-manifest.parsed.json")).toBe(true);
  expect(result.result.coordinateSpace).toBe(kind === "city_fold" || kind === "prop_scene" ? "screen-and-world3d" : "screen");
});


it("选择性定格回执拒绝人物静止、碎片漂移、源动画变速与身份错配", async () => {
  const effect = { ...makeManhuaVfxEffect("prop_scene", "world"), durationSec: 1 };
  effect.world = { ...effect.world!, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" };
  effect.prop = { ...effect.prop!, holdStartSec: .7, holdDurationSec: .2 };
  const result = await pipeline(effect);
  const manifest = JSON.parse(result.archives.get("world3d-manifest.parsed.json")!.toString());
  const request = { ...effect, sceneSha256: "a".repeat(64) };
  expect(() => validateVfxWorldManifest(manifest, request, meta)).not.toThrow();
  const changes = [
    (m: typeof manifest) => { for (const frame of m.frames) if (frame.effects[0].held) frame.effects[0].actorPoseSha256 = "d".repeat(64); },
    (m: typeof manifest) => { m.frames.find((row: any) => row.effects[0].held).effects[0].poseSha256 = "e".repeat(64); },
    (m: typeof manifest) => { m.frames[2].effects[0].sourceFrame += 1; },
    (m: typeof manifest) => { m.sceneSha256 = "f".repeat(64); },
    (m: typeof manifest) => { m.frames[3].effects[0].cameraType = "ORTHO"; },
  ];
  for (const change of changes) { const bad = structuredClone(manifest); change(bad); expect(() => validateVfxWorldManifest(bad, request, meta)).toThrow(); }
});

it("新场景证据必须逐角色、逐活动帧验证净空/受光，不能用其他角色动作代替", async () => {
  const effect = { ...makeManhuaVfxEffect("prop_scene", "world"), durationSec: 1 };
  effect.world = { ...effect.world!, sceneJobId: `prv_${"a".repeat(48)}`, sceneScopeId: "10090000-1234-4234-8234-123456789abc", clipId: "clip" };
  effect.prop = { ...effect.prop!, holdStartSec: .7, holdDurationSec: .2 };
  const result = await pipeline(effect), manifest = JSON.parse(result.archives.get("world3d-manifest.parsed.json")!.toString());
  const actors = ["human", "horse"].map((shape, index) => ({ actorId: `actor-${index}`, nameZh: `测试角色${index}`, shape: shape as "human" | "horse", rigKind: (index ? "quadruped" : "human") as "human" | "quadruped", rigName: `actor-${index}`, binding: "source" as const }));
  const render = { quality: "beauty" as const, samples: 32, exposure: 0, keyEnergy: 1000, fillRatio: .35, exportLayers: false };
  const request = { ...effect, sceneSha256: "a".repeat(64), sceneActors: actors, world: { ...effect.world!, render,
    choreography: { clearanceMeters: .08, routes: [{ actorId: "actor-1", points: [{ timeSec: 0, position: [0, 0] as [number, number], facingDeg: 0 }, { timeSec: 47 / 24, position: [1, 0] as [number, number], facingDeg: 0 }] }] } } };
  manifest.sceneActors = actors; manifest.lighting = { ...render, engine: "CYCLES", materialMode: "source-pbr-and-physical-fragments" };
  for (const frame of manifest.frames) {
    frame.effects[0].worldPropSha256 = "d".repeat(64);
    frame.effects[0].clearance = { method: "evaluated-closed-component-aabb-conservative", requiredMeters: .08, issues: [],
      actors: actors.map(actor => ({ actorId: actor.actorId, shape: actor.shape, rigKind: actor.rigKind, visible: true, vertices: 100,
        poseSha256: frame.frame.toString(16).padStart(64, "0"), minimumGapMeters: .1 })),
      actorPairs: [{ actorId: "actor-0", otherActorId: "actor-1", gapMeters: .1 }] };
  }
  expect(() => validateVfxWorldManifest(manifest, request, meta)).not.toThrow();
  const edits = [
    (m: typeof manifest) => { m.sceneActors[1].shape = "human"; },
    (m: typeof manifest) => { m.lighting.engine = "BLENDER_EEVEE"; },
    (m: typeof manifest) => { m.frames[0].effects[0].clearance.actors[1].minimumGapMeters = .01; },
    (m: typeof manifest) => { m.frames[1].effects[0].clearance.actorPairs = []; },
    (m: typeof manifest) => { m.frames[1].effects[0].clearance.actorPairs[0].gapMeters = .01; },
    (m: typeof manifest) => { m.frames[2].effects[0].clearance.actors[1].actorId = "actor-0"; },
    (m: typeof manifest) => { m.frames.find((row: any) => row.effects[0].held).effects[0].worldPropSha256 = "e".repeat(64); },
    (m: typeof manifest) => { for (const row of m.frames) row.effects[0].clearance.actors[1].poseSha256 = "f".repeat(64); },
  ];
  for (const edit of edits) { const bad = structuredClone(manifest); edit(bad); expect(() => validateVfxWorldManifest(bad, request, meta)).toThrow(); }
});

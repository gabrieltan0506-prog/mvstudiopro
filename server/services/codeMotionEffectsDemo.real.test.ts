/** Explicitly authorized 22-second demo. Real compiler/renderer; local storage adapter, no cloud/model. */
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const assetRoot = path.resolve(process.env.INK_EFFECTS_DEMO_ASSETS || "../photo-motion-skill-delivery/v2-share/photo-motion-video-v2.1-demo");
const outputRoot = path.resolve(process.env.INK_EFFECTS_DEMO_OUTPUT || "../ink-effects-workbench-demo");
const sources = new Map<string, string>();
const receipts = new Map<string, Buffer>();
vi.mock("./postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: async ({ source }: { source: string }) => {
    if (!sources.has(source)) throw Error("Unregistered local demo source");
    return source;
  },
}));
vi.mock("./artMotionEvidenceStore", () => ({
  persistArtMotionEvidence: async (_user: string, _request: string, name: string, bytes: Buffer) => {
    const file = path.basename(name);
    receipts.set(file, Buffer.from(bytes));
    await writeFile(path.join(outputRoot, "evidence", file), bytes);
    return { gcsUri: `gs://local-demo/evidence/${file}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  },
}));
vi.mock("./postProduction", async original => ({
  ...(await original<typeof import("./postProduction")>()),
  fetchPostProdSourceToFile: async (source: string, destination: string) => {
    const file = sources.get(source);
    if (!file) throw Error("Demo forbids network or unregistered sources");
    await writeFile(destination, await readFile(file));
  },
  uploadResult: async ({ filePath }: { filePath: string }) => {
    await writeFile(path.join(outputRoot, "ink-effects-22s.mp4"), await readFile(filePath));
    return { gcsUri: "gs://local-demo/ink-effects-22s.mp4", url: "https://local-demo.invalid/ink-effects-22s.mp4" };
  },
}));
import { codeMotionProjectSchema, compileCodeMotion } from "../../shared/codeMotion";
import { applyCodeMotionEffect, type CodeMotionEffect } from "../../shared/codeMotionEffects";
import { renderArtMotion } from "./artMotionRender";

it.skipIf(!process.env.INK_EFFECTS_DEMO_PREPARE && !process.env.INK_EFFECTS_DEMO_RENDER)("authorized 22s effects demo through formal compiler and renderer", async () => {
  await mkdir(path.join(outputRoot, "evidence"), { recursive: true });
  const userId = "12", projectId = "de101100-1234-4234-8234-123456789abc";
  const sourceRecords = [];
  const images = [];
  const selectedImages = [["29", "雪山"], ["16", "海岸漂流木"], ["10", "森林远水"]];
  for (let index = 0; index < selectedImages.length; index++) {
    const [file, name] = selectedImages[index];
    const local = path.join(assetRoot, "media", `${file}.jpg`), bytes = await readFile(local);
    const gcsUri = `gs://local-demo/images/${file}.jpg`;
    sources.set(gcsUri, local);
    images.push({ id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`, name, gcsUri });
    sourceRecords.push({ local, gcsUri, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const audioPath = path.join(assetRoot, "audio", "window-v2.wav"), audioBytes = await readFile(audioPath);
  const audioSha = createHash("sha256").update(audioBytes).digest("hex"), audioId = "33333333-3333-4333-8333-333333333333";
  const audioUri = `gs://local-demo/post-prod/${userId}/code-motion/${projectId}/audio/${audioId}/${audioSha}.wav`;
  sources.set(audioUri, audioPath);
  sourceRecords.push({ local: audioPath, gcsUri: audioUri, bytes: audioBytes.length, sha256: audioSha });
  const durations = [4, 4, 4, 6, 4], headings = ["一张图，也能成片", "同一眼，看见不同", "把片刻叠成故事", "形状，可以流动", "映客 INK"];
  let project = codeMotionProjectSchema.parse({
    id: projectId,
    brief: { title: "映客 · 图片与空间", request: "原雪山、海岸漂流木、森林远水与原BGM：揭示、三栏、纸页、程序点云及品牌结尾", style: "scenes", duration: 22, orientation: "portrait", generationTier: "free", images,
      audios: [{ id: audioId, name: "已保留原BGM", gcsUri: audioUri, duration: 22, mimeType: "audio/wav", sha256: audioSha, bytes: audioBytes.length }] },
    plan: { version: 1, summary: "五镜22秒，原素材配新工作台配方，无模型生成", scenes: durations.map((duration, i) => ({
      heading: headings[i], body: "", duration, direction: ["雪山局部揭示", "三图同屏与素材名注记", "原图纸页依次叠入", "三维粒子形变及环绕镜头", "品牌落版"][i],
      composition: { id: `demo-${i}`, duration, background: "#102326", elements: [
        ...(i < 3 ? [{ id: `photo-${i}`, type: "image", imageId: images[i].id, width: i === 0 ? 0.9 : 1, height: i === 0 ? 0.55 : 1, fit: "cover", transform: { x: 0.5, y: 0.52, opacity: i === 0 ? 1 : 0.2 } }] : []),
        { id: `heading-${i}`, type: "text", text: headings[i], fontSize: i === 4 ? 0.14 : 0.065, maxWidth: 0.9, layer: 60, transform: { x: 0.5, y: i === 4 ? 0.42 : 0.14, fill: "#f4f1e8" }, keyframes: [{ at: 0, opacity: 0, y: i === 4 ? 0.46 : 0.17 }, { at: 0.45, opacity: 1, y: i === 4 ? 0.42 : 0.14 }] },
        ...(i === 4 ? [{ id: "closing-note", type: "text", text: "用照片、声音与代码，写下你的故事", fontSize: 0.034, maxWidth: 0.86, layer: 60, transform: { x: 0.5, y: 0.54, fill: "#b8cfcc" } }] : []),
      ] },
    })), audioTimeline: [{ sourceId: audioId, role: "bgm", at: 0, trimStart: 0, duration: 22, volume: 1, fadeIn: 0, fadeOut: 0 }] },
  });
  const recipes: CodeMotionEffect[] = ["imageReveal", "columnAnnotations", "paperStack", "pointMorph3d"];
  for (let index = 0; index < recipes.length; index++) {
    const selected = { ...project, plan: { ...project.plan!, scenes: [project.plan!.scenes[index]] } };
    const applied = applyCodeMotionEffect(selected, recipes[index]);
    project = { ...project, plan: { ...project.plan!, scenes: project.plan!.scenes.map((scene, i) => i === index ? applied.plan!.scenes[0] : scene) } };
  }
  project = codeMotionProjectSchema.parse(project);
  const spec = compileCodeMotion(project.brief, project.plan);
  const request = { action: "art_motion", requestId: "de101100-1234-4234-8234-123456789abd", scopeKey: `code-motion:${projectId}`, params: spec };
  await writeFile(path.join(outputRoot, "project.json"), JSON.stringify(project, null, 2));
  await writeFile(path.join(outputRoot, "request.json"), JSON.stringify(request, null, 2));
  await writeFile(path.join(outputRoot, "sources.json"), JSON.stringify(sourceRecords, null, 2));
  await writeFile(path.join(outputRoot, "boundary.json"), JSON.stringify({ officialCompiler: "compileCodeMotion", officialRenderer: "renderArtMotion", recipes, localStorageAdapter: true, onlineAcceptance: false, modelCalls: 0, originalDemoModified: false }, null, 2));
  expect(spec.duration).toBe(22);
  expect(spec.composition!.scenes).toHaveLength(5);
  if (!process.env.INK_EFFECTS_DEMO_RENDER) return;
  const result = await renderArtMotion(request, userId, new AbortController().signal);
  expect(result.frameCount).toBe(660);
  const probe = JSON.parse(receipts.get("probe.parsed.json")!.toString());
  expect(probe.streams.filter((stream: { codec_type: string }) => stream.codec_type === "audio")).toHaveLength(1);
  await writeFile(path.join(outputRoot, "result.json"), JSON.stringify(result, null, 2));
}, 600_000);

/** Preparation only. Reuses production parsers/builders/store contracts, with no provider or media submission. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { codeMotionProjectSchema, compileCodeMotion } from "../shared/codeMotion";
import { codeMotionImagePrompts, codeMotionImagePolicy } from "../shared/codeMotionImageProduction";
import { planInkGeneratedShot } from "../shared/inkVideoProductionPolicy";
import { codeMotionSoundRequestSchema, CODE_MOTION_VOICES } from "../shared/codeMotionMedia";
import { compileCanvasDialogueInput } from "../shared/canvasDialogueControls";
import { CANVAS_BGM_CREDITS_PER_RUN, canvasVideoClipCredits } from "../shared/canvasGenerationPricing";
import { buildQwenDialogueTtsRequestBody } from "../server/services/qwenDialogueTts";
import { buildEvolinkSeedanceRequest } from "../server/services/evolinkSeedanceVideo";
import { planCodeMotionProductionVideo } from "../server/services/codeMotionProductionVideo";
import { buildScoringRoomBrief } from "../server/services/manhuaScoringRoom";
import { loadCodeMotion, saveCodeMotion, type CodeMotionStoreDeps } from "../server/services/codeMotionStore";

if (process.argv.some(arg => /--(execute|submit|generate|live)/.test(arg))) {
  throw new Error("This is a preparation-only probe. It cannot call providers or authorize spending.");
}
const dir = path.resolve(process.argv[2] || "../pr1697-ruixin-probe");
await mkdir(dir, { recursive: true });
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sources = new Map<string, { body: Buffer; generation: string }>();
const memoryStore: CodeMotionStoreDeps = {
  async read(name) { return sources.get(name) ?? null; },
  async write(name, body, expected) {
    const old = sources.get(name);
    assert.equal(old?.generation ?? "0", expected, "production CAS expected generation");
    const generation = String(Number(expected) + 1);
    sources.set(name, { body, generation });
    return generation;
  },
  async list(prefix) { return Array.from(sources.keys()).filter(name => name.startsWith(prefix)); },
};
const summary: Record<string, unknown> = {
  classification: "PREPARATION_ONLY: production contracts with isolated in-memory persistence; no generation, render, provider, actual account or online acceptance",
  checkedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  providerCalls: 0,
  mediaRenders: 0,
  budgetApproved: false,
};
for (const tier of ["free", "paid"] as const) {
  const raw = await readFile(path.join(dir, `${tier}.project.json`), "utf8");
  const project = codeMotionProjectSchema.parse(JSON.parse(raw));
  assert.equal(project.brief.duration, 30);
  assert.equal(project.plan?.scenes.length, 6);
  assert.equal(project.brief.images.length, 0, "Pending media must not be represented as real assets");
  assert.equal(project.brief.audios?.length, 0);
  const saved = await saveCodeMotion("1697", project, "0", memoryStore);
  const restored = await loadCodeMotion("1697", project.id, memoryStore);
  assert.deepEqual(restored?.project, saved.project);
  const draft = compileCodeMotion(restored!.project.brief, restored!.project.plan, {
    allowPendingSpeech: true, allowPendingProduction: true,
  });
  assert.throws(() => compileCodeMotion(project.brief, project.plan), /尚未/);
  const shots = planCodeMotionProductionVideo(project, tier);
  assert.deepEqual(shots.map(s => [s.sceneIndex, s.at, s.duration]), [[2, 10, 5], [3, 15, 5]]);
  assert(shots.every(s => s.missing.length > 0), "Real submission must remain blocked until sources exist");
  const imageRequests = codeMotionImagePrompts(project).map(row => ({ ...row, ...codeMotionImagePolicy(tier, row.index) }));
  assert.equal(imageRequests.length, 6);
  const sounds = (JSON.parse(await readFile(path.join(dir, `${tier}.sound-requests.json`), "utf8")) as unknown[])
    .map(r => codeMotionSoundRequestSchema.parse(r));
  const qwen = sounds.filter(r => r.kind === "speech").map(r => {
    assert.equal(r.kind, "speech");
    return { sceneIndex: r.sceneIndex, requestId: r.requestId,
      body: buildQwenDialogueTtsRequestBody({
        input: compileCanvasDialogueInput(r.text, r.emotion || ""),
        voice: CODE_MOTION_VOICES[r.voice], seed: 0,
      }),
    };
  });
  assert.equal(qwen.length, 5);
  assert(!qwen.some(r => r.sceneIndex === 2), "Sip performance keeps narration silence");
  const bgmRequest = sounds.find(r => r.kind === "bgm");
  assert(bgmRequest && bgmRequest.kind === "bgm");
  const bgm = buildScoringRoomBrief({ model: "suno-v6", laneZh: "映客代码视频", durationSec: 30,
    moods: ["蓄力", "冲突", "收束"], titleZh: project.brief.title,
    styleAnchorZh: bgmRequest.direction, endingZh: "最后两秒渐弱淡出" });
  // Explicitly unresolved bindings are builder-only sentinels. They are never adopted or submitted.
  const nativeVideo = shots.map(shot => {
    const policy = planInkGeneratedShot({ tier, duration: shot.duration, imageCount: 1, videoCount: 0, audioCount: 1 });
    const built = buildEvolinkSeedanceRequest({ prompt: shot.prompt, version: policy.version,
      mode: policy.mode, duration: 5, quality: policy.resolution, aspectRatio: "9:16",
      imageUrls: [`https://probe.invalid/UNRESOLVED/${tier}/scene-${shot.sceneIndex + 1}.png`],
      audioUrls: [`https://probe.invalid/UNRESOLVED/${tier}/mix-${shot.at}-${shot.at + 5}.wav`],
      generateAudio: true, contentFilter: true });
    assert.equal(built.mode, "reference_to_video");
    assert.equal(built.body.quality, tier === "free" ? "480p" : "720p");
    return { sceneIndex: shot.sceneIndex, at: shot.at, unresolvedBindings: true, ...built };
  });
  const qwenCharactersIncludingControls = qwen.reduce((n, r) => n + [...r.body.input].length, 0);
  const output = { projectId: project.id, projectSha256: sha(raw), schema: "PASS", saveRestore: "PASS",
    draftCompile: "PASS", strictExportBlockedWithoutSources: true, images: imageRequests, qwen, bgm,
    nativeVideo, pending: shots.map(s => ({ sceneIndex: s.sceneIndex, missing: s.missing })),
    retail: { tier, imageCredits: imageRequests.reduce((n, r) => n + r.credits, 0),
      videoCredits: tier === "free" ? 0 : shots.reduce((n, s) => n + canvasVideoClipCredits({ durationSec: s.duration, resolution: s.resolution, videoModel: s.model }), 0),
      bgmInternalCredits: tier === "free" ? 0 : CANVAS_BGM_CREDITS_PER_RUN,
      speechCredits: tier === "free" ? "sponsored only if real grant passes" : "2 * sum(ceil(actual duration seconds * 5))",
      notProviderCost: true },
    upstreamCostKnownPart: { qwenCharactersIncludingControls, qwenUsdAt20PerMillionCharacters: qwenCharactersIncludingControls * 20 / 1e6,
      note: "Character counting is an estimate including controls; provider receipt decides actual billing. Total remains unknown." },
  };
  await writeFile(path.join(dir, `${tier}.normalized.project.json`), JSON.stringify(saved.project, null, 2) + "\n");
  await writeFile(path.join(dir, `${tier}.requests.review.json`), JSON.stringify(output, null, 2) + "\n");
  summary[tier] = { projectSha256: output.projectSha256, schema: output.schema, saveRestore: output.saveRestore,
    draftCompile: output.draftCompile, generatedAssets: 0, imageRequests: 6, videoRequests: 2, speechRequests: 5, bgmRequests: 1,
    providerReady: false, retail: output.retail, draftSpecHash: sha(JSON.stringify(draft)), qwenCharactersIncludingControls };
}
await writeFile(path.join(dir, "preflight-result.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));

/**
 * MV 高光正式全流程探针（1109）· 工作机隔离目录运行，凭证只在 Fly 进程内存：
 *   FLY_PROCESS_GROUP=rig ./node_modules/.bin/tsx scripts/with-worker-probe-lease.mts ./node_modules/.bin/tsx probes/mv-formal-1109.mts <runId> [projectPrefix]
 * 每步落 GCS 检查点 probes/mv-formal/<runId>/checkpoints/，续跑不重做已完成步骤；所有模型请求/原始/解析 JSON 永久保存。
 *
 * 1. 读作品高光区间与镜头；下载原歌一次。
 * 2. audiomap（唯一节拍分析）→ 高光内非演唱剪点按节奏模式吸附拍点（演唱镜不动）。
 * 3. 本段歌词自动识别（Gemini 两跳 Vertex→EvoLink）→ 待确认版（演唱镜若有，以此为准并标「未经用户确认」）。
 * 4. 顾问逐窗节拍阶段（同一三跳链）→ 每镜逐窗、接龙、复杂度。
 * 5. 主锚图 = 生成的主角定妆帧（canvas_gpt_image2 同参：Sunburst / 资产线 / 禁字）。
 * 6. 每镜 Pexels 场景图 2 + 运镜参考片 1（复杂镜头必填）；歌曲切片。
 * 7. Mini 480p reference_to_video（探针档），按依赖顺序提交：接龙镜等上一镜出片后取尾帧作 @图片2。
 * 8. 正式合成 runManhuaAssembleFinal（musicOnly + mvClipFit 实测适配 + 环境层 −20 dB）；不合格段只重做该段一次。
 * 9. 断言：时长和=45s±1帧、剪点落拍、成片主轨=原歌切片、演唱镜落位≤1帧（若有）；阻断项清单。
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadGcsObject, getGcsBucketName, listGcsObjectNamesByPrefix, signGsUriV4ReadUrl, uploadBufferToGcs } from "../server/services/gcs";
import { searchPexels } from "../server/services/stockFootage/pexelsClient";
import { adoptStockFootage } from "../server/services/stockFootage/adoption";
import { suggestStockKeywordsByRules } from "../shared/stockFootageKeywords";
import { assembleMvShotReferences, mvAnchorKeyframePrompt, mvShotReferenceLimits, type MvShotReferences } from "../shared/canvasMusicMvReferences";
import { trimMvMotionClip } from "../server/services/mvMotionClipTrim";
import { compileMvShotTimedPrompt, mvShotGenerateDurationSec } from "../shared/canvasMusicMvShotPrompt";
import { tryCompileManhuaVideoPromptForOutbound } from "../shared/manhuaOutboundPrompt";
import { musicMvShotSlices, recommendMusicMvHighlight } from "../shared/musicMvHighlight";
import { buildManhuaAssembleJobInput } from "../shared/manhuaAssembleJobInput";
import { runManhuaAssembleFinal } from "../server/services/manhuaAssembleFinalService";
import { buildEvolinkSeedanceRequest, pollEvolinkVideoTaskOnce, submitEvolinkSeedanceVideo } from "../server/services/evolinkSeedanceVideo";
import { computeSongBeatGrid } from "../server/services/musicMvBeatGrid";
import { snapShotCutsToBeats, beatsInRange, musicMvSingingPlacement } from "../shared/canvasMusicMvBeats";
import { estimateEnvelopeLagSec } from "../shared/canvasMusicMvClipFit";
import { composeMusicMvShotBeats } from "../server/services/musicMvShotBeats";
import { composeCreativeAtHop } from "../server/services/musicMvAdvisor";
import { CREATIVE_LLM_HOPS } from "../server/services/creativeLlmHops";
import { generateGptImage2FromRawEnglishPrompt } from "../server/services/proxyImageService";
import { markChantFrom, partitionShotsByLyricKind, planMvHighlightFades, withSuggestedLyricKinds } from "../shared/canvasMusicMvLyricKinds";
import { composeMusicMvFillPlan } from "../server/services/musicMvFillPlan";
import { buildMvFillShot } from "../server/services/mvFillShot";
import { canvasMusicMvPlanSchema, musicMvPacingAt, mvShotNeedsStagingReference, type CanvasMusicMvPlan, type MusicMvBeatGrid, type MusicMvLyricTable } from "../shared/canvasMusicMv";

const run = promisify(execFile);
const BUCKET = "mv-studio-pro-vertex-video-temp";
const PROBE_USER = 999999001;
const ENGINE = "seedance-2.0-mini" as const;
const FRAME = 1 / 30;
const [runId, projectPrefix = "d31a3a49", reuseRunId, lyricsRunId, chantFromArg] = process.argv.slice(2);
/** 用户口径（1109）：本曲从 36.0 秒起几乎全是吟唱；跨该秒的句子切开。 */
const CHANT_FROM_SEC = chantFromArg ? Number(chantFromArg) : undefined;
if (!runId || !/^[a-z0-9-]{6,80}$/.test(runId)) throw Error("缺少 runId");
const base = `probes/mv-formal/${runId}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function putJson(name: string, value: unknown) {
  const buffer = Buffer.from(JSON.stringify(value, null, 2));
  await uploadBufferToGcs({ bucket: BUCKET, objectName: `${base}/${name}`, buffer, contentType: "application/json" });
}
async function getJson<T>(name: string): Promise<T | null> {
  try { return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${base}/${name}` })).buffer.toString("utf8")) as T; } catch { return null; }
}
const status = (await getJson<{ done: string[] }>("checkpoints/status.json")) || { done: [] as string[] };
async function mark(step: string) {
  if (!status.done.includes(step)) status.done.push(step);
  await putJson("checkpoints/status.json", { ...status, updatedAt: new Date().toISOString() });
  log("checkpoint", step);
}
/** 续跑：作品与定妆帧可复用前一轮检查点（不重复付费）；高光改了，audiomap 吸附、逐窗节拍、参考与生成本轮重做。 */
const REUSABLE = new Set(["01-project", "05-anchor"]);
async function cached<T>(name: string, make: () => Promise<T>): Promise<T> {
  const hit = await getJson<T>(`checkpoints/${name}.json`);
  if (hit) return hit;
  if (reuseRunId && REUSABLE.has(name)) {
    try {
      const prev = JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/probes/mv-formal/${reuseRunId}/checkpoints/${name}.json` })).buffer.toString("utf8")) as T;
      await putJson(`checkpoints/${name}.json`, prev);
      await mark(`${name}（复用 ${reuseRunId}）`);
      return prev;
    } catch { /* 前一轮没有该检查点：本轮重做 */ }
  }
  const value = await make();
  await putJson(`checkpoints/${name}.json`, value);
  await mark(name);
  return value;
}
async function ffprobe(file: string) {
  return JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,duration", "-of", "json", file])).stdout) as {
    format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
}
const work = await mkdtemp(path.join(tmpdir(), "mvformal-"));

// ── 1. 作品 ──────────────────────────────────────────────────────
type Step1 = { owner: number; projectId: string; aspect: "9:16" | "16:9"; highlight: { startSec: number; endSec: number }; audio: { id: string; gcsUri?: string; url: string; durationSec: number }; plan: CanvasMusicMvPlan; creativePrompt: string; lyrics: string; planRequestId: string };
const s1 = await cached<Step1>("01-project", async () => {
  const index = await listGcsObjectNamesByPrefix({ prefix: "manhua-project-index/", allPages: true });
  const hit = index.find(n => path.basename(n).startsWith(projectPrefix));
  if (!hit) throw Error(`找不到作品 ${projectPrefix}`);
  const owner = Number(/user-(\d+)\//.exec(hit)?.[1]);
  const projectId = path.basename(hit, ".json");
  const { readManhuaCloudDraftFromGcs } = await import("../server/services/manhuaCloudDraftGcsStore");
  const draft = await readManhuaCloudDraftFromGcs(owner, projectId);
  const music = ((draft!.payload as any).canvas?.blocks || []).find((b: any) => b?.kind === "music" && b?.musicMv?.plan);
  const mv = music.musicMv;
  if (mv.deliveryMode !== "highlight" || !mv.highlight) throw Error("该作品不是高光交付");
  const audio = mv.candidates.find((c: any) => c.id === mv.selectedCandidateId);
  return { owner, projectId, aspect: "9:16", highlight: mv.highlight, audio: { id: audio.id, gcsUri: audio.gcsUri, url: audio.url, durationSec: audio.durationSec }, plan: canvasMusicMvPlanSchema.parse(mv.plan), creativePrompt: mv.creativePrompt || "", lyrics: mv.lyrics || "", planRequestId: mv.planRequestId };
});
// 1109 用户拍板：高光只取有歌词的部分——整首歌词识别（待确认版）+ 推荐高光（probes/mv-lyrics-highlight-1109.mts 先产出 00 检查点）
let s0 = await getJson<{ table: MusicMvLyricTable; recommendation: { startSec: number; endSec: number; lineCount: number; reasonZh: string } }>("checkpoints/00-lyrics-highlight.json");
if (!s0 && lyricsRunId) {
  s0 = JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/probes/mv-formal/${lyricsRunId}/checkpoints/00-lyrics-highlight.json` })).buffer.toString("utf8"));
  // 推荐规则改为对外 0.1 秒精度后重算（同一份歌词表，不重新识别）
  const grid0 = await computeSongBeatGrid((await downloadGcsObject({ gcsUri: s1.audio.gcsUri! })).buffer, s1.creativePrompt);
  s0!.recommendation = recommendMusicMvHighlight(s0!.table.lines, s1.audio.durationSec, grid0.segments || [])!;
  await putJson("checkpoints/00-lyrics-highlight.json", { ...s0, copiedFrom: lyricsRunId });
}
if (!s0?.recommendation) throw Error("缺少整首歌词与推荐高光（00 检查点）");
s1.highlight = { startSec: s0.recommendation.startSec, endSec: s0.recommendation.endSec };
// 句类型：先给建议，再按用户口径从 CHANT_FROM_SEC 起全部为吟唱（待确认版，未经用户确认）
s0.table = { ...s0.table, lines: CHANT_FROM_SEC !== undefined ? markChantFrom(withSuggestedLyricKinds(s0.table.lines), CHANT_FROM_SEC) : withSuggestedLyricKinds(s0.table.lines) };
const songBuf = s1.audio.gcsUri ? (await downloadGcsObject({ gcsUri: s1.audio.gcsUri })).buffer : Buffer.from(await (await fetch(s1.audio.url)).arrayBuffer());
const songFile = path.join(work, "song");
await writeFile(songFile, songBuf);
log("highlight", s1.highlight, "song", s1.audio.durationSec, "sha", sha(songBuf).slice(0, 12));

// ── 2. audiomap + 剪点吸附（只动高光内非演唱剪点） ─────────────────
type Step2 = { grid: MusicMvBeatGrid & { strongBeatsSec: number[] }; plan: CanvasMusicMvPlan; snapFixes: unknown[]; before: Array<[string, number, number]>; designatedSinging: string[] };
const s2 = await cached<Step2>("02-audiomap", async () => {
  const grid = await computeSongBeatGrid(songBuf, s1.creativePrompt);
  // 按句类型分工（与生产 reviseForLyrics 同函数）：真歌词 → 演唱段；吟唱 → 素材填充段；跨吟唱起点的镜切开
  const parted = partitionShotsByLyricKind(s1.plan.shots, s0.table.lines, s1.highlight);
  s1.plan = canvasMusicMvPlanSchema.parse({ ...s1.plan, shots: parted.shots });
  const designated = parted.changes.map(c => `${c.id}：${c.detailZh}`);
  const inRange = s1.plan.shots.filter(s => s.endSec > s1.highlight.startSec && s.startSec < s1.highlight.endSec);
  const snapped = snapShotCutsToBeats(inRange, grid, 0.5);
  const map = new Map(snapped.shots.map(s => [s.id, s]));
  const plan = canvasMusicMvPlanSchema.parse({ ...s1.plan, beatGrid: (({ strongBeatsSec: _s, ...m }) => m)(grid), shots: s1.plan.shots.map(s => map.get(s.id) ?? s) });
  return { grid, plan, snapFixes: snapped.fixes, before: inRange.map(s => [s.id, s.startSec, s.endSec] as [string, number, number]), designatedSinging: designated };
});
const rows = musicMvShotSlices(s2.plan, s1.highlight);
const genRows = rows.filter(r => r.shot.kind !== "footage" && !r.shot.fillRequested);
const fillRows = rows.filter(r => r.shot.kind !== "footage" && r.shot.fillRequested);
log("bpm", s2.grid.bpm, "conf", s2.grid.beatConfidence, "shots", rows.map(r => `${r.shot.id}[${r.shot.kind}] ${r.shot.startSec}-${r.shot.endSec}`));

// ── 3. 歌词表（整首，待确认版，来自 00 检查点） ───────────────────
const lyricTable = s0.table;
log("lyrics", lyricTable.recognizedBy, lyricTable.lines.length, "highlight", s1.highlight, s0.recommendation.reasonZh);

// ── 4. 逐窗节拍（顾问第三阶段） ───────────────────────────────────
type Step4 = { plan: CanvasMusicMvPlan; failedShotIds: string[]; failuresZh: string[] };
const s4 = await cached<Step4>("04-beats", async () => {
  const out = await composeMusicMvShotBeats(
    { plan: s2.plan, shotIds: genRows.map(r => r.shot.id), beatGrid: s2.grid, lyrics: s1.lyrics, creativePrompt: s1.creativePrompt, lyricLines: lyricTable.lines.length ? { source: "unconfirmed", lines: lyricTable.lines } : undefined },
    { hops: CREATIVE_LLM_HOPS, compose: composeCreativeAtHop, save: async (name, value) => putJson(`advisor/${name}.json`, value) },
  );
  return { plan: canvasMusicMvPlanSchema.parse(out.plan), failedShotIds: out.failedShotIds, failuresZh: out.failuresZh };
});
if (s4.failedShotIds.length) throw Error(`逐窗节拍未出：${s4.failedShotIds.join(",")}；${s4.failuresZh.join("；")}`);
// ── 4b. 吟唱镜素材填充建议（顾问同一三跳链） ─────────────────────
type Step4b = { plan: CanvasMusicMvPlan; failuresZh: string[] };
const s4b = await cached<Step4b>("04b-fill", async () => {
  const out = await composeMusicMvFillPlan(
    { plan: s4.plan, shotIds: fillRows.map(r => r.shot.id), beatGrid: s2.grid, creativePrompt: s1.creativePrompt, lyricLines: s0.table.lines },
    { hops: CREATIVE_LLM_HOPS, compose: composeCreativeAtHop, save: async (name, value) => putJson(`advisor/fill-${name}.json`, value) },
  );
  return { plan: canvasMusicMvPlanSchema.parse(out.plan), failuresZh: out.failuresZh };
});
if (fillRows.some(r => !s4b.plan.shots.find(s => s.id === r.shot.id)?.fill?.length)) throw Error(`素材填充建议未出：${s4b.failuresZh.join("；")}`);
const shotOf = (id: string) => s4b.plan.shots.find(s => s.id === id)!;

// ── 5. 主锚图 = 生成的主角定妆帧 ─────────────────────────────────
type Anchor = { gcsUri: string; prompt: string; sourceUrl: string };
const anchor = await cached<Anchor>("05-anchor", async () => {
  const prompt = mvAnchorKeyframePrompt(s1.creativePrompt, s1.aspect);
  const url = await generateGptImage2FromRawEnglishPrompt({
    englishPrompt: prompt, aspectRatio: s1.aspect, gcsSubdir: `probes/mv-formal/${runId}`, onImageText: "forbid",
    imageLane: "asset", openaiImageVariant: "sunburst", requireImageVariant: true,
  });
  if (!url) throw Error("定妆帧未出图");
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const objectName = `${base}/anchor/keyframe.png`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "image/png" });
  return { gcsUri: `gs://${BUCKET}/${objectName}`, prompt, sourceUrl: url.split("?")[0]! };
});

// ── 6. 场景图 / 运镜参考片 / 歌曲切片 ─────────────────────────────
type Step6 = { references: Record<string, MvShotReferences>; queries: Record<string, string> };
const s6 = await cached<Step6>("06-refs", async () => {
  const references: Record<string, MvShotReferences> = {};
  const queries: Record<string, string> = {};
  const used = new Set<string>();
  const adoptFirst = async (query: string, kind: "photo" | "video", shotId: string, minDur?: number) => {
    const search = await searchPexels({ query, kind, orientation: "portrait", page: 1, perPage: 15, purpose: "mvShot", ...(kind === "video" ? { minDurationSec: Math.max(1, Math.ceil(minDur || 1)), maxDurationSec: 60 } : {}) } as any);
    await putJson(`raw/pexels-${kind}-${shotId}-${createHash("sha1").update(query).digest("hex").slice(0, 8)}.json`, { query, kind, shotId, result: search });
    for (const c of search.candidates) {
      if (used.has(c.providerAssetId)) continue;
      const res = await adoptStockFootage(PROBE_USER, { requestId: randomUUID(), providerAssetId: c.providerAssetId, kind, purpose: "mvShot", usage: "reference", orientation: "portrait", context: { projectId: `probe-${runId}`, shotId, note: "mv-formal probe" } });
      await putJson(`raw/adopt-${kind}-${c.providerAssetId}.json`, res);
      if (res.status === "succeeded" && res.asset) { used.add(c.providerAssetId); return res.asset; }
    }
    throw Error(`图库没有可采用的${kind}：${query}`);
  };
  for (const row of genRows) {
    const shot = shotOf(row.shot.id);
    const q = suggestStockKeywordsByRules(`${shot.visualPrompt}；${shot.cameraPrompt}`, "mvShot").query;
    queries[shot.id] = q;
    const L = shot.endSec - shot.startSec;
    const scenes = [await adoptFirst(q, "photo", shot.id), await adoptFirst(q, "photo", shot.id)];
    const motionRaw = await adoptFirst(q, "video", shot.id, Math.min(L, 14));
    // 参考片整条送出：送前自动裁到 min(本镜时长, 模型单条上限)，入点取运动最强段（与生产 trimShotMotionClip 同函数）
    const trimmed = await trimMvMotionClip(PROBE_USER, { sourceGcsUri: motionRaw.gcsUri, shotSec: L, maxSec: mvShotReferenceLimits(ENGINE).maxVideoItemSec });
    const motion = { ...motionRaw, gcsUri: trimmed.gcsUri, durationSec: trimmed.durationSec, trimmedFrom: { gcsUri: motionRaw.gcsUri, inSec: trimmed.inSec, outSec: trimmed.outSec, sourceSec: trimmed.sourceSec, auto: trimmed.auto } };
    const slice = path.join(work, `${shot.id}.wav`);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(shot.startSec), "-to", String(shot.endSec), "-i", songFile, "-ac", "2", "-ar", "48000", slice]);
    const sliceObj = `${base}/slices/${shot.id}.wav`;
    await uploadBufferToGcs({ bucket: BUCKET, objectName: sliceObj, buffer: await readFile(slice), contentType: "audio/wav" });
    const dur = motion.durationSec || L;
    references[shot.id] = {
      anchorImage: { gcsUri: anchor.gcsUri, label: "生成的主角定妆帧" },
      sceneImages: scenes.map(a => ({ assetId: a.assetId, gcsUri: a.gcsUri, width: a.width, height: a.height, label: `${a.source.author.name} / Pexels` })),
      motionVideos: [{ source: "stock", assetId: motion.assetId, gcsUri: motion.gcsUri, inSec: 0, outSec: dur, durationSec: dur, label: `${motion.source.author.name} / Pexels`, hasRealPerson: true, trimmedFrom: motion.trimmedFrom }],
      songSlice: { jobId: `probe-${shot.id}`, gcsUri: `gs://${BUCKET}/${sliceObj}`, startSec: shot.startSec, endSec: shot.endSec },
    } as MvShotReferences;
  }
  return { references, queries };
});

// ── 7. 生成（按接龙依赖顺序） ───────────────────────────────────
type Sub = { taskId: string; model: string; mode: string; duration: number; body: Record<string, unknown>; prompt: string; counts: unknown; chainFrame?: string; attempt: number };
type Fin = { state: string; error?: string; gcsUri?: string; bytes?: number; sha256?: string; durationSec?: number; width?: number; height?: number; hasAudio?: boolean };
const submitted: Record<string, Sub> = (await getJson("checkpoints/07-submitted.json")) || {};
const finals: Record<string, Fin> = (await getJson("checkpoints/08-final.json")) || {};
const tailFrame = async (shotId: string) => {
  const f = finals[shotId]!;
  const file = path.join(work, `${shotId}-tail.mp4`);
  await writeFile(file, (await downloadGcsObject({ gcsUri: f.gcsUri! })).buffer);
  const png = path.join(work, `${shotId}-tail.png`);
  // 取最后 1 秒逐帧覆盖写，留下的就是末帧（-sseof 太靠尾可能一帧都解不出）
  await run("ffmpeg", ["-y", "-v", "error", "-sseof", "-1", "-i", file, "-update", "1", "-q:v", "2", png]);
  const obj = `${base}/chain/${shotId}-tail.png`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName: obj, buffer: await readFile(png), contentType: "image/png" });
  return `gs://${BUCKET}/${obj}`;
};
const submitShot = async (id: string, attempt: number) => {
  const shot = shotOf(id);
  const idx = rows.findIndex(r => r.shot.id === id);
  const prevRow = idx > 0 ? rows[idx - 1] : undefined;
  const prev = prevRow && genRows.some(g => g.shot.id === prevRow.shot.id) ? prevRow.shot.id : undefined;
  const chain = Boolean(shot.continuesFromPrevious && prev && finals[prev]?.state === "completed");
  const refs = s6.references[id]!;
  const assembled = assembleMvShotReferences(refs, { startSec: shot.startSec, endSec: shot.endSec, kind: shot.kind }, ENGINE, { requiresStaging: mvShotNeedsStagingReference(shot.complexity) });
  const chainFrame = chain ? await tailFrame(prev!) : undefined;
  const gen = mvShotGenerateDurationSec(ENGINE, shot.endSec - shot.startSec);
  const singingLines = shot.kind === "singing" ? lyricTable.lines.filter(l => l.endSec > shot.startSec && l.startSec < shot.endSec) : undefined;
  const timed = compileMvShotTimedPrompt(
    { shotId: id, startSec: shot.startSec, endSec: shot.endSec, kind: shot.kind, visualPrompt: shot.visualPrompt, cameraPrompt: shot.cameraPrompt, lyricQuote: shot.lyricQuote, beats: shot.beats, lyricLines: singingLines, lyricTiming: "unconfirmed", chainFromPrevious: chain },
    { engine: ENGINE, modelLabel: "Seedance 2.0 mini（探针档）", resolution: "480p", aspectRatio: s1.aspect, generateDurationSec: gen, creativePrompt: s1.creativePrompt, beatGrid: s2.grid, references: refs },
  );
  const images = [assembled.imageGcsUris[0]!, ...(chainFrame ? [chainFrame] : []), ...assembled.imageGcsUris.slice(1)];
  const compile = tryCompileManhuaVideoPromptForOutbound({ prompt: timed.text, engine: ENGINE, durationSec: gen, imageRefCount: images.length, videoRefCount: assembled.counts.video, audioRefCount: assembled.counts.audio });
  if (compile.blocked) throw Error(`${id} 出站提示词未通过：${compile.issues.map(i => i.detailZh).join("；")}`);
  const sign = (u: string) => signGsUriV4ReadUrl(u, 3 * 3600);
  const input = { prompt: compile.text, version: "2.0-mini" as const, mode: "reference_to_video" as const, quality: "480p", aspectRatio: s1.aspect, duration: gen, generateAudio: true, imageUrls: images.map(sign), videoUrls: assembled.videoGcsUris.map(sign), audioUrls: assembled.audioGcsUris.map(sign) };
  const built = buildEvolinkSeedanceRequest(input);
  const redacted = { ...built.body, image_urls: images, video_urls: assembled.videoGcsUris, audio_urls: assembled.audioGcsUris };
  await putJson(`raw/${id}-a${attempt}-request.json`, { shotId: id, attempt, body: redacted, compiledPrompt: timed.text, windows: timed.windows, degraded: timed.degraded, compileIssues: compile.issues });
  const result = await submitEvolinkSeedanceVideo({ ...input, persistSubmitReceipt: async receipt => { await putJson(`raw/${id}-a${attempt}-submit-raw.json`, receipt); } });
  const raw = await getJson<{ body: string }>(`raw/${id}-a${attempt}-submit-raw.json`);
  let parsed: unknown; try { parsed = JSON.parse(raw?.body || ""); } catch { parsed = { invalidJson: true }; }
  await putJson(`raw/${id}-a${attempt}-submit-parsed.json`, parsed);
  submitted[id] = { taskId: result.evolinkTaskId, model: result.model, mode: result.mode, duration: built.duration, body: redacted, prompt: String(built.body.prompt), counts: { ...assembled.counts, image: images.length }, chainFrame, attempt };
  delete finals[id];
  await putJson("checkpoints/07-submitted.json", submitted);
  await mark(`07-submitted-${id}-a${attempt}`);
};
const pollUntilDone = async (ids: string[]) => {
  const deadline = Date.now() + 40 * 60_000;
  while (Date.now() < deadline) {
    // 依赖就绪的镜头立即提交（接龙镜等上一镜出片）
    for (let i = 0; i < genRows.length; i++) {
      const id = genRows[i]!.shot.id;
      if (!ids.includes(id) || submitted[id]) continue;
      const shot = shotOf(id);
      const ri = rows.findIndex(r => r.shot.id === id);
      const prev = ri > 0 && genRows.some(g => g.shot.id === rows[ri - 1]!.shot.id) ? rows[ri - 1]!.shot.id : undefined;
      if (shot.continuesFromPrevious && prev && !finals[prev]) continue;
      await submitShot(id, 1);
    }
    for (const id of ids) {
      if (!submitted[id] || finals[id]) continue;
      const a = submitted[id]!.attempt;
      const snap = await pollEvolinkVideoTaskOnce(submitted[id]!.taskId, "Seedance 2.0-mini", async receipt => {
        await putJson(`raw/${id}-a${a}-terminal-raw.json`, receipt);
        let parsed: unknown; try { parsed = JSON.parse(receipt.body); } catch { parsed = { invalidJson: true }; }
        await putJson(`raw/${id}-a${a}-terminal-parsed.json`, parsed);
      });
      if (snap.state === "running") continue;
      if (snap.state === "failed") finals[id] = { state: "failed", error: snap.error };
      else {
        const buf = Buffer.from(await (await fetch(snap.sourceUrl)).arrayBuffer());
        const objectName = `${base}/videos/${id}-a${a}.mp4`;
        await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "video/mp4" });
        const file = path.join(work, `${id}.mp4`);
        await writeFile(file, buf);
        const pr = await ffprobe(file);
        const v = (pr.streams || []).find(x => x.codec_type === "video");
        finals[id] = { state: "completed", gcsUri: `gs://${BUCKET}/${objectName}`, bytes: buf.length, sha256: sha(buf), durationSec: Number(pr.format?.duration), width: v?.width, height: v?.height, hasAudio: (pr.streams || []).some(x => x.codec_type === "audio") };
      }
      await putJson("checkpoints/08-final.json", finals);
      await mark(`08-final-${id}-a${a}`);
    }
    if (ids.every(id => finals[id])) return;
    await new Promise(r => setTimeout(r, 10_000)); // 轮询间隔（命令在跑，租约覆盖）
  }
  throw Error("镜头轮询超时");
};
await pollUntilDone(genRows.map(r => r.shot.id));
const failedGen = genRows.filter(r => finals[r.shot.id]?.state !== "completed");
if (failedGen.length) {
  await putJson("checkpoints/99-verdict.json", { runId, pass: false, blockers: failedGen.map(r => `${r.shot.id} 生成失败：${finals[r.shot.id]?.error}`) });
  throw Error(`镜头未全部出片：${failedGen.map(r => r.shot.id).join(",")}`);
}

// ── 7b. 素材填充镜头：每窗取首个图库候选（视频直接剪入 / 照片推拉），按帧精确拼成与镜头等长的片段 ──
type FillPick = { shotId: string; windows: Array<{ startSec: number; endSec: number; mode: string; queryEn: string; cameraZh: string; reasonZh: string; assetId: string; gcsUri: string; label: string }>; built: { gcsUri: string; durationSec: number; frames: number } };
const fillPicks = await cached<Record<string, FillPick>>("07b-fill", async () => {
  const out: Record<string, FillPick> = {};
  const used = new Set<string>();
  for (const row of fillRows) {
    const shot = shotOf(row.shot.id);
    const windows: FillPick["windows"] = [];
    for (const w of shot.fill!) {
      const cand = w.candidates.find(c => c.mode !== "generated");
      if (!cand) throw Error(`${shot.id} ${w.startSec}–${w.endSec} 没有图库候选`);
      const kind = cand.mode === "stock_video" ? "video" as const : "photo" as const;
      const len = w.endSec - w.startSec;
      const search = await searchPexels({ query: cand.queryEn, kind, orientation: "portrait", page: 1, perPage: 15, purpose: "mvShot", ...(kind === "video" ? { minDurationSec: Math.ceil(len + 0.5), maxDurationSec: 60 } : {}) } as any);
      await putJson(`raw/fill-pexels-${shot.id}-${w.startSec}.json`, { query: cand.queryEn, kind, result: search });
      let asset: any;
      for (const c of search.candidates) {
        if (used.has(c.providerAssetId)) continue;
        const res = await adoptStockFootage(PROBE_USER, { requestId: randomUUID(), providerAssetId: c.providerAssetId, kind, purpose: "mvShot", usage: "reference", orientation: "portrait", context: { projectId: `probe-${runId}`, shotId: shot.id, note: "mv fill probe" } });
        await putJson(`raw/fill-adopt-${c.providerAssetId}.json`, res);
        if (res.status === "succeeded" && res.asset) { used.add(c.providerAssetId); asset = res.asset; break; }
      }
      if (!asset) throw Error(`图库没有可采用的素材：${cand.queryEn}`);
      windows.push({ startSec: w.startSec, endSec: w.endSec, mode: cand.mode, queryEn: cand.queryEn, cameraZh: cand.cameraZh, reasonZh: cand.reasonZh, assetId: asset.assetId, gcsUri: asset.gcsUri, label: `${asset.source.author.name} / Pexels` });
    }
    const built = await buildMvFillShot(PROBE_USER, { shotId: shot.id, aspect: s1.aspect, windows: windows.map(w => ({ startSec: w.startSec, endSec: w.endSec, kind: w.mode === "stock_video" ? "video" : "photo", gcsUri: w.gcsUri, cameraZh: w.cameraZh })) });
    out[shot.id] = { shotId: shot.id, windows, built: { gcsUri: built.gcsUri, durationSec: built.durationSec, frames: built.frames } };
  }
  return out;
});
for (const [id, f] of Object.entries(fillPicks)) finals[id] = { state: "completed", gcsUri: f.built.gcsUri, durationSec: f.built.durationSec, hasAudio: false };

// ── 8. 正式合成（含实测适配；不合格段只重做该段一次） ─────────────
const clips = () => rows.map((row, index) => ({
  episodeIndex: 1, segmentIndex: index + 1,
  clipUrl: row.shot.kind === "footage" ? String((row.shot.sourceClip as any)?.gcsUri || row.shot.sourceClip?.url) : finals[row.shot.id]!.gcsUri!,
  durationSec: row.durationSec,
  trimInSec: (row.shot.kind === "footage" ? row.shot.sourceClip!.sourceStartSec : 0) + row.offsetSec,
  trimOutSec: (row.shot.kind === "footage" ? row.shot.sourceClip!.sourceStartSec : 0) + row.offsetSec + row.durationSec,
}));
const mvClipFit = rows.map(({ shot, offsetSec, durationSec }) => ({
  shotId: shot.id, kind: shot.kind ?? "generated", songStartSec: Math.round((shot.startSec + offsetSec) * 1000) / 1000, offsetSec, durationSec,
  ...(shot.kind === "footage" && shot.sourceClip ? { sourceStartSec: shot.sourceClip.sourceStartSec } : {}),
}));
const fades = planMvHighlightFades({ range: s1.highlight, lines: s0.table.lines, beatGrid: s2.grid });
log("fades", fades);
type Step9 = { payload: unknown; result: any; gcsUri: string; bytes: number; sha256: string; redone: string[]; diagnostic?: { reasonZh: string; unfit: unknown[] } };
let s9 = await getJson<Step9>("checkpoints/09-assemble.json");
if (!s9) {
  const redone: string[] = [];
  let result: any;
  let diagnostic: { reasonZh: string; unfit: unknown[] } | undefined;
  for (let round = 1; round <= 2; round++) {
    const payload = buildManhuaAssembleJobInput({
      clips: clips(), expectedSegments: clips().map(({ episodeIndex, segmentIndex }) => ({ episodeIndex, segmentIndex })),
      musicUrl: s1.audio.gcsUri || s1.audio.url, musicOnly: true, sourceAudioGainDb: -20, mvClipFit,
      ...(fades.fadeInSec > 0 ? { videoFadeInSec: fades.fadeInSec } : {}), ...(fades.fadeOutSec > 0 ? { videoFadeOutSec: fades.fadeOutSec } : {}),
      musicStartSec: Math.round(s1.highlight.startSec * 30) / 30, musicEndSec: Math.round(s1.highlight.endSec * 30) / 30,
      musicVolume: 1, musicFadeInSec: 0, musicFadeOutSec: 0, transition: "cut", resolution: s1.aspect,
    });
    await putJson(`raw/assemble-r${round}-payload.json`, payload);
    try {
      result = await runManhuaAssembleFinal(payload.params as any, { userId: PROBE_USER });
      await putJson(`raw/assemble-r${round}-result.json`, result);
      break;
    } catch (error: any) {
      await putJson(`raw/assemble-r${round}-error.json`, { message: error?.message, code: error?.code, mvClipFit: error?.mvClipFit });
      // 续跑时这些镜已重做过一次：不再重提，直接走诊断成片
      const alreadyRedone = error?.code === "music_mv_clip_unfit" && error.mvClipFit.redoShotIds.every((id: string) => (submitted[id]?.attempt ?? 1) >= 2);
      if (error?.code === "music_mv_clip_unfit" && (round === 2 || alreadyRedone)) {
        // 重做一次后演唱段仍过不了口型核验：照样出一版「诊断成片」供审（演唱段按请求时间线落位：@音频1 从片首对齐），
        // 但演唱段核验失败记为阻断项，不当作通过。
        const bad = error.mvClipFit.results.filter((r: any) => !r.ok);
        for (const id of error.mvClipFit.redoShotIds) if (!redone.includes(id) && (submitted[id]?.attempt ?? 1) >= 2) redone.push(id);
        if (bad.some((r: any) => r.kind !== "singing")) throw error;
        diagnostic = { reasonZh: "演唱段口型落位核验未通过（生成片自带音轨与原歌相关度过低或漂移），本成片演唱段按请求时间线落位，仅供审看", unfit: bad };
        const payload2 = buildManhuaAssembleJobInput({ ...(payload.params as any), mvClipFit: mvClipFit.map(f => (f.kind === "singing" ? { ...f, kind: "generated" as const } : f)) });
        await putJson("raw/assemble-diagnostic-payload.json", payload2);
        result = await runManhuaAssembleFinal(payload2.params as any, { userId: PROBE_USER });
        await putJson("raw/assemble-diagnostic-result.json", result);
        break;
      }
      if (error?.code !== "music_mv_clip_unfit") throw error;
      const redo: string[] = error.mvClipFit.redoShotIds;
      log("unfit, redo only", redo);
      for (const id of redo) { if (fillPicks[id]) throw Error(`素材填充镜头 ${id} 实测不合格：${JSON.stringify(error.mvClipFit.results.find((r: any) => r.shotId === id))}`); redone.push(id); await submitShot(id, 2); }
      await pollUntilDone(redo);
    }
  }
  const objectName = new URL(result.finalVideoUrl).searchParams.get("blobPath") || "";
  const buf = (await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectName}` })).buffer;
  const copy = `${base}/final/mv-highlight-${s1.highlight.startSec}-${s1.highlight.endSec}.mp4`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName: copy, buffer: buf, contentType: "video/mp4" });
  s9 = { payload: null, result, gcsUri: `gs://${BUCKET}/${copy}`, bytes: buf.length, sha256: sha(buf), redone, diagnostic };
  await putJson("checkpoints/09-assemble.json", s9);
  await mark("09-assemble");
}

// ── 9. 断言 ─────────────────────────────────────────────────────
const finalFile = path.join(work, "final.mp4");
await writeFile(finalFile, (await downloadGcsObject({ gcsUri: s9.gcsUri })).buffer);
const fp = await ffprobe(finalFile);
const audioStreams = (fp.streams || []).filter(x => x.codec_type === "audio");
const finalVideo = (fp.streams || []).find(x => x.codec_type === "video");
const sliceFile = path.join(work, "song-slice.wav");
await run("ffmpeg", ["-y", "-v", "error", "-ss", String(s1.highlight.startSec), "-to", String(s1.highlight.endSec), "-i", songFile, "-ac", "1", "-ar", "8000", sliceFile]);
const pcm = async (file: string) => {
  const out = `${file}.f32`;
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "f32le", out]);
  const b = await readFile(out);
  return Array.from({ length: Math.floor(b.length / 4) }, (_, i) => b.readFloatLE(i * 4));
};
const [a, b] = [await pcm(finalFile), await pcm(sliceFile)];
const n = Math.min(a.length, b.length);
let dot = 0, na = 0, nb = 0;
for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
const correlation = dot / Math.sqrt(na * nb || 1);
const expected = s1.highlight.endSec - s1.highlight.startSec;
const sumDur = rows.reduce((s, r) => s + r.durationSec, 0);
const cuts = rows.slice(1).map((r, i) => ({ at: r.shot.startSec + r.offsetSec, left: rows[i]!.shot, right: r.shot }));
const cutChecks = cuts.map(c => {
  const singing = c.left.kind === "singing" || c.right.kind === "singing";
  const pacing = musicMvPacingAt(s2.plan.beatGrid, c.at);
  const nearest = beatsInRange(s2.grid, c.at - 1, c.at + 1).reduce((best, t) => (Math.abs(t - c.at) < Math.abs(best - c.at) ? t : best), Infinity);
  const offBeatSec = Math.abs(nearest - c.at);
  const exempt = singing ? "演唱镜按原歌落位" : pacing !== "beat" ? `${pacing} 段按乐句/能量切` : undefined;
  return { cutSec: c.at, between: [c.left.id, c.right.id], pacing, nearestBeatSec: nearest, offBeatSec: Number(offBeatSec.toFixed(4)), onBeat: offBeatSec <= FRAME, exempt };
});
const placement = musicMvSingingPlacement(rows, s1.highlight.startSec);
// 淡出断言：成片相对原歌切片的增益（每 0.25 秒分箱 RMS 之差）单调下降（容差 2 dB，环境层会带入少量起伏），末 0.1 秒降到静音
const T = expected;
const rate = 8000;
const rmsDb = (x: number[], t0: number, t1: number) => {
  let sum = 0, cnt = 0;
  for (let i = Math.floor(t0 * rate); i < Math.min(x.length, Math.floor(t1 * rate)); i++) { sum += x[i]! * x[i]!; cnt++; }
  return cnt ? 10 * Math.log10(sum / cnt + 1e-12) : -120;
};
const binsDb: number[] = [];
const gainDb: number[] = [];
for (let t = T - fades.fadeOutSec; t + 0.25 <= T + 1e-6; t += 0.25) {
  binsDb.push(rmsDb(a, t, t + 0.25));
  gainDb.push(rmsDb(a, t, t + 0.25) - rmsDb(b, t, t + 0.25));
}
const monotonic = gainDb.every((v, i) => i === 0 || v <= gainDb[i - 1]! + 2);
const tailDb = rmsDb(a, T - 0.1, T);
// 主轨核对：起音包络互相关（波形逐点相关对 AAC 编码延迟过敏），偏移 ≤1 帧且相关 ≥0.8
const envAlign = estimateEnvelopeLagSec(Float32Array.from(b), Float32Array.from(a), rate, 0.5);
// 线性 RMS 包络（50 ms）皮尔逊相关，不含淡出段：原歌 0 dB 为主轨时应 ≥0.9（环境层 −20 dB 只带入少量差异）
const rmsEnv = (x: number[]) => { const out: number[] = []; const w = rate * 0.05; for (let i = 0; i + w <= Math.min(x.length, (T - fades.fadeOutSec) * rate); i += w) { let s2 = 0; for (let j = i; j < i + w; j++) s2 += x[j]! * x[j]!; out.push(Math.sqrt(s2 / w)); } return out; };
const ea = rmsEnv(a), eb = rmsEnv(b); const m = Math.min(ea.length, eb.length);
const mean = (x: number[]) => x.slice(0, m).reduce((p, v) => p + v, 0) / m;
const ma = mean(ea), mb = mean(eb);
let sab = 0, saa = 0, sbb = 0;
for (let i = 0; i < m; i++) { sab += (ea[i]! - ma) * (eb[i]! - mb); saa += (ea[i]! - ma) ** 2; sbb += (eb[i]! - mb) ** 2; }
const rmsEnvCorr = sab / Math.sqrt(saa * sbb || 1);
const lastFrame = path.join(work, "last.png");
await run("ffmpeg", ["-y", "-v", "error", "-sseof", "-0.5", "-i", finalFile, "-update", "1", lastFrame]);
const lastLumaText = (await run("ffmpeg", ["-v", "error", "-i", lastFrame, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"])).stdout;
const lastYavg = Number(/YAVG=([\d.]+)/.exec(lastLumaText)?.[1] ?? NaN);
const fit = s9.result?.mvClipFit?.results || [];
const checks = {
  shotsSumIs45sWithin1Frame: Math.abs(sumDur - expected) <= FRAME + 1e-9,
  finalVideoIs45sWithin1Frame: Math.abs(Number(finalVideo?.duration ?? fp.format?.duration) - expected) <= FRAME + 0.01,
  cutsOnBeat: cutChecks.every(c => c.onBeat || c.exempt),
  finalMainTrackIsSongSlice: audioStreams.length === 1 && Math.abs(Number(audioStreams[0]?.duration) - expected) <= 0.1 && Math.abs(envAlign.lagSec) <= FRAME + 1e-6 && rmsEnvCorr >= 0.9,
  singingPlacementWithin1Frame: placement.every(p => p.errorSec <= FRAME + 1e-9) && fit.filter((r: any) => r.kind === "singing").every((r: any) => r.ok && (r.driftSec ?? 0) <= 2 * FRAME + 1e-6),
  allClipsMeasuredAndFit: !s9.diagnostic && fit.length === rows.length && fit.every((r: any) => r.ok),
  singingLipSyncVerified: !s9.diagnostic,
  endFadeOutAudioMonotonicToSilence: gainDb.length >= 4 && monotonic && tailDb < -40,
  endFadeOutLastFrameBlack: Number.isFinite(lastYavg) && lastYavg < 24,
  allReferenceToVideo: genRows.every(r => /reference-to-video$/.test(submitted[r.shot.id]!.model) && submitted[r.shot.id]!.mode === "reference_to_video"),
  stagingRefsWhereRequired: genRows.every(r => !mvShotNeedsStagingReference(shotOf(r.shot.id).complexity) || (submitted[r.shot.id]!.body as any).video_urls?.length >= 1),
  generatedAudioOnForAmbience: genRows.every(r => (submitted[r.shot.id]!.body as any).generate_audio === true),
};
const blockers = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
const summary = {
  runId, at: new Date().toISOString(), pass: blockers.length === 0, blockers, checks,
  measures: { mainTrackEnvelopeLagSec: envAlign.lagSec, mainTrackOnsetCorrelation: envAlign.confidence, mainTrackRmsEnvelopeCorrelation: rmsEnvCorr, expectedSec: expected, shotsSumSec: sumDur, finalVideoSec: Number(finalVideo?.duration ?? fp.format?.duration), finalAudioSec: Number(audioStreams[0]?.duration), correlation, width: finalVideo?.width, height: finalVideo?.height, bytes: s9.bytes, sha256: s9.sha256 },
  audiomap: { bpm: s2.grid.bpm, source: s2.grid.source, phaseSec: s2.grid.phaseSec, beatConfidence: s2.grid.beatConfidence, segmentsInHighlight: s2.grid.segments?.filter(g => g.endSec > s1.highlight.startSec && g.startSec < s1.highlight.endSec) },
  cutSnap: { before: s2.before, fixes: s2.snapFixes, cuts: cutChecks },
  highlight: { ...s1.highlight, rule: s0.recommendation.reasonZh, lineCount: s0.recommendation.lineCount },
  shotRoles: s2.designatedSinging,
  fades: { ...fades, endBinsDb: binsDb.map(v => Number(v.toFixed(1))), gainVsSongDb: gainDb.map(v => Number(v.toFixed(1))), tailLast100msDb: Number(tailDb.toFixed(1)), lastFrameYavg: lastYavg },
  fill: Object.fromEntries(Object.entries(fillPicks).map(([id, f]) => [id, { advisorWindows: shotOf(id).fill, chosen: f.windows, built: { ...f.built, url24h: signGsUriV4ReadUrl(f.built.gcsUri, 24 * 3600) } }])),
  lyricTable: { status: "pending（未经用户确认）", recognizedBy: lyricTable.recognizedBy, evidence: lyricTable.evidencePrefix, chantFromSec: CHANT_FROM_SEC, lines: s0.table.lines, totalLines: s0.table.lines.length },
  singingPlacement: placement,
  clipFit: fit, redone: s9.redone, diagnostic: s9.diagnostic,
  anchor: { gcsUri: anchor.gcsUri, url24h: signGsUriV4ReadUrl(anchor.gcsUri, 24 * 3600), prompt: anchor.prompt },
  final: { gcsUri: s9.gcsUri, url24h: signGsUriV4ReadUrl(s9.gcsUri, 24 * 3600) },
  shots: rows.map(r => {
    const id = r.shot.id; const sh = shotOf(id); const sub = submitted[id]; const f = finals[id];
    return {
      id, kind: r.shot.kind || "generated", shotSec: [sh.startSec, sh.endSec], usedInFinal: { offsetSec: r.offsetSec, durationSec: r.durationSec },
      complexity: sh.complexity, stagingRequired: mvShotNeedsStagingReference(sh.complexity), continuesFromPrevious: sh.continuesFromPrevious, chainFrame: sub?.chainFrame,
      taskId: sub?.taskId, model: sub?.model, mode: sub?.mode, requestedSec: sub?.duration, attempt: sub?.attempt, measuredSec: f?.durationSec, hasAudio: f?.hasAudio,
      prompt: sub?.prompt, references: sub ? { image_urls: (sub.body as any).image_urls, video_urls: (sub.body as any).video_urls, audio_urls: (sub.body as any).audio_urls, labels: { scenes: s6.references[id]?.sceneImages.map(x => x.label), motion: s6.references[id]?.motionVideos.map(x => `${x.label} ${x.inSec}–${x.outSec}s`), query: s6.queries[id] } } : undefined,
      clip: f?.gcsUri ? { gcsUri: f.gcsUri, url24h: signGsUriV4ReadUrl(f.gcsUri, 24 * 3600) } : undefined,
    };
  }),
};
const prevVerdict = await getJson("checkpoints/99-verdict.json");
if (prevVerdict) await putJson(`checkpoints/99-verdict-prev-${Date.now()}.json`, prevVerdict);
await putJson("checkpoints/99-verdict.json", summary);
await mark("99-verdict");
log("VERDICT", JSON.stringify({ pass: summary.pass, blockers, checks, measures: summary.measures }));
process.exitCode = summary.pass ? 0 : 1;

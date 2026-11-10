/**
 * MV 镜头参考生视频 · 隔离探针（1109）
 *
 * 在工作机隔离目录运行（凭证只在 Fly 进程内存）：
 *   FLY_PROCESS_GROUP=rig tsx scripts/with-worker-probe-lease.mts npx tsx probes/mv-shot-r2v-1109.mts <runId> <projectPrefix>
 * 流程（每步落 GCS 检查点 probes/mv-shot-r2v/<runId>/checkpoints/，已完成步骤续跑时不重做）：
 *  1. 找作品（projectId 前缀）读高光分镜，取连续两个生成镜头（真实分镜时长，不切 5 秒）；
 *  2. 图库真搜+采用（探针用户 999999001，purpose=mvShot/usage=reference）：全片主锚图 1 张（两镜共用）+ 每镜场景图 2 张 + 每镜运镜参考片 1 段；
 *  3. 按分镜秒位从所选歌曲裁两段歌曲切片；
 *  4. 用分支内 assembleMvShotReferences 组装（@图片/@视频/@音频 职责段）+ 出站提示词编译，连续两发 Mini 480p reference_to_video；
 *  5. 轮询终态，原始/解析回执分存；产物入 GCS 并签 24 小时链接。
 * 判据：提交体 model 为 *-reference-to-video、mode=reference_to_video，image/video/audio 参考数组均非空；产物可读。不判动作跟随质量。
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "../server/services/gcs";
import { searchPexels } from "../server/services/stockFootage/pexelsClient";
import { adoptStockFootage } from "../server/services/stockFootage/adoption";
import { suggestStockKeywordsByRules } from "../shared/stockFootageKeywords";
import { assembleMvShotReferences, type MvShotReferences } from "../shared/canvasMusicMvReferences";
import { tryCompileManhuaVideoPromptForOutbound } from "../shared/manhuaOutboundPrompt";
import { musicMvShotSlices } from "../shared/musicMvHighlight";
import {
  buildEvolinkSeedanceRequest,
  pollEvolinkVideoTaskOnce,
  submitEvolinkSeedanceVideo,
} from "../server/services/evolinkSeedanceVideo";

const run = promisify(execFile);
const BUCKET = "mv-studio-pro-vertex-video-temp";
const PROBE_USER = 999999001;
const [runId, projectPrefix = "d31a3a49"] = process.argv.slice(2);
if (!runId || !/^[a-z0-9-]{6,80}$/.test(runId)) throw Error("缺少 runId");
const base = `probes/mv-shot-r2v/${runId}`;
const cp = `${base}/checkpoints`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function putJson(name: string, value: unknown) {
  const buffer = Buffer.from(JSON.stringify(value, null, 2));
  await uploadBufferToGcs({ bucket: BUCKET, objectName: `${base}/${name}`, buffer, contentType: "application/json" });
  return { objectName: `${base}/${name}`, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}
async function getJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${base}/${name}` })).buffer.toString("utf8")) as T;
  } catch {
    return null;
  }
}
type Status = { done: string[]; updatedAt: string; notes?: string[] };
const status: Status = (await getJson<Status>("checkpoints/status.json")) || { done: [], updatedAt: "" };
async function mark(step: string) {
  if (!status.done.includes(step)) status.done.push(step);
  status.updatedAt = new Date().toISOString();
  await putJson("checkpoints/status.json", status);
  log("checkpoint", step);
}

// ── 1. 作品与分镜 ───────────────────────────────────────────────
type ShotPick = {
  id: string; startSec: number; endSec: number; visualPrompt: string; cameraPrompt: string;
  lyricQuote: string; kind?: string; durationSec: number;
};
type Step1 = { projectObject: string; ownerUserId: string; aspect: string; highlight: { startSec: number; endSec: number }; audio: { gcsUri?: string; url: string; durationSec: number }; shots: ShotPick[]; creativePrompt?: string; planRequestId: string };
let s1 = await getJson<Step1>("checkpoints/01-project.json");
if (!s1) {
  const index = await listGcsObjectNamesByPrefix({ prefix: "manhua-project-index/", allPages: true });
  const hit = index.find(n => path.basename(n).startsWith(projectPrefix));
  if (!hit) throw Error(`找不到作品 ${projectPrefix}`);
  const owner = /user-(\d+)\//.exec(hit)?.[1];
  const projectId = path.basename(hit, ".json");
  const draftObject = `manhua-cloud-drafts/user-${owner}/projects/${projectId}.json`;
  const { readManhuaCloudDraftFromGcs } = await import("../server/services/manhuaCloudDraftGcsStore");
  const draft = await readManhuaCloudDraftFromGcs(Number(owner), projectId);
  if (!draft) throw Error("作品草稿不可读");
  const blocks: any[] = (draft.payload as any).canvas?.blocks || [];
  const music = blocks.find(b => b?.kind === "music" && b?.musicMv?.plan);
  if (!music) throw Error("作品里没有已确认分镜的 MV");
  const mv = music.musicMv;
  const audio = mv.candidates.find((c: any) => c.id === mv.selectedCandidateId);
  const range = mv.deliveryMode === "highlight" ? mv.highlight : undefined;
  const slices = musicMvShotSlices(mv.plan, range).map(r => r.shot).filter((s: any) => s.kind !== "footage");
  const pair = slices.slice(0, 2);
  if (pair.length < 2) throw Error("不足两个连续生成镜头");
  s1 = {
    projectObject: draftObject, ownerUserId: String(owner),
    aspect: range ? "9:16" : music.aspectRatio === "9:16" ? "9:16" : "16:9",
    highlight: range, audio: { gcsUri: audio.gcsUri, url: audio.url, durationSec: audio.durationSec },
    creativePrompt: mv.creativePrompt, planRequestId: mv.planRequestId,
    shots: pair.map((s: any) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, visualPrompt: s.visualPrompt, cameraPrompt: s.cameraPrompt, lyricQuote: s.lyricQuote, kind: s.kind, durationSec: s.endSec - s.startSec })),
  };
  await putJson("checkpoints/01-project.json", s1);
  await mark("01-project");
}
log("shots", s1.shots.map(s => `${s.id} ${s.startSec}-${s.endSec} (${s.durationSec.toFixed(2)}s)`));

// ── 2. 图库真搜 + 采用 ───────────────────────────────────────────
const orientation = s1.aspect === "9:16" ? "portrait" as const : "landscape" as const;
async function adoptFirst(query: string, kind: "photo" | "video", shotId: string | undefined, exclude: Set<string>, minDur?: number) {
  const search = await searchPexels({ query, kind, orientation, page: 1, perPage: 15, purpose: "mvShot", ...(kind === "video" ? { minDurationSec: Math.max(1, Math.ceil(minDur || 1)), maxDurationSec: 15 } : {}) } as any);
  await putJson(`raw/pexels-search-${kind}-${createHash("sha1").update(query + kind + (shotId || "anchor")).digest("hex").slice(0, 10)}.json`, { query, kind, shotId, result: search });
  for (const c of search.candidates) {
    if (exclude.has(c.providerAssetId)) continue;
    const res = await adoptStockFootage(PROBE_USER, {
      requestId: randomUUID(), providerAssetId: c.providerAssetId, kind, purpose: "mvShot", usage: "reference", orientation,
      context: { projectId: `probe-${runId}`, ...(shotId ? { shotId } : {}), note: "mv-shot-r2v probe" },
    });
    await putJson(`raw/adopt-${kind}-${c.providerAssetId}.json`, res);
    if (res.status === "succeeded" && res.asset) { exclude.add(c.providerAssetId); return res.asset; }
  }
  throw Error(`图库没有可采用的${kind === "photo" ? "图片" : "视频"}：${query}`);
}
type Step2 = { references: Record<string, MvShotReferences>; queries: Record<string, string> };
let s2 = await getJson<Step2>("checkpoints/02-stock.json");
if (!s2) {
  const used = new Set<string>();
  const queries: Record<string, string> = {};
  const anchorQ = suggestStockKeywordsByRules([s1.shots.map(s => s.visualPrompt).join("；"), s1.creativePrompt].filter(Boolean).join("；"), "mvShot").query;
  queries.anchor = anchorQ;
  const anchor = await adoptFirst(anchorQ, "photo", undefined, used);
  const anchorRef = { assetId: anchor.assetId, gcsUri: anchor.gcsUri, width: anchor.width, height: anchor.height, label: `${anchor.source.author.name} / Pexels`, hasRealPerson: true };
  const references: Record<string, MvShotReferences> = {};
  for (const shot of s1.shots) {
    const q = suggestStockKeywordsByRules(`${shot.visualPrompt}；${shot.cameraPrompt}`, "mvShot").query;
    queries[shot.id] = q;
    const scenes = [await adoptFirst(q, "photo", shot.id, used), await adoptFirst(q, "photo", shot.id, used)];
    const motion = await adoptFirst(q, "video", shot.id, used, Math.min(shot.durationSec, 14));
    const dur = motion.durationSec || shot.durationSec;
    references[shot.id] = {
      anchorImage: anchorRef,
      sceneImages: scenes.map(a => ({ assetId: a.assetId, gcsUri: a.gcsUri, width: a.width, height: a.height, label: `${a.source.author.name} / Pexels` })),
      motionVideos: [{ source: "stock", assetId: motion.assetId, gcsUri: motion.gcsUri, inSec: 0, outSec: Math.min(dur, shot.durationSec), durationSec: dur, label: `${motion.source.author.name} / Pexels`, hasRealPerson: true }],
    };
  }
  s2 = { references, queries };
  await putJson("checkpoints/02-stock.json", s2);
  await mark("02-stock");
}

// ── 3. 歌曲切片 ─────────────────────────────────────────────────
type Step3 = Record<string, { gcsUri: string; startSec: number; endSec: number; durationSec: number }>;
let s3 = await getJson<Step3>("checkpoints/03-song-slices.json");
if (!s3) {
  const dir = await mkdtemp(path.join(tmpdir(), "mvr2v-"));
  const src = path.join(dir, "song");
  const audioBuf = s1.audio.gcsUri
    ? (await downloadGcsObject({ gcsUri: s1.audio.gcsUri })).buffer
    : Buffer.from(await (await fetch(s1.audio.url)).arrayBuffer());
  await writeFile(src, audioBuf);
  s3 = {};
  for (const shot of s1.shots) {
    const out = path.join(dir, `${shot.id}.wav`);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(shot.startSec), "-to", String(shot.endSec), "-i", src, "-ac", "2", "-ar", "48000", out]);
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
    const objectName = `${base}/slices/${shot.id}.wav`;
    await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: await readFile(out), contentType: "audio/wav" });
    s3[shot.id] = { gcsUri: `gs://${BUCKET}/${objectName}`, startSec: shot.startSec, endSec: shot.endSec, durationSec: Number(probe.stdout.trim()) };
  }
  await putJson("checkpoints/03-song-slices.json", s3);
  await mark("03-song-slices");
}

// ── 4. 组装 + 两发 Mini 480p reference_to_video ─────────────────
type Submitted = { taskId: string; model: string; mode: string; duration: number; requestBody: Record<string, unknown>; counts: { image: number; video: number; audio: number } };
const submitted: Record<string, Submitted> = (await getJson("checkpoints/04-submitted.json")) || {};
for (const shot of s1.shots) {
  if (submitted[shot.id]) continue;
  const refs: MvShotReferences = { ...s2.references[shot.id], songSlice: { jobId: `probe-${shot.id}`, gcsUri: s3[shot.id].gcsUri, startSec: shot.startSec, endSec: shot.endSec } };
  const assembled = assembleMvShotReferences(refs, { startSec: shot.startSec, endSec: shot.endSec, kind: shot.kind as any }, "2.0-mini");
  // 与 createMusicMvShotBlocks 同一提示词格式（不改既有编译规则），末尾追加职责段
  const durationSec = Math.min(15, Math.max(4, Math.ceil(shot.durationSec)));
  const shotPrompt = `目标时长：${Math.max(5, Math.ceil(shot.durationSec))} 秒。\n${shot.visualPrompt}\n运镜：${shot.cameraPrompt}\n歌曲段落：${shot.lyricQuote || "器乐段"}\nMV时间位置：${shot.startSec}–${shot.endSec}秒。后期统一贴入原歌曲。\n\n${assembled.promptAppendix}`;
  const compile = tryCompileManhuaVideoPromptForOutbound({ prompt: shotPrompt, engine: "seedance-2.0-mini", durationSec, imageRefCount: assembled.counts.image, videoRefCount: assembled.counts.video, audioRefCount: assembled.counts.audio });
  if (compile.blocked) throw Error(`出站提示词未通过：${compile.issues.map(i => i.detailZh).join("；")}`);
  const sign = (u: string) => signGsUriV4ReadUrl(u, 3 * 3600);
  const input = {
    prompt: compile.text, version: "2.0-mini" as const, mode: "reference_to_video" as const, quality: "480p",
    aspectRatio: s1.aspect, duration: durationSec, generateAudio: true,
    imageUrls: assembled.imageGcsUris.map(sign), videoUrls: assembled.videoGcsUris.map(sign), audioUrls: assembled.audioGcsUris.map(sign),
  };
  const built = buildEvolinkSeedanceRequest(input);
  const redacted = { ...built.body, image_urls: assembled.imageGcsUris, video_urls: assembled.videoGcsUris, audio_urls: assembled.audioGcsUris };
  await putJson(`raw/${shot.id}-request.json`, { shotId: shot.id, body: redacted, promptSource: shotPrompt, compileIssues: compile.issues });
  const result = await submitEvolinkSeedanceVideo({
    ...input,
    persistSubmitReceipt: async receipt => { await putJson(`raw/${shot.id}-submit-raw.json`, receipt); },
  });
  const raw = await getJson<{ status: number; body: string }>(`raw/${shot.id}-submit-raw.json`);
  let parsed: unknown; try { parsed = JSON.parse(raw?.body || ""); } catch { parsed = { invalidJson: true }; }
  await putJson(`raw/${shot.id}-submit-parsed.json`, parsed);
  submitted[shot.id] = { taskId: result.evolinkTaskId, model: result.model, mode: result.mode, duration: built.duration, requestBody: redacted, counts: assembled.counts };
  await putJson("checkpoints/04-submitted.json", submitted);
  await mark(`04-submitted-${shot.id}`);
}

// ── 5. 轮询终态 + 产物入 GCS + 24h 签名 ─────────────────────────
type Final = { taskId: string; state: string; error?: string; gcsUri?: string; url24h?: string; bytes?: number; durationSec?: number; width?: number; height?: number };
const finals: Record<string, Final> = (await getJson("checkpoints/05-final.json")) || {};
const deadline = Date.now() + 30 * 60_000;
while (s1.shots.some(s => !finals[s.id]) && Date.now() < deadline) {
  for (const shot of s1.shots) {
    if (finals[shot.id]) continue;
    const task = submitted[shot.id];
    const snap = await pollEvolinkVideoTaskOnce(task.taskId, "Seedance 2.0-mini", async receipt => {
      await putJson(`raw/${shot.id}-terminal-raw.json`, receipt);
      let parsed: unknown; try { parsed = JSON.parse(receipt.body); } catch { parsed = { invalidJson: true }; }
      await putJson(`raw/${shot.id}-terminal-parsed.json`, parsed);
    });
    if (snap.state === "running") continue;
    if (snap.state === "failed") { finals[shot.id] = { taskId: task.taskId, state: "failed", error: snap.error }; }
    else {
      const buf = Buffer.from(await (await fetch(snap.sourceUrl)).arrayBuffer());
      const objectName = `${base}/videos/${shot.id}.mp4`;
      await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "video/mp4" });
      const dir = await mkdtemp(path.join(tmpdir(), "mvr2v-v-"));
      const f = path.join(dir, "v.mp4"); await writeFile(f, buf);
      const pr = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", f])).stdout);
      const v = (pr.streams || []).find((x: any) => x.width);
      finals[shot.id] = { taskId: task.taskId, state: "completed", gcsUri: `gs://${BUCKET}/${objectName}`, url24h: signGsUriV4ReadUrl(`gs://${BUCKET}/${objectName}`, 24 * 3600), bytes: buf.length, durationSec: Number(pr.format?.duration), width: v?.width, height: v?.height };
    }
    await putJson("checkpoints/05-final.json", finals);
    await mark(`05-final-${shot.id}`);
  }
  if (s1.shots.some(s => !finals[s.id])) await new Promise(r => setTimeout(r, 10_000)); // 轮询间隔（命令仍在运行，租约覆盖）
}

// ── 判据 ────────────────────────────────────────────────────────
const verdict = s1.shots.map(shot => {
  const sub = submitted[shot.id];
  const body = sub.requestBody as any;
  const checks = {
    modelIsR2V: /reference-to-video$/.test(sub.model),
    modeIsR2V: sub.mode === "reference_to_video",
    imagesNonEmpty: (body.image_urls || []).length >= 1,
    videosNonEmpty: (body.video_urls || []).length >= 1,
    audiosNonEmpty: (body.audio_urls || []).length >= 1,
    anchorShared: body.image_urls?.[0] === (submitted[s1.shots[0].id].requestBody as any).image_urls?.[0],
    completed: finals[shot.id]?.state === "completed",
  };
  return { shotId: shot.id, taskId: sub.taskId, model: sub.model, mode: sub.mode, duration: sub.duration, counts: sub.counts, checks, pass: Object.values(checks).every(Boolean), final: finals[shot.id] };
});
const summary = { runId, at: new Date().toISOString(), pass: verdict.every(v => v.pass), verdict };
await putJson("checkpoints/99-verdict.json", summary);
await mark("99-verdict");
log("VERDICT", JSON.stringify(summary));
process.exitCode = summary.pass ? 0 : 1;

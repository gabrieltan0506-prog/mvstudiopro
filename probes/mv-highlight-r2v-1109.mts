/**
 * MV 高光整段参考生视频 + 正式合成 · 隔离探针（1109）
 *
 * 在工作机隔离目录运行（凭证只在 Fly 进程内存）：
 *   FLY_PROCESS_GROUP=rig tsx scripts/with-worker-probe-lease.mts npx tsx probes/mv-highlight-r2v-1109.mts <runId> <projectPrefix> [reuseRunId]
 * 流程（每步落 GCS 检查点 probes/mv-highlight-r2v/<runId>/checkpoints/，续跑不重做已完成步骤）：
 *  1. 读作品高光区间与全部高光镜头（musicMvShotSlices，真实分镜时长，不切 5 秒）；
 *  2. 复用 reuseRunId（probes/mv-shot-r2v）已出片镜头与其主锚图（五镜共用同一张主锚）；
 *  3. 其余镜头图库真搜+采用（探针用户 999999001，purpose=mvShot/usage=reference）：每镜场景图 2 + 运镜参考片 1；
 *  4. 按分镜秒位裁歌曲切片（@音频1 只作卡点参考）；
 *  5. Mini 480p reference_to_video，generate_audio=false（关模型自带音轨），原始/解析回执分存；
 *  6. 正式合成链 buildManhuaAssembleJobInput → runManhuaAssembleFinal（musicOnly、原歌高光区间、cut）；
 *  7. 断言：成片音轨时长 = 原歌切片时长；成片音轨与原歌切片波形相关；新镜头请求 generate_audio=false。
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  downloadGcsObject,
  getGcsBucketName,
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
import { buildManhuaAssembleJobInput } from "../shared/manhuaAssembleJobInput";
import { runManhuaAssembleFinal } from "../server/services/manhuaAssembleFinalService";
import {
  buildEvolinkSeedanceRequest,
  pollEvolinkVideoTaskOnce,
  submitEvolinkSeedanceVideo,
} from "../server/services/evolinkSeedanceVideo";

const run = promisify(execFile);
const BUCKET = "mv-studio-pro-vertex-video-temp";
const PROBE_USER = 999999001;
const [runId, projectPrefix = "d31a3a49", reuseRunId] = process.argv.slice(2);
if (!runId || !/^[a-z0-9-]{6,80}$/.test(runId)) throw Error("缺少 runId");
if (reuseRunId && !/^[a-z0-9-]{6,80}$/.test(reuseRunId)) throw Error("reuseRunId 无效");
const base = `probes/mv-highlight-r2v/${runId}`;
const reuseBase = reuseRunId ? `probes/mv-shot-r2v/${reuseRunId}` : "";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function putJson(name: string, value: unknown) {
  const buffer = Buffer.from(JSON.stringify(value, null, 2));
  await uploadBufferToGcs({ bucket: BUCKET, objectName: `${base}/${name}`, buffer, contentType: "application/json" });
  return { objectName: `${base}/${name}`, bytes: buffer.length, sha256: sha(buffer) };
}
async function getJsonAt<T>(objectName: string): Promise<T | null> {
  try {
    return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${objectName}` })).buffer.toString("utf8")) as T;
  } catch {
    return null;
  }
}
const getJson = <T,>(name: string) => getJsonAt<T>(`${base}/${name}`);
type Status = { done: string[]; updatedAt: string };
const status: Status = (await getJson<Status>("checkpoints/status.json")) || { done: [], updatedAt: "" };
async function mark(step: string) {
  if (!status.done.includes(step)) status.done.push(step);
  status.updatedAt = new Date().toISOString();
  await putJson("checkpoints/status.json", status);
  log("checkpoint", step);
}
async function ffprobeJson(file: string) {
  return JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,duration", "-of", "json", file])).stdout) as {
    format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
}

// ── 1. 作品与高光镜头 ───────────────────────────────────────────
type Row = {
  id: string; kind?: string; startSec: number; endSec: number; offsetSec: number; durationSec: number;
  visualPrompt: string; cameraPrompt: string; lyricQuote: string; sourceClip?: { url?: string; gcsUri?: string; sourceStartSec: number };
};
type Step1 = {
  projectObject: string; ownerUserId: string; aspect: "9:16" | "16:9"; highlight: { startSec: number; endSec: number };
  audio: { id: string; gcsUri?: string; url: string; durationSec: number }; rows: Row[]; creativePrompt?: string; planRequestId: string;
};
let s1 = await getJson<Step1>("checkpoints/01-project.json");
if (!s1) {
  const index = await listGcsObjectNamesByPrefix({ prefix: "manhua-project-index/", allPages: true });
  const hit = index.find(n => path.basename(n).startsWith(projectPrefix));
  if (!hit) throw Error(`找不到作品 ${projectPrefix}`);
  const owner = /user-(\d+)\//.exec(hit)?.[1];
  const projectId = path.basename(hit, ".json");
  const { readManhuaCloudDraftFromGcs } = await import("../server/services/manhuaCloudDraftGcsStore");
  const draft = await readManhuaCloudDraftFromGcs(Number(owner), projectId);
  if (!draft) throw Error("作品草稿不可读");
  const blocks: any[] = (draft.payload as any).canvas?.blocks || [];
  const music = blocks.find(b => b?.kind === "music" && b?.musicMv?.plan);
  if (!music) throw Error("作品里没有已确认分镜的 MV");
  const mv = music.musicMv;
  if (mv.deliveryMode !== "highlight" || !mv.highlight) throw Error("该作品不是高光交付");
  const audio = mv.candidates.find((c: any) => c.id === mv.selectedCandidateId);
  const rows = musicMvShotSlices(mv.plan, mv.highlight).map(r => ({
    id: r.shot.id, kind: r.shot.kind, startSec: r.shot.startSec, endSec: r.shot.endSec, offsetSec: r.offsetSec, durationSec: r.durationSec,
    visualPrompt: r.shot.visualPrompt, cameraPrompt: r.shot.cameraPrompt, lyricQuote: r.shot.lyricQuote,
    ...(r.shot.kind === "footage" && r.shot.sourceClip ? { sourceClip: r.shot.sourceClip as any } : {}),
  }));
  s1 = {
    projectObject: `manhua-cloud-drafts/user-${owner}/projects/${projectId}.json`, ownerUserId: String(owner), aspect: "9:16",
    highlight: mv.highlight, audio: { id: audio.id, gcsUri: audio.gcsUri, url: audio.url, durationSec: audio.durationSec },
    rows, creativePrompt: mv.creativePrompt, planRequestId: mv.planRequestId,
  };
  await putJson("checkpoints/01-project.json", s1);
  await mark("01-project");
}
log("highlight", s1.highlight, "rows", s1.rows.map(r => `${r.id}[${r.kind || "generated"}] ${r.startSec}-${r.endSec} 取 +${r.offsetSec}s×${r.durationSec}s`));
const genRows = s1.rows.filter(r => r.kind !== "footage");

// ── 2. 复用已出片镜头（与其主锚图） ───────────────────────────────
type Ref = MvShotReferences;
type Submitted = { taskId: string; model: string; mode: string; duration: number; requestBody: Record<string, unknown>; counts: { image: number; video: number; audio: number }; reusedFrom?: string; promptSource?: string };
type Final = { taskId: string; state: string; error?: string; gcsUri?: string; bytes?: number; sha256?: string; durationSec?: number; width?: number; height?: number; hasAudio?: boolean; reusedFrom?: string };
type Step2 = { anchor: Ref["anchorImage"]; references: Record<string, Ref>; queries: Record<string, string>; reused: string[]; usedAssets: string[] };
let s2 = await getJson<Step2>("checkpoints/02-stock.json");
const submitted: Record<string, Submitted> = (await getJson("checkpoints/04-submitted.json")) || {};
const finals: Record<string, Final> = (await getJson("checkpoints/05-final.json")) || {};
if (!s2) {
  const references: Record<string, Ref> = {};
  const queries: Record<string, string> = {};
  const reused: string[] = [];
  const used = new Set<string>();
  let anchor: Ref["anchorImage"] | undefined;
  if (reuseBase) {
    const r2 = await getJsonAt<{ references: Record<string, Ref>; queries: Record<string, string> }>(`${reuseBase}/checkpoints/02-stock.json`);
    const r3 = await getJsonAt<Record<string, { gcsUri: string; startSec: number; endSec: number }>>(`${reuseBase}/checkpoints/03-song-slices.json`);
    const r4 = await getJsonAt<Record<string, Submitted>>(`${reuseBase}/checkpoints/04-submitted.json`);
    const r5 = await getJsonAt<Record<string, Final>>(`${reuseBase}/checkpoints/05-final.json`);
    if (!r2 || !r3 || !r4 || !r5) throw Error("复用探针检查点不全");
    for (const ref of Object.values(r2.references)) {
      for (const a of [ref.anchorImage, ...(ref.sceneImages || []), ...(ref.motionVideos || [])]) if (a && "assetId" in a && a.assetId) used.add(String(a.assetId));
    }
    for (const row of genRows) {
      const f = r5[row.id];
      if (!f || f.state !== "completed" || !r4[row.id] || !r2.references[row.id]) continue;
      anchor = anchor || r2.references[row.id].anchorImage;
      references[row.id] = { ...r2.references[row.id], songSlice: { jobId: `probe-${row.id}`, gcsUri: r3[row.id].gcsUri, startSec: row.startSec, endSec: row.endSec } };
      queries[row.id] = r2.queries[row.id];
      const req = await getJsonAt<{ body: Record<string, unknown>; promptSource: string }>(`${reuseBase}/raw/${row.id}-request.json`);
      submitted[row.id] = { ...r4[row.id], reusedFrom: reuseRunId, promptSource: req?.promptSource, requestBody: req?.body || r4[row.id].requestBody };
      finals[row.id] = { ...f, reusedFrom: reuseRunId };
      reused.push(row.id);
    }
    queries.anchor = r2.queries.anchor;
  }
  const orientation = s1.aspect === "9:16" ? ("portrait" as const) : ("landscape" as const);
  const adoptFirst = async (query: string, kind: "photo" | "video", shotId: string | undefined, minDur?: number) => {
    const search = await searchPexels({ query, kind, orientation, page: 1, perPage: 15, purpose: "mvShot", ...(kind === "video" ? { minDurationSec: Math.max(1, Math.ceil(minDur || 1)), maxDurationSec: 15 } : {}) } as any);
    await putJson(`raw/pexels-search-${kind}-${createHash("sha1").update(query + kind + (shotId || "anchor")).digest("hex").slice(0, 10)}.json`, { query, kind, shotId, result: search });
    for (const c of search.candidates) {
      if (used.has(c.providerAssetId)) continue;
      const res = await adoptStockFootage(PROBE_USER, {
        requestId: randomUUID(), providerAssetId: c.providerAssetId, kind, purpose: "mvShot", usage: "reference", orientation,
        context: { projectId: `probe-${runId}`, ...(shotId ? { shotId } : {}), note: "mv-highlight-r2v probe" },
      });
      await putJson(`raw/adopt-${kind}-${c.providerAssetId}.json`, res);
      if (res.status === "succeeded" && res.asset) { used.add(c.providerAssetId); used.add(String(res.asset.assetId)); return res.asset; }
    }
    throw Error(`图库没有可采用的${kind === "photo" ? "图片" : "视频"}：${query}`);
  };
  if (!anchor) {
    const q = suggestStockKeywordsByRules([genRows.map(r => r.visualPrompt).join("；"), s1.creativePrompt].filter(Boolean).join("；"), "mvShot").query;
    queries.anchor = q;
    const a = await adoptFirst(q, "photo", undefined);
    anchor = { assetId: a.assetId, gcsUri: a.gcsUri, width: a.width, height: a.height, label: `${a.source.author.name} / Pexels`, hasRealPerson: true } as any;
  }
  for (const row of genRows) {
    if (references[row.id]) continue;
    const q = suggestStockKeywordsByRules(`${row.visualPrompt}；${row.cameraPrompt}`, "mvShot").query;
    queries[row.id] = q;
    const shotDur = row.endSec - row.startSec;
    const scenes = [await adoptFirst(q, "photo", row.id), await adoptFirst(q, "photo", row.id)];
    const motion = await adoptFirst(q, "video", row.id, Math.min(shotDur, 14));
    const dur = motion.durationSec || shotDur;
    references[row.id] = {
      anchorImage: anchor!,
      sceneImages: scenes.map(a => ({ assetId: a.assetId, gcsUri: a.gcsUri, width: a.width, height: a.height, label: `${a.source.author.name} / Pexels` })),
      motionVideos: [{ source: "stock", assetId: motion.assetId, gcsUri: motion.gcsUri, inSec: 0, outSec: Math.min(dur, shotDur), durationSec: dur, label: `${motion.source.author.name} / Pexels`, hasRealPerson: true }],
    } as Ref;
  }
  s2 = { anchor, references, queries, reused, usedAssets: [...used] };
  await putJson("checkpoints/02-stock.json", s2);
  await putJson("checkpoints/04-submitted.json", submitted);
  await putJson("checkpoints/05-final.json", finals);
  await mark("02-stock");
}
log("reused", s2.reused, "anchor", (s2.anchor as any)?.gcsUri);

// ── 3. 歌曲切片（下载原歌一次，后续合成断言也用） ───────────────
const work = await mkdtemp(path.join(tmpdir(), "mvhl-"));
const songFile = path.join(work, "song");
const songBuf = s1.audio.gcsUri
  ? (await downloadGcsObject({ gcsUri: s1.audio.gcsUri })).buffer
  : Buffer.from(await (await fetch(s1.audio.url)).arrayBuffer());
await writeFile(songFile, songBuf);
for (const row of genRows) {
  if (s2.references[row.id].songSlice) continue;
  const out = path.join(work, `${row.id}.wav`);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(row.startSec), "-to", String(row.endSec), "-i", songFile, "-ac", "2", "-ar", "48000", out]);
  const objectName = `${base}/slices/${row.id}.wav`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: await readFile(out), contentType: "audio/wav" });
  s2.references[row.id] = { ...s2.references[row.id], songSlice: { jobId: `probe-${row.id}`, gcsUri: `gs://${BUCKET}/${objectName}`, startSec: row.startSec, endSec: row.endSec } };
  await putJson("checkpoints/02-stock.json", s2);
  await mark(`03-slice-${row.id}`);
}

// ── 4. Mini 480p reference_to_video，关模型自带音轨 ───────────────
for (const row of genRows) {
  if (submitted[row.id]) continue;
  const refs = s2.references[row.id];
  const assembled = assembleMvShotReferences(refs, { startSec: row.startSec, endSec: row.endSec, kind: row.kind as any }, "2.0-mini");
  const shotDur = row.endSec - row.startSec;
  // 与 createMusicMvShotBlocks 同一提示词格式，末尾追加职责段（canvasRunBlock 同序）
  const head = row.kind === "singing"
    ? `目标时长：${Math.ceil(shotDur)} 秒。\n${row.visualPrompt}\n运镜：${row.cameraPrompt}\n人物按@音频1中的真实演唱同步口型、呼吸和表情，保持原曲速度、唱法与声音；不改唱词、不另配音。仅表演本唱段，歌曲绝对时间${row.startSec}–${row.endSec}秒。\n歌词：${row.lyricQuote || "以实际唱段为准"}`
    : `目标时长：${Math.max(5, Math.ceil(shotDur))} 秒。\n${row.visualPrompt}\n运镜：${row.cameraPrompt}\n歌曲段落：${row.lyricQuote || "器乐段"}\nMV时间位置：${row.startSec}–${row.endSec}秒。后期统一贴入原歌曲。`;
  const promptSource = `${head}\n\n${assembled.promptAppendix}`;
  const durationSec = Math.min(15, Math.max(4, Math.ceil(shotDur)));
  const compile = tryCompileManhuaVideoPromptForOutbound({ prompt: promptSource, engine: "seedance-2.0-mini", durationSec, imageRefCount: assembled.counts.image, videoRefCount: assembled.counts.video, audioRefCount: assembled.counts.audio });
  if (compile.blocked) throw Error(`出站提示词未通过：${compile.issues.map(i => i.detailZh).join("；")}`);
  const sign = (u: string) => signGsUriV4ReadUrl(u, 3 * 3600);
  const input = {
    prompt: compile.text, version: "2.0-mini" as const, mode: "reference_to_video" as const, quality: "480p",
    aspectRatio: s1.aspect, duration: durationSec, generateAudio: false,
    imageUrls: assembled.imageGcsUris.map(sign), videoUrls: assembled.videoGcsUris.map(sign), audioUrls: assembled.audioGcsUris.map(sign),
  };
  const built = buildEvolinkSeedanceRequest(input);
  if (built.body.generate_audio !== false) throw Error("MV 镜头请求未关闭模型自带音轨");
  const redacted = { ...built.body, image_urls: assembled.imageGcsUris, video_urls: assembled.videoGcsUris, audio_urls: assembled.audioGcsUris };
  await putJson(`raw/${row.id}-request.json`, { shotId: row.id, body: redacted, promptSource, compileIssues: compile.issues });
  const result = await submitEvolinkSeedanceVideo({
    ...input,
    persistSubmitReceipt: async receipt => { await putJson(`raw/${row.id}-submit-raw.json`, receipt); },
  });
  const raw = await getJson<{ status: number; body: string }>(`raw/${row.id}-submit-raw.json`);
  let parsed: unknown; try { parsed = JSON.parse(raw?.body || ""); } catch { parsed = { invalidJson: true }; }
  await putJson(`raw/${row.id}-submit-parsed.json`, parsed);
  submitted[row.id] = { taskId: result.evolinkTaskId, model: result.model, mode: result.mode, duration: built.duration, requestBody: redacted, counts: assembled.counts, promptSource };
  await putJson("checkpoints/04-submitted.json", submitted);
  await mark(`04-submitted-${row.id}`);
}

// ── 5. 轮询终态 + 产物入 GCS ─────────────────────────────────────
const deadline = Date.now() + 30 * 60_000;
while (genRows.some(r => !finals[r.id]) && Date.now() < deadline) {
  for (const row of genRows) {
    if (finals[row.id]) continue;
    const task = submitted[row.id];
    const snap = await pollEvolinkVideoTaskOnce(task.taskId, "Seedance 2.0-mini", async receipt => {
      await putJson(`raw/${row.id}-terminal-raw.json`, receipt);
      let parsed: unknown; try { parsed = JSON.parse(receipt.body); } catch { parsed = { invalidJson: true }; }
      await putJson(`raw/${row.id}-terminal-parsed.json`, parsed);
    });
    if (snap.state === "running") continue;
    if (snap.state === "failed") finals[row.id] = { taskId: task.taskId, state: "failed", error: snap.error };
    else {
      const buf = Buffer.from(await (await fetch(snap.sourceUrl)).arrayBuffer());
      const objectName = `${base}/videos/${row.id}.mp4`;
      await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "video/mp4" });
      finals[row.id] = { taskId: task.taskId, state: "completed", gcsUri: `gs://${BUCKET}/${objectName}`, bytes: buf.length, sha256: sha(buf) };
    }
    await putJson("checkpoints/05-final.json", finals);
    await mark(`05-final-${row.id}`);
  }
  if (genRows.some(r => !finals[r.id])) await new Promise(r => setTimeout(r, 10_000)); // 轮询间隔（命令在跑，租约覆盖）
}
const failed = genRows.filter(r => finals[r.id]?.state !== "completed");
if (failed.length) {
  await putJson("checkpoints/99-verdict.json", { runId, pass: false, reason: "镜头未全部出片", failed: failed.map(r => ({ id: r.id, final: finals[r.id] })) });
  throw Error(`镜头未全部出片：${failed.map(r => r.id).join(",")}`);
}
// 逐镜探测（含复用镜头）：时长、尺寸、是否带模型自带音轨
for (const row of genRows) {
  const f = finals[row.id];
  if (f.hasAudio !== undefined && f.sha256) continue;
  const buf = (await downloadGcsObject({ gcsUri: f.gcsUri! })).buffer;
  const file = path.join(work, `${row.id}.mp4`);
  await writeFile(file, buf);
  const pr = await ffprobeJson(file);
  const v = (pr.streams || []).find(x => x.codec_type === "video");
  Object.assign(f, { bytes: buf.length, sha256: sha(buf), durationSec: Number(pr.format?.duration), width: v?.width, height: v?.height, hasAudio: (pr.streams || []).some(x => x.codec_type === "audio") });
}
await putJson("checkpoints/05-final.json", finals);
await mark("05-probed");

// ── 6. 正式合成（与 canvasMusicMvAssemble.queue 同参） ─────────────
type Step6 = { payload: unknown; finalVideoUrl: string; objectName: string; gcsUri: string; bytes: number; sha256: string };
let s6 = await getJson<Step6>("checkpoints/06-assemble.json");
if (!s6) {
  const clips = s1.rows.map((row, index) => ({
    episodeIndex: 1, segmentIndex: index + 1,
    clipUrl: row.kind === "footage" ? String(row.sourceClip?.gcsUri || row.sourceClip?.url) : finals[row.id].gcsUri!,
    durationSec: row.durationSec,
    trimInSec: (row.kind === "footage" ? row.sourceClip!.sourceStartSec : 0) + row.offsetSec,
    trimOutSec: (row.kind === "footage" ? row.sourceClip!.sourceStartSec : 0) + row.offsetSec + row.durationSec,
  }));
  const payload = buildManhuaAssembleJobInput({
    clips,
    expectedSegments: clips.map(({ episodeIndex, segmentIndex }) => ({ episodeIndex, segmentIndex })),
    musicUrl: s1.audio.gcsUri || s1.audio.url,
    musicOnly: true,
    musicStartSec: Math.round(s1.highlight.startSec * 30) / 30,
    musicEndSec: Math.round(s1.highlight.endSec * 30) / 30,
    musicVolume: 1, musicFadeInSec: 0, musicFadeOutSec: 0, transition: "cut", resolution: s1.aspect,
  });
  await putJson("raw/assemble-payload.json", payload);
  const result = await runManhuaAssembleFinal(payload as any, { userId: PROBE_USER });
  await putJson("raw/assemble-result.json", result);
  const objectName = new URL(result.finalVideoUrl).searchParams.get("blobPath") || "";
  if (!objectName) throw Error("合成产物地址不可解析");
  const buf = (await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectName}` })).buffer;
  const copy = `${base}/final/mv-highlight-${s1.highlight.startSec}-${s1.highlight.endSec}.mp4`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName: copy, buffer: buf, contentType: "video/mp4" });
  s6 = { payload, finalVideoUrl: result.finalVideoUrl, objectName, gcsUri: `gs://${BUCKET}/${copy}`, bytes: buf.length, sha256: sha(buf) };
  await putJson("checkpoints/06-assemble.json", s6);
  await mark("06-assemble");
}

// ── 7. 断言 ─────────────────────────────────────────────────────
const finalFile = path.join(work, "final.mp4");
await writeFile(finalFile, (await downloadGcsObject({ gcsUri: s6.gcsUri })).buffer);
const fp = await ffprobeJson(finalFile);
const audioStreams = (fp.streams || []).filter(x => x.codec_type === "audio");
const finalVideo = (fp.streams || []).find(x => x.codec_type === "video");
const sliceFile = path.join(work, "song-slice.wav");
await run("ffmpeg", ["-y", "-v", "error", "-ss", String(s1.highlight.startSec), "-to", String(s1.highlight.endSec), "-i", songFile, "-ac", "1", "-ar", "8000", sliceFile]);
const sliceDur = Number((await ffprobeJson(sliceFile)).format?.duration);
const pcm = async (file: string) => {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 } as any);
  const b = stdout as unknown as Buffer;
  return Array.from({ length: Math.floor(b.length / 4) }, (_, i) => b.readFloatLE(i * 4));
};
const [a, b] = [await pcm(finalFile), await pcm(sliceFile)];
const n = Math.min(a.length, b.length);
let dot = 0, na = 0, nb = 0;
for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
const correlation = dot / Math.sqrt(na * nb || 1);
const finalAudioDur = Number(audioStreams[0]?.duration);
const finalVideoDur = Number(finalVideo?.duration ?? fp.format?.duration);
const expected = s1.highlight.endSec - s1.highlight.startSec;
const newShots = genRows.filter(r => !submitted[r.id].reusedFrom);
const checks = {
  allShotsReferenceToVideo: genRows.every(r => /reference-to-video$/.test(submitted[r.id].model) && submitted[r.id].mode === "reference_to_video"),
  allShotsHaveImageVideoAudioRefs: genRows.every(r => { const bd = submitted[r.id].requestBody as any; return bd.image_urls?.length >= 1 && bd.video_urls?.length >= 1 && bd.audio_urls?.length >= 1; }),
  anchorSharedAllShots: new Set(genRows.map(r => (submitted[r.id].requestBody as any).image_urls?.[0])).size === 1,
  newShotsGenerateAudioFalse: newShots.every(r => (submitted[r.id].requestBody as any).generate_audio === false),
  newShotsSilent: newShots.every(r => finals[r.id].hasAudio === false),
  finalSingleAudioTrack: audioStreams.length === 1,
  finalAudioDurationEqualsSongSlice: Math.abs(finalAudioDur - sliceDur) <= 0.1 && Math.abs(sliceDur - expected) <= 0.05,
  finalVideoDurationEqualsHighlight: Math.abs(finalVideoDur - expected) <= 0.1,
  finalAudioIsOriginalSong: correlation >= 0.9,
};
const summary = {
  runId, reuseRunId, at: new Date().toISOString(), pass: Object.values(checks).every(Boolean), checks,
  measures: { expectedSec: expected, songSliceSec: sliceDur, finalAudioSec: finalAudioDur, finalVideoSec: finalVideoDur, correlation, finalWidth: finalVideo?.width, finalHeight: finalVideo?.height, finalBytes: s6.bytes, finalSha256: s6.sha256 },
  final: { gcsUri: s6.gcsUri, url24h: signGsUriV4ReadUrl(s6.gcsUri, 24 * 3600) },
  shots: s1.rows.map(r => ({
    id: r.id, kind: r.kind || "generated", shotSec: [r.startSec, r.endSec], usedInFinal: { offsetSec: r.offsetSec, durationSec: r.durationSec },
    reusedFrom: submitted[r.id]?.reusedFrom, taskId: submitted[r.id]?.taskId, model: submitted[r.id]?.model, mode: submitted[r.id]?.mode, duration: submitted[r.id]?.duration,
    generateAudio: (submitted[r.id]?.requestBody as any)?.generate_audio, counts: submitted[r.id]?.counts,
    prompt: (submitted[r.id]?.requestBody as any)?.prompt, promptSource: submitted[r.id]?.promptSource,
    references: { image_urls: (submitted[r.id]?.requestBody as any)?.image_urls, video_urls: (submitted[r.id]?.requestBody as any)?.video_urls, audio_urls: (submitted[r.id]?.requestBody as any)?.audio_urls,
      labels: { anchor: (s2.references[r.id]?.anchorImage as any)?.label, scenes: s2.references[r.id]?.sceneImages?.map((x: any) => x.label), motion: s2.references[r.id]?.motionVideos?.map((x: any) => `${x.label} ${x.inSec}–${x.outSec}s`) }, query: s2.queries[r.id] },
    clip: finals[r.id] ? { ...finals[r.id], url24h: finals[r.id].gcsUri ? signGsUriV4ReadUrl(finals[r.id].gcsUri!, 24 * 3600) : undefined } : undefined,
  })),
};
await putJson("checkpoints/99-verdict.json", summary);
await mark("99-verdict");
log("VERDICT", JSON.stringify(summary));
process.exitCode = summary.pass ? 0 : 1;

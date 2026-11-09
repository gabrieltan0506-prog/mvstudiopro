// 1109 用户人脸版 MV 高光：工作机 /app/isolated/mvface 实际执行的原样存档（绝对路径 import 仅在工作机有效；edit 探针用的是 shared/stockPhotoPersonEdit 的首版指令，生产版见同名 shared 文件）。
/**
 * MV 高光（d31a3a49）用户人脸版 · 阶段 B：Pexels 站位/运镜参考（送前自动裁）→ Seedance 2.5 r2v 720p 两段（EvoLink）→ 实测裁到目标 → 合成成片。
 * 工作机：FLY_PROCESS_GROUP=rig ./node_modules/.bin/tsx scripts/with-worker-probe-lease.mts ./node_modules/.bin/tsx /app/isolated/mvface/mvface-video.mts <runId>
 * 每步 GCS 检查点；EvoLink 提交/终态原始 JSON 与解析 JSON 分别永久保存。
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadGcsObject, signGsUriV4ReadUrl, uploadBufferToGcs } from "/app/server/services/gcs";
import { searchPexels } from "/app/server/services/stockFootage/pexelsClient";
import { adoptStockFootage } from "/app/server/services/stockFootage/adoption";
import { buildEvolinkSeedanceRequest, pollEvolinkVideoTaskOnce, submitEvolinkSeedanceVideo } from "/app/server/services/evolinkSeedanceVideo";

const run = promisify(execFile);
const BUCKET = "mv-studio-pro-vertex-video-temp";
const PROBE_USER = 999999001;
const SONG_GCS = "gs://mv-studio-pro-vertex-video-temp/uploads/u1/c48f203e-a20e-45a2-9e2d-777107c97bfd-1-.mp3";
const HL = { startSec: 18.2, endSec: 77.5 };
const LIP_END_IN_P1 = 17.8; // 36.0 秒前为真歌词演唱段（成片里镜头自带声静音）
/**
 * 镜头自带声静音窗（段内秒）：演唱段 + 抽查（melody.py：逐秒谐波性>0.6 且响度高）疑似音乐/人声旋律的部分。
 * P1 0–20.0：演唱段 0–17.8 + 17.8–20.0 谐波性 0.54–0.79；P2 9–12、16–23：谐波性 0.48–0.90。其余 −20 dB 环境层。
 */
const MUTE: Record<string, Array<[number, number]>> = { P1: [[0, 20.0]], P2: [[9, 12], [16, 23]] };
const volExpr = (id: string) => `volume='if(${MUTE[id]!.map(([a, b]) => `between(t,${a},${b})`).join("+")},0,0.1)':eval=frame`;
const FADE_IN = 0.3, FADE_OUT = 2.0; // 1109 蝴蝶落唇结尾：淡出 75.5–77.5
const [runId, picksArg = "", mode = "all"] = process.argv.slice(2);
/** 用户选图：如 K1e,K2,K4e,K7e（未列出的用纯生成版）。 */
const picks = new Map(picksArg.split(",").filter(Boolean).map(p => (p.includes(":") ? (p.split(":") as [string, string]) : ([p.replace(/e$/, ""), p] as [string, string]))));
if (!runId || !/^[a-z0-9-]{6,80}$/.test(runId)) throw Error("缺少 runId");
const base = `probes/mv-formal/${runId}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const putJson = async (name: string, value: unknown) => uploadBufferToGcs({ bucket: BUCKET, objectName: `${base}/${name}`, buffer: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
const getJson = async <T>(name: string): Promise<T | null> => { try { return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${base}/${name}` })).buffer.toString("utf8")) as T; } catch { return null; } };
const sign = (u: string, sec = 3 * 3600) => signGsUriV4ReadUrl(u, sec);
const work = await mkdtemp(path.join(tmpdir(), "mvface-"));
const probe = async (file: string) => JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,duration,r_frame_rate,nb_frames", "-of", "json", file])).stdout) as any;

const identity = (await getJson<any>("checkpoints/a1-identity.json"))!;
const images = { ...(await getJson<Record<string, any>>("checkpoints/a3-images.json"))!, ...((await getJson<Record<string, any>>("checkpoints/a5-edits.json")) || {}) };
const pick = (k: string) => images[picks.get(k) ?? k]!;
const prompts = JSON.parse(await readFile("/app/isolated/mvface/prompts.json", "utf8")) as { segments: Array<{ id: string; songStart: number; songEnd: number; targetSec: number; gen: number; outbound: string; windows: unknown[] }> };
await putJson("checkpoints/b0-prompts.json", prompts);

// ── 1. 站位/运镜参考片：Pexels 搜索 → 采用 → 取运动最强窗裁切（送前自动裁） ──
type Motion = { key: string; query: string; providerAssetId: string; assetId: string; label: string; sourceGcsUri: string; sourceSec: number; inSec: number; outSec: number; gcsUri: string; durationSec: number };
const MOTION_PLAN: Record<string, Array<{ key: string; queries: string[]; sec: number }>> = {
  P1: [
    { key: "P1-v1-confront", queries: ["couple argument rain night", "couple arguing street", "couple fight emotional"], sec: 6 },
    { key: "P1-v2b-walkaway", queries: ["woman walking away from camera night", "woman walking away", "back view woman walking street night"], sec: 5 },
  ],
  P2: [
    { key: "P2-v1b-umbrella", queries: ["dropping umbrella", "umbrella falls to the ground", "man drops umbrella in rain"], sec: 5 },
    { key: "P2-v2-butterfly", queries: ["butterfly flying landing", "butterfly flying slow motion", "butterfly flying"], sec: 4 },
  ],
};
const motions: Record<string, Motion> = (await getJson("checkpoints/b1-motion.json")) || {};
const usedIds = new Set(Object.values(motions).map(m => m.providerAssetId));
async function bestWindow(file: string, sourceSec: number, sec: number) {
  if (sourceSec <= sec + 0.05) return 0;
  const out = (await run("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-", "-an", "-f", "null", "-"], { maxBuffer: 64 << 20 })).stdout;
  const pts: Array<[number, number]> = [];
  let t = NaN;
  for (const line of out.split("\n")) {
    const m1 = /pts_time:([\d.]+)/.exec(line); if (m1) t = Number(m1[1]);
    const m2 = /scene_score=([\d.]+)/.exec(line); if (m2 && Number.isFinite(t)) pts.push([t, Number(m2[1])]);
  }
  let best = 0, bestScore = -1;
  for (let s = 0; s + sec <= sourceSec + 1e-6; s += 0.25) {
    const score = pts.filter(([x]) => x >= s && x < s + sec).reduce((a, [, v]) => a + v, 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return Math.round(best * 100) / 100;
}
for (const seg of Object.keys(MOTION_PLAN)) for (const plan of MOTION_PLAN[seg]!) {
  if (motions[plan.key]) continue;
  let picked: Motion | undefined;
  for (const query of plan.queries) {
    for (const orientation of ["portrait", "landscape"] as const) {
      const search = await searchPexels({ query, kind: "video", orientation, page: 1, perPage: 15, purpose: "manhua", minDurationSec: plan.sec, maxDurationSec: 60 } as any);
      await putJson(`raw/pexels-video-${plan.key}-${createHash("sha1").update(query + orientation).digest("hex").slice(0, 8)}.json`, { query, orientation, result: search });
      for (const c of search.candidates) {
        if (usedIds.has(c.providerAssetId)) continue;
        const res = await adoptStockFootage(PROBE_USER, { requestId: randomUUID(), providerAssetId: c.providerAssetId, kind: "video", purpose: "manhua", usage: "reference", orientation, context: { projectId: `probe-${runId}`, shotId: plan.key, note: "mv face staging ref" } } as any);
        await putJson(`raw/adopt-video-${c.providerAssetId}.json`, res);
        if (res.status !== "succeeded" || !res.asset) continue;
        usedIds.add(c.providerAssetId);
        const src = path.join(work, `${plan.key}-src.mp4`);
        await writeFile(src, (await downloadGcsObject({ gcsUri: res.asset.gcsUri })).buffer);
        const sourceSec = Number((await probe(src)).format?.duration);
        const inSec = await bestWindow(src, sourceSec, plan.sec);
        const outSec = Math.min(sourceSec, inSec + plan.sec);
        const dst = path.join(work, `${plan.key}.mp4`);
        await run("ffmpeg", ["-y", "-v", "error", "-ss", String(inSec), "-i", src, "-t", String(outSec - inSec), "-vf", "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)',fps=30", "-an", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst]);
        const buf = await readFile(dst);
        const objectName = `${base}/motion/${plan.key}.mp4`;
        await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "video/mp4" });
        picked = { key: plan.key, query, providerAssetId: c.providerAssetId, assetId: res.asset.assetId, label: `${res.asset.source.author.name} / Pexels`, sourceGcsUri: res.asset.gcsUri, sourceSec, inSec, outSec, gcsUri: `gs://${BUCKET}/${objectName}`, durationSec: Number((await probe(dst)).format?.duration) };
        break;
      }
      if (picked) break;
    }
    if (picked) break;
  }
  if (!picked) throw Error(`图库没有可采用的参考片：${plan.key}`);
  motions[plan.key] = picked;
  await putJson("checkpoints/b1-motion.json", motions);
  log("motion", plan.key, picked.label, `${picked.inSec}-${picked.outSec}/${picked.sourceSec}s`);
}

if (mode === "refs") { console.log("REFS_ONLY", JSON.stringify(motions)); process.exit(0); }
await putJson("checkpoints/b1b-picks.json", { picks: Object.fromEntries(picks), at: new Date().toISOString() });
// ── 2. 提交两段（Seedance 2.5 reference_to_video · 720p · 9:16 · EvoLink · 放宽真人限制） ──
const REFS: Record<string, { images: string[]; videos: string[] }> = {
  P1: { images: [identity.face.gcsUri, images.W.gcsUri, pick("K1").gcsUri, pick("K2").gcsUri, pick("K3").gcsUri, pick("K4").gcsUri], videos: [motions["P1-v1-confront"]!.gcsUri] },
  P2: { images: [identity.face.gcsUri, pick("K5").gcsUri, pick("K6").gcsUri, pick("K7").gcsUri, pick("K8").gcsUri], videos: [motions["P2-v2-butterfly"]!.gcsUri] },
};
type Sub = { taskId: string; model: string; mode: string; duration: number; body: Record<string, unknown>; prompt: string; submittedAt: string };
type Fin = { state: string; error?: string; gcsUri?: string; bytes?: number; sha256?: string; durationSec?: number; width?: number; height?: number; fps?: string; hasAudio?: boolean; finishedAt?: string; usage?: unknown };
const submitted: Record<string, Sub> = (await getJson("checkpoints/b2-submitted.json")) || {};
const finals: Record<string, Fin> = (await getJson("checkpoints/b3-final.json")) || {};
for (const seg of prompts.segments) {
  if (submitted[seg.id]) continue;
  if (mode !== "all") throw Error(`${seg.id} 无提交记录，${mode} 模式不新建任务`);
  const refs = REFS[seg.id]!;
  const vidSec = refs.videos.reduce((a, g) => a + (Object.values(motions).find(m => m.gcsUri === g)?.durationSec || 0), 0);
  if (vidSec > 30) throw Error(`${seg.id} 参考视频合计 ${vidSec}s > 30s`);
  const input = { prompt: seg.outbound, version: "2.5" as const, mode: "reference_to_video" as const, quality: "720p", aspectRatio: "9:16", duration: seg.gen, generateAudio: true, contentFilter: false, imageUrls: refs.images.map(u => sign(u)), videoUrls: refs.videos.map(u => sign(u)), audioUrls: [] as string[] };
  const built = buildEvolinkSeedanceRequest(input as any);
  const redacted = { ...built.body, image_urls: refs.images, video_urls: refs.videos, audio_urls: [] };
  await putJson(`raw/${seg.id}-request.json`, { segment: seg.id, body: redacted, model: built.model, referenceVideoSec: vidSec });
  const result = await submitEvolinkSeedanceVideo({ ...(input as any), persistSubmitReceipt: async (receipt: unknown) => { await putJson(`raw/${seg.id}-submit-raw.json`, receipt); } });
  const raw = await getJson<{ body: string }>(`raw/${seg.id}-submit-raw.json`);
  let parsed: unknown; try { parsed = JSON.parse(raw?.body || ""); } catch { parsed = { invalidJson: true }; }
  await putJson(`raw/${seg.id}-submit-parsed.json`, parsed);
  submitted[seg.id] = { taskId: result.evolinkTaskId, model: result.model, mode: result.mode, duration: built.duration, body: redacted, prompt: String(built.body.prompt), submittedAt: new Date().toISOString() };
  await putJson("checkpoints/b2-submitted.json", submitted);
  log("SUBMITTED", seg.id, result.evolinkTaskId, result.model, "dur", built.duration);
}

// ── 3. 轮询 → 立即镜像回 GCS → ffprobe ──
const deadline = Date.now() + 60 * 60_000;
while (prompts.segments.some(s => !finals[s.id]) && Date.now() < deadline) {
  for (const seg of prompts.segments) {
    if (finals[seg.id]) continue;
    let terminalBody = "";
    const snap = await pollEvolinkVideoTaskOnce(submitted[seg.id]!.taskId, "Seedance 2.5", async receipt => {
      terminalBody = receipt.body;
      await putJson(`raw/${seg.id}-terminal-raw.json`, receipt);
      let parsed: unknown; try { parsed = JSON.parse(receipt.body); } catch { parsed = { invalidJson: true }; }
      await putJson(`raw/${seg.id}-terminal-parsed.json`, parsed);
    });
    if (snap.state === "running") continue;
    let usage: unknown; try { const j = JSON.parse(terminalBody); usage = j.usage ?? j.billing ?? j.credits ?? null; } catch { /* 已原样落盘 */ }
    if (snap.state === "failed") { finals[seg.id] = { state: "failed", error: snap.error, usage }; }
    else {
      const buf = Buffer.from(await (await fetch(snap.sourceUrl)).arrayBuffer());
      const objectName = `${base}/videos/${seg.id}-raw.mp4`;
      await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "video/mp4" });
      const file = path.join(work, `${seg.id}.mp4`);
      await writeFile(file, buf);
      const pr = await probe(file);
      const v = (pr.streams || []).find((x: any) => x.codec_type === "video");
      finals[seg.id] = { state: "completed", gcsUri: `gs://${BUCKET}/${objectName}`, bytes: buf.length, sha256: sha(buf), durationSec: Number(pr.format?.duration), width: v?.width, height: v?.height, fps: v?.r_frame_rate, hasAudio: (pr.streams || []).some((x: any) => x.codec_type === "audio"), finishedAt: new Date().toISOString(), usage };
    }
    await putJson("checkpoints/b3-final.json", finals);
    log("FINAL", seg.id, JSON.stringify(finals[seg.id]));
  }
  if (prompts.segments.some(s => !finals[s.id])) await new Promise(r => setTimeout(r, 15_000)); // 轮询间隔（命令在跑，租约覆盖）
}
const failed = prompts.segments.filter(s => finals[s.id]?.state !== "completed");
if (failed.length) { await putJson("checkpoints/99-verdict.json", { runId, pass: false, blockers: failed.map(s => `${s.id}：${finals[s.id]?.error || "轮询超时"}`), submitted }); throw Error(`未出片：${failed.map(s => s.id).join(",")}`); }

if (mode === "poll") {
  console.log("CLIPS", JSON.stringify(prompts.segments.map(sg => ({ id: sg.id, taskId: submitted[sg.id]!.taskId, measuredSec: finals[sg.id]!.durationSec, url24h: sign(finals[sg.id]!.gcsUri!, 24 * 3600) }))));
  process.exit(0);
}
// ── 4. 合成：实测裁到目标（不变速）→ 帧精确拼接 → 原歌 0 dB 主轨 + 镜头环境层（演唱段静音、其余 −20 dB）→ 首 0.3s 淡入 / 尾 2.5s 音画同步淡出 ──
let s4 = await getJson<any>("checkpoints/b4-assemble.json");
if (!s4) {
  const seg1 = prompts.segments[0]!, seg2 = prompts.segments[1]!;
  const files: string[] = [];
  for (const s of [seg1, seg2]) {
    const f = path.join(work, `${s.id}.mp4`);
    await writeFile(f, (await downloadGcsObject({ gcsUri: finals[s.id]!.gcsUri! })).buffer);
    files.push(f);
    if (finals[s.id]!.durationSec! + 1e-3 < s.targetSec) throw Error(`${s.id} 实测 ${finals[s.id]!.durationSec}s 短于目标 ${s.targetSec}s`);
  }
  const song = path.join(work, "song.mp3");
  await writeFile(song, (await downloadGcsObject({ gcsUri: SONG_GCS })).buffer);
  const T1 = seg1.targetSec, T2 = seg2.targetSec, T = Math.round((HL.endSec - HL.startSec) * 1000) / 1000;
  const fps = 30;
  const F1 = Math.round(T1 * fps), F2 = Math.round(T2 * fps);
  const hasA = (id: string) => finals[id]!.hasAudio;
  const vf = [
    `[0:v]trim=start_frame=0,setpts=PTS-STARTPTS,fps=${fps},scale=720:1280:flags=lanczos,setsar=1,trim=end_frame=${F1},setpts=PTS-STARTPTS[v0]`,
    `[1:v]trim=start_frame=0,setpts=PTS-STARTPTS,fps=${fps},scale=720:1280:flags=lanczos,setsar=1,trim=end_frame=${F2},setpts=PTS-STARTPTS[v1]`,
    `[v0][v1]concat=n=2:v=1:a=0,fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${(T - FADE_OUT).toFixed(3)}:d=${FADE_OUT}[v]`,
    `[2:a]atrim=start=${HL.startSec}:end=${HL.endSec},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[song]`,
    hasA("P1") ? `[0:a]atrim=0:${T1},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${volExpr("P1")}[a0]` : `anullsrc=r=48000:cl=stereo,atrim=0:${T1}[a0]`,
    hasA("P2") ? `[1:a]atrim=0:${T2},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${volExpr("P2")}[a1]` : `anullsrc=r=48000:cl=stereo,atrim=0:${T2}[a1]`,
    `[a0][a1]concat=n=2:v=0:a=1[amb]`,
    `[song][amb]amix=inputs=2:duration=first:normalize=0,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${(T - FADE_OUT).toFixed(3)}:d=${FADE_OUT}[a]`,
  ].join(";");
  const out = path.join(work, "final.mp4");
  const args = ["-y", "-v", "error", "-i", files[0]!, "-i", files[1]!, "-i", song, "-filter_complex", vf, "-map", "[v]", "-map", "[a]", "-t", String(T), "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
  await putJson("raw/assemble-ffmpeg.json", { args, filter: vf, T1, T2, F1, F2, fps, lipEndInP1: LIP_END_IN_P1, muteWindows: MUTE, fadeIn: FADE_IN, fadeOut: FADE_OUT, ambientGainDb: -20 });
  await run("ffmpeg", args, { maxBuffer: 64 << 20 });
  const buf = await readFile(out);
  const objectName = `${base}/final/mv-highlight-18.2-77.5-face-2p5.mp4`;
  await uploadBufferToGcs({ bucket: BUCKET, objectName, buffer: buf, contentType: "video/mp4" });
  const pr = await probe(out);
  s4 = { gcsUri: `gs://${BUCKET}/${objectName}`, bytes: buf.length, sha256: sha(buf), probe: pr, trims: { P1: { measuredSec: finals.P1!.durationSec, usedSec: F1 / fps, cutAt: F1 / fps }, P2: { measuredSec: finals.P2!.durationSec, usedSec: F2 / fps, cutAt: F2 / fps } }, cutSongSec: HL.startSec + F1 / fps };
  await putJson("checkpoints/b4-assemble.json", s4);
  log("ASSEMBLED", JSON.stringify(s4));
}

// ── 5. 断言：总长、主轨=原歌、剪点、淡出 ──
let s5 = await getJson<any>("checkpoints/b5-verify.json");
if (!s5 || mode === "reverify") {
  const fin = path.join(work, "final-check.mp4");
  await writeFile(fin, (await downloadGcsObject({ gcsUri: s4.gcsUri })).buffer);
  const song = path.join(work, "song-check.mp3");
  await writeFile(song, (await downloadGcsObject({ gcsUri: SONG_GCS })).buffer);
  const T = Math.round((HL.endSec - HL.startSec) * 1000) / 1000, R = 8000, FR = 1 / 30;
  const pcm = async (args: string[]) => { const b = (await run("ffmpeg", ["-v", "error", ...args, "-ac", "1", "-ar", String(R), "-f", "f32le", "-"], { maxBuffer: 256 << 20, encoding: "buffer" } as any)).stdout as unknown as Buffer; return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)); };
  const a = await pcm(["-i", fin, "-map", "0:a:0"]);
  const b = await pcm(["-ss", String(HL.startSec), "-t", String(T), "-i", song]);
  const env = (x: Float32Array, t1: number) => { const w = R / 100, o: number[] = []; for (let i = 0; i + w <= Math.min(x.length, t1 * R); i += w) { let q = 0; for (let j = i; j < i + w; j++) q += x[j]! * x[j]!; o.push(Math.sqrt(q / w)); } return o; };
  const pearson = (p: number[], q: number[]) => { const n = Math.min(p.length, q.length); const mp = p.slice(0, n).reduce((u, v) => u + v, 0) / n, mq = q.slice(0, n).reduce((u, v) => u + v, 0) / n; let c = 0, vp = 0, vq = 0; for (let i = 0; i < n; i++) { c += (p[i]! - mp) * (q[i]! - mq); vp += (p[i]! - mp) ** 2; vq += (q[i]! - mq) ** 2; } return c / Math.sqrt(vp * vq || 1); };
  const ea = env(a, T - FADE_OUT), eb = env(b, T - FADE_OUT);
  let bestLag = 0, bestC = -2;
  for (let lag = -20; lag <= 20; lag++) { const c = pearson(lag >= 0 ? ea.slice(lag) : ea, lag >= 0 ? eb : eb.slice(-lag)); if (c > bestC) { bestC = c; bestLag = lag; } }
  const rmsDb = (x: Float32Array, t0: number, t1: number) => { let q = 0, n = 0; for (let i = Math.floor(t0 * R); i < Math.min(x.length, Math.floor(t1 * R)); i++) { q += x[i]! * x[i]!; n++; } return n ? 10 * Math.log10(q / n + 1e-12) : -120; };
  const gain: number[] = []; for (let t = T - FADE_OUT; t + 0.25 <= T + 1e-6; t += 0.25) gain.push(rmsDb(a, t, t + 0.25) - rmsDb(b, t, t + 0.25));
  const tailDb = rmsDb(a, T - 0.1, T);
  const pr = await probe(fin);
  const v = (pr.streams || []).find((x: any) => x.codec_type === "video"), au = (pr.streams || []).find((x: any) => x.codec_type === "audio");
  const frames = Number((await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", fin])).stdout.trim());
  const lastPng = path.join(work, "last.png");
  await run("ffmpeg", ["-y", "-v", "error", "-sseof", "-0.1", "-i", fin, "-update", "1", lastPng]);
  const yavg = Number(/YAVG=([\d.]+)/.exec((await run("ffmpeg", ["-v", "error", "-i", lastPng, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"])).stdout)?.[1] ?? NaN);
  // 剪点：两侧帧差（场景分）在 29.6 s 处应为局部峰
  const sc = (await run("ffmpeg", ["-v", "error", "-ss", "28.6", "-t", "2", "-i", fin, "-vf", "scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-", "-an", "-f", "null", "-"], { maxBuffer: 16 << 20 })).stdout;
  const scenes: Array<[number, number]> = []; let tt = NaN;
  for (const line of sc.split("\n")) { const m1 = /pts_time:([\d.]+)/.exec(line); if (m1) tt = 28.6 + Number(m1[1]); const m2 = /scene_score=([\d.]+)/.exec(line); if (m2 && Number.isFinite(tt)) scenes.push([Math.round(tt * 1000) / 1000, Number(m2[1])]); }
  const peak = scenes.reduce((p, c) => (c[1] > p[1] ? c : p), [0, -1] as [number, number]);
  const cutSec = s4.trims.P1.usedSec;
  s5 = {
    totalLength: { pass: Math.abs(Number(v?.duration) - T) <= FR + 1e-3 && Math.abs(Number(au?.duration) - T) <= 0.05 && frames === Math.round(T * 30), videoSec: Number(v?.duration), audioSec: Number(au?.duration), frames, expectFrames: Math.round(T * 30), targetSec: T },
    mainTrackIsSong: { pass: bestC >= 0.9 && Math.abs(bestLag) * 0.01 <= FR + 1e-6, rmsEnvelopeCorr: Number(bestC.toFixed(4)), lagSec: bestLag * 0.01, audioStreams: (pr.streams || []).filter((x: any) => x.codec_type === "audio").length },
    cut: { pass: Math.abs(cutSec - 29.6) < 1e-6 && Math.abs(peak[0] - cutSec) <= FR + 1e-3, cutInFinalSec: cutSec, cutSongSec: Math.round((HL.startSec + cutSec) * 1000) / 1000, sceneScorePeakAt: peak[0], sceneScorePeak: peak[1], frameExact: Number.isInteger(Math.round(cutSec * 30)) && Math.abs(cutSec * 30 - Math.round(cutSec * 30)) < 1e-6 },
    fadeOut: { pass: gain.length >= 4 && gain.every((g, i) => i === 0 || g <= gain[i - 1]! + 2) && tailDb < -40 && yavg < 24, fromSec: T - FADE_OUT, gainVsSongDb: gain.map(g => Number(g.toFixed(1))), tailLast100msDb: Number(tailDb.toFixed(1)), lastFrameYavg: yavg },
  };
  await putJson("checkpoints/b5-verify.json", s5);
  log("VERIFY", JSON.stringify(s5));
}
const delivery = {
  runId, at: new Date().toISOString(),
  final: { url24h: sign(s4.gcsUri, 24 * 3600), gcsUri: s4.gcsUri, probe: s4.probe, trims: s4.trims, cutSongSec: s4.cutSongSec, verify: s5, muteWindows: MUTE },
  segments: prompts.segments.map(s => ({ id: s.id, song: [s.songStart, s.songEnd], targetSec: s.targetSec, requestedSec: submitted[s.id]!.duration, taskId: submitted[s.id]!.taskId, model: submitted[s.id]!.model, measuredSec: finals[s.id]!.durationSec, size: `${finals[s.id]!.width}x${finals[s.id]!.height}`, fps: finals[s.id]!.fps, hasAudio: finals[s.id]!.hasAudio, usage: finals[s.id]!.usage, url24h: sign(finals[s.id]!.gcsUri!, 24 * 3600), references: submitted[s.id]!.body.image_urls, videoReferences: submitted[s.id]!.body.video_urls })),
  motion: motions,
};
await putJson("checkpoints/99-verdict.json", delivery);
console.log("DELIVERY", JSON.stringify(delivery));

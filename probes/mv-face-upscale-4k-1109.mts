// 1109 用户人脸版 MV 成片 4K 超分：工作机 /app/isolated/mvface-upscale 实际执行的原样存档（绝对路径 import 仅在工作机有效）。
/**
 * 用户批准的唯一一单：成片 mv-highlight-18.2-77.5-face-2p5.mp4 → runWavespeedVideoUpscale(target=4k)。
 * 工作机：FLY_PROCESS_GROUP=rig ./node_modules/.bin/tsx scripts/with-worker-probe-lease.mts ./node_modules/.bin/tsx /app/isolated/mvface-upscale/upscale.mts
 * - 超分证据（request/submit/poll 原始 + 解析 + 回执）先落本地隔离目录，再每 30 秒与收尾时增量同步到 GCS，永不删除。
 * - 断点：GCS 已有 submit 回执且未见结果 → 只轮询该 predictionId，不再提交；request 已存而无 submit 回执 → 停手报告，不重提。
 * - 失败不换通道、不重试，原因写 upscale/checkpoints/failure.json。
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertWorkerProbeLease } from "/app/server/services/workerProbeLease";
import { downloadGcsObject, listGcsObjectNamesByPrefix, signGsUriV4ReadUrl, uploadBufferToGcs } from "/app/server/services/gcs";
import { pollWavespeedUpscaleOnce, runWavespeedVideoUpscale } from "/app/server/services/wavespeedVideoUpscale";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "/app/server/services/seedanceVideo";
import { wavespeedUpscaleUsdCost } from "/app/shared/wavespeedVideoUpscaleModels";

const run = promisify(execFile);
const BUCKET = "mv-studio-pro-vertex-video-temp";
const PROBE_USER = 999999001;
const RUN = "mvface-20261109t1615z";
const SOURCE = `gs://${BUCKET}/probes/mv-formal/${RUN}/final/mv-highlight-18.2-77.5-face-2p5.mp4`;
const BASE = `probes/mv-formal/${RUN}/upscale`;
const EVIDENCE_DIR = process.env.PHOTO_UPSCALE_EVIDENCE_DIR || "";
if (!EVIDENCE_DIR.startsWith("/app/isolated/mvface-upscale/")) throw Error("PHOTO_UPSCALE_EVIDENCE_DIR 必须指向隔离目录");
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const putJson = (name: string, value: unknown) => uploadBufferToGcs({ bucket: BUCKET, objectName: `${BASE}/${name}`, buffer: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
const getJson = async <T,>(name: string): Promise<T | null> => { try { return JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${BASE}/${name}` })).buffer.toString("utf8")) as T; } catch { return null; } };

// ── 证据同步：本地 → GCS（只增不删；已传过的按名跳过） ──
const synced = new Set<string>(await listGcsObjectNamesByPrefix({ bucket: BUCKET, prefix: `${BASE}/evidence/`, allPages: true }));
async function syncEvidence() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  for (const sub of await readdir(EVIDENCE_DIR)) {
    for (const f of await readdir(path.join(EVIDENCE_DIR, sub))) {
      const obj = `${BASE}/evidence/${sub}/${f}`;
      if (synced.has(obj)) continue;
      await uploadBufferToGcs({ bucket: BUCKET, objectName: obj, buffer: await readFile(path.join(EVIDENCE_DIR, sub, f)), contentType: "application/json" });
      synced.add(obj);
    }
  }
}
async function evidenceByPhase(phase: string) {
  const out: Array<{ obj: string; json: any }> = [];
  for (const obj of synced) {
    if (!obj.includes(`/${phase}-`) || !obj.endsWith("-parsed.json")) continue;
    out.push({ obj, json: JSON.parse((await downloadGcsObject({ gcsUri: `gs://${BUCKET}/${obj}` })).buffer.toString("utf8")) });
  }
  return out;
}

const work = await mkdtemp(path.join(tmpdir(), "mvface-upscale-"));
const ffprobe = async (file: string) => JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,bit_rate,size:stream=index,codec_type,codec_name,width,height,duration,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels,bit_rate", "-of", "json", file])).stdout);
/** 50ms 窗 RMS 包络（16kHz 单声道），用于原片/超分片音轨一致性相关。 */
async function envelope(file: string) {
  const pcm = (await run("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 256 << 20 })).stdout as unknown as Buffer;
  const f = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const win = 800, env: number[] = [];
  for (let i = 0; i + win <= f.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += f[j]! * f[j]!; env.push(Math.sqrt(s / win)); }
  return env;
}
function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length); if (n < 2) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]!; mb += b[i]!; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i]! - ma, y = b[i]! - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}
/** 允许 ±10 窗（±0.5s）对齐偏移，取最大相关并报偏移。 */
function bestLagCorr(a: number[], b: number[]) {
  let best = { lag: 0, r: -2 };
  for (let lag = -10; lag <= 10; lag++) {
    const r = lag >= 0 ? pearson(a.slice(lag), b) : pearson(a, b.slice(-lag));
    if (r > best.r) best = { lag, r };
  }
  return best;
}
const gsFromSignedUrl = (u: string) => { const p = new URL(u); const [bucket, ...rest] = p.pathname.replace(/^\//, "").split("/"); return `gs://${bucket}/${rest.map(decodeURIComponent).join("/")}`; };

await assertWorkerProbeLease();
log("probe user", PROBE_USER, "source", SOURCE);
const done = await getJson<any>("checkpoints/result.json");
const srcFile = path.join(work, "source.mp4");
const srcBuf = (await downloadGcsObject({ gcsUri: SOURCE })).buffer;
await writeFile(srcFile, srcBuf);
const srcProbe = await ffprobe(srcFile);
const srcDur = Number(srcProbe.format.duration);
await putJson("checkpoints/u0-source.json", { gcsUri: SOURCE, bytes: srcBuf.length, sha256: sha(srcBuf), ffprobe: srcProbe, estUsd: wavespeedUpscaleUsdCost("4k", srcDur) });
log("source", srcBuf.length, "bytes", srcDur, "s", "est $", wavespeedUpscaleUsdCost("4k", srcDur).toFixed(4));

let mirroredUrl: string, predictionId: string;
const ticker = setInterval(() => { void syncEvidence().catch(e => log("evidence sync warn", String(e))); }, 30_000);
try {
  if (done?.mirroredGcsUri) {
    log("已有结果，跳过超分，只做核验");
    mirroredUrl = signGsUriV4ReadUrl(done.mirroredGcsUri, 3600); predictionId = done.predictionId;
  } else {
    await syncEvidence();
    const submits = await evidenceByPhase("submit");
    const requests = await evidenceByPhase("request");
    if (submits.length > 1) throw Error(`发现 ${submits.length} 份提交回执，拒绝继续，需人工对账`);
    if (submits.length === 1) {
      const d = submits[0]!.json?.data ?? submits[0]!.json; predictionId = String(d?.id || "");
      if (!predictionId) throw Error("已有提交回执但无 predictionId，拒绝重提，需人工对账");
      log("断点续跑：只轮询", predictionId);
      for (;;) {
        await new Promise(r => setTimeout(r, 2000));
        const s = await pollWavespeedUpscaleOnce(predictionId);
        if (s.state === "failed") throw Error(s.error);
        if (s.state === "completed") { mirroredUrl = await mirrorSeedanceMp4ToGcsSignedUrl(s.sourceUrl); break; }
      }
    } else if (requests.length) {
      throw Error("已有提交前请求证据但无提交回执（结果未知），拒绝重提，需人工对账");
    } else {
      log("提交 runWavespeedVideoUpscale target=4k");
      await putJson("checkpoints/u1-submit-intent.json", { at: new Date().toISOString(), target: "4k", source: SOURCE, probeUser: PROBE_USER });
      const r = await runWavespeedVideoUpscale({ videoUrl: SOURCE, target: "4k" });
      mirroredUrl = r.videoUrl; predictionId = r.predictionId;
    }
  }
} catch (e) {
  clearInterval(ticker); await syncEvidence().catch(() => {});
  await putJson("checkpoints/failure.json", { at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) });
  log("FAILED", e instanceof Error ? e.message : String(e));
  process.exit(2);
}
clearInterval(ticker); await syncEvidence();
const mirroredGcsUri = gsFromSignedUrl(mirroredUrl);
log("mirrored", mirroredGcsUri, "prediction", predictionId);

// ── 下载、留档到 upscale/、核验 ──
const outBuf = (await downloadGcsObject({ gcsUri: mirroredGcsUri })).buffer;
const outFile = path.join(work, "out-4k.mp4");
await writeFile(outFile, outBuf);
const finalObj = `${BASE}/mv-highlight-18.2-77.5-face-2p5-4k.mp4`;
await uploadBufferToGcs({ bucket: BUCKET, objectName: finalObj, buffer: outBuf, contentType: "video/mp4" });
const outProbe = await ffprobe(outFile);
const v = (p: any) => p.streams.find((s: any) => s.codec_type === "video");
const a = (p: any) => p.streams.find((s: any) => s.codec_type === "audio");
const outDur = Number(outProbe.format.duration);
const [envSrc, envOut] = [await envelope(srcFile), a(outProbe) ? await envelope(outFile) : []];
const corr = envOut.length ? bestLagCorr(envSrc, envOut) : null;
const ov = v(outProbe);
const checks = {
  resolution4kPortrait: ov && Math.min(ov.width, ov.height) >= 2160 && ov.height > ov.width,
  durationMatch: Math.abs(outDur - srcDur) <= 0.1,
  audioPresent: Boolean(a(outProbe)),
  audioEnvelopeCorr: corr ? corr.r >= 0.98 : false,
};
const verdict = {
  at: new Date().toISOString(), predictionId, mirroredGcsUri, finalGcsUri: `gs://${BUCKET}/${finalObj}`,
  bytes: outBuf.length, sha256: sha(outBuf),
  source: { durationSec: srcDur, video: v(srcProbe), audio: a(srcProbe) },
  output: { durationSec: outDur, video: ov, audio: a(outProbe), format: outProbe.format },
  audio: { srcWindows: envSrc.length, outWindows: envOut.length, lagWindows50ms: corr?.lag, pearson: corr?.r },
  usd: { billedSec: srcDur, rate: 0.0288, total: wavespeedUpscaleUsdCost("4k", srcDur) },
  checks, pass: Object.values(checks).every(Boolean),
};
await putJson("checkpoints/result.json", { predictionId, mirroredGcsUri, finalGcsUri: verdict.finalGcsUri });
await putJson("verify.json", verdict);
const url = signGsUriV4ReadUrl(verdict.finalGcsUri, 24 * 3600);
await writeFile(path.join(path.dirname(EVIDENCE_DIR), "signed-24h.txt"), url);
log("VERDICT", JSON.stringify({ ...verdict, source: undefined }, null, 0));
log("SIGNED_URL_FILE", path.join(path.dirname(EVIDENCE_DIR), "signed-24h.txt"));

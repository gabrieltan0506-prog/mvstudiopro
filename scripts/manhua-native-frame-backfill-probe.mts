/**
 * 关键帧回填探针（¥0，零模型调用）：给已完成的两段探针轮补抽逐镜关键帧。
 * 重新解析 0996 片源拿媒体流，按该轮 parsed 段卡的 story 镜头中点各抽一帧，
 * 永久存 GCS probes/<run>/frames/，并写 frames-summary.json。广告镜头不抽。
 * 用法：--run=probe_full_20260828142350 --url=https://www.gzcrkt8888.com/vod/play/...
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fetchManhua0996EpisodePlayback } from "../server/services/manhuaLearn0996Source.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const run = promisify(execFile);
const RUN = String(process.argv.find((a) => a.startsWith("--run="))?.slice(6) || "").trim();
const URL_ARG = String(process.argv.find((a) => a.startsWith("--url="))?.slice(6) || "").trim();
if (!RUN || !URL_ARG) throw new Error("缺少 --run= 或 --url=");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

const bucket = getGcsBucketName();

async function main() {
  console.info(`[frames] 阶段：解析片源媒体地址`);
  const playback = await fetchManhua0996EpisodePlayback(URL_ARG);
  const mediaUrl = playback.playbackUrls[0];
  if (!mediaUrl) throw new Error("未解析到媒体地址");
  console.info(`[frames] 阶段：读取 ${RUN} parsed 段卡`);
  const names = await listGcsObjectNamesByPrefix({
    prefix: `manhua-template-learn/segment-evidence/tpl_native_${RUN}_ep001/`,
    literalPrefix: true,
    maxResults: 20,
  });
  const frames: Array<{ segmentIndex: number; shotIndex: number; atSec: number; objectName: string; bytes: number }> = [];
  const errors: string[] = [];
  for (const name of names.sort()) {
    const { buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` });
    const entry = JSON.parse(buffer.toString("utf8")) as {
      segmentIndex: number; raw?: { shots?: Array<Record<string, unknown>> };
    };
    const shots = Array.isArray(entry.raw?.shots) ? entry.raw.shots : [];
    for (let shotIndex = 0; shotIndex < shots.length && frames.length < 240; shotIndex += 1) {
      const shot = shots[shotIndex]!;
      if (shot.evidenceRole === "non_story_ad") continue;
      const startSec = Number(shot.startSec) || 0;
      const endSec = Math.max(startSec, Number(shot.endSec) || startSec);
      const atSec = Math.round(((startSec + endSec) / 2) * 10) / 10;
      const local = `/tmp/backfill-frame-${entry.segmentIndex}-${shotIndex}.jpg`;
      try {
        await run("ffmpeg", [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "-headers", `Referer: ${playback.referer}\r\n`,
          "-ss", String(atSec), "-i", mediaUrl, "-frames:v", "1", "-q:v", "4", local,
        ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
        const jpg = await readFile(local);
        const objectName = `manhua-template-learn/probes/${RUN}/frames/seg${entry.segmentIndex}/shot${String(shotIndex).padStart(3, "0")}-${Math.round(atSec * 10)}ds.jpg`;
        await uploadBufferToGcsIfAbsent({ bucket, objectName, contentType: "image/jpeg", buffer: jpg });
        frames.push({ segmentIndex: entry.segmentIndex, shotIndex, atSec, objectName, bytes: jpg.byteLength });
        await rm(local, { force: true });
        if (frames.length % 20 === 0) console.info(`[frames] 已抽 ${frames.length} 帧`);
      } catch (error) {
        errors.push(`seg${entry.segmentIndex}#${shotIndex}@${atSec}s ${error instanceof Error ? error.message : String(error)}`.slice(0, 120));
        await rm(local, { force: true }).catch(() => {});
      }
    }
  }
  const summary = { schemaVersion: 1, runId: RUN, stage: "frame_backfill", frames, errors: errors.length ? errors : undefined };
  const buf = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: `manhua-template-learn/probes/${RUN}/frames-summary.json`,
    contentType: "application/json",
    buffer: buf,
  });
  console.info(JSON.stringify({ runId: RUN, frameCount: frames.length, errorCount: errors.length, sha256: createHash("sha256").update(buf).digest("hex") }));
}

main().catch((error) => {
  console.error(`[frames] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

/**
 * MV 参考片送出前自动裁切（1109）：参考片是整条送给模型的，所以按 planMvMotionTrim 裁成
 * min(本镜时长, 所选模型单条上限) 的派生片；入点用户指定优先，否则取运动最强的一段（帧差均值）。
 * 只裁不变速、去掉音轨（参考片只取站位/运镜，声音不参与）；派生片落本人图库空间，原素材不动。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execHeavyMedia } from "./heavyMediaProcess";
import { downloadGcsObject, getGcsBucketName, uploadBufferToGcs } from "./gcs";
import { parseGsUri } from "./postProdMediaSource";
import { planMvMotionTrim } from "../../shared/canvasMusicMvReferences";

const STEP = 0.2;

/** 每 0.2 秒一个帧差均值（缩到 64 宽、5fps、相邻帧差的亮度均值）。 */
async function motionScores(file: string): Promise<number[]> {
  const meta = `${file}.motion.txt`;
  await execHeavyMedia("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", `fps=${1 / STEP},scale=64:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${meta}`, "-f", "null", "-"], { timeout: 120_000 });
  const text = await readFile(meta, "utf8").catch(() => "");
  return text.split("\n").filter(l => l.includes("YAVG=")).map(l => Number(l.split("=")[1]) || 0);
}

export async function trimMvMotionClip(
  userId: number,
  input: { sourceGcsUri: string; shotSec: number; maxSec: number; inSec?: number },
): Promise<{ gcsUri: string; inSec: number; outSec: number; durationSec: number; sourceSec: number; auto: boolean }> {
  const parsed = parseGsUri(input.sourceGcsUri);
  const bucket = getGcsBucketName();
  // 只裁本人图库素材或本人白模产物，不读他人对象
  if (!parsed || parsed.bucket !== bucket || !(parsed.objectName.startsWith(`stock-footage/${userId}/`) || parsed.objectName.startsWith(`post-prod/${userId}/previs/`)))
    throw new Error("只能裁切本人空间里的参考片");
  const dir = await mkdtemp(path.join(tmpdir(), "mv-motion-"));
  try {
    const src = path.join(dir, "src.mp4");
    await writeFile(src, (await downloadGcsObject({ gcsUri: input.sourceGcsUri })).buffer);
    const { stdout } = await execHeavyMedia("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", src], { timeout: 30_000 });
    const sourceSec = Number(JSON.parse(String(stdout)).format?.duration);
    if (!Number.isFinite(sourceSec) || sourceSec <= 0) throw new Error("参考片时长不可读");
    const plan = planMvMotionTrim({
      sourceSec, shotSec: input.shotSec, maxSec: input.maxSec, inSec: input.inSec,
      ...(input.inSec === undefined ? { motionScores: await motionScores(src), stepSec: STEP } : {}),
    });
    const out = path.join(dir, "trim.mp4");
    await execHeavyMedia("ffmpeg", ["-y", "-v", "error", "-ss", String(plan.inSec), "-i", src, "-t", String(plan.lengthSec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out], { timeout: 180_000 });
    const buf = await readFile(out);
    const key = createHash("sha256").update(`${input.sourceGcsUri}:${plan.inSec}:${plan.lengthSec}`).digest("hex").slice(0, 32);
    const objectName = `stock-footage/${userId}/trim/${key}.mp4`;
    await uploadBufferToGcs({ bucket, objectName, buffer: buf, contentType: "video/mp4" });
    return { gcsUri: `gs://${bucket}/${objectName}`, inSec: plan.inSec, outSec: plan.outSec, durationSec: plan.lengthSec, sourceSec, auto: plan.auto };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

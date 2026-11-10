/**
 * MV 素材填充镜头合成（1109）：吟唱区间不对口型，按顾问逐窗建议把 Pexels 视频直接剪入、照片做推近/拉远，
 * 每窗按帧精确时长（round(秒×30)）渲染后拼成一条与镜头等长的片段（无声，成片整段贴原歌）。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execHeavyMedia } from "./heavyMediaProcess";
import { downloadGcsObject, getGcsBucketName, uploadBufferToGcs } from "./gcs";
import { parseGsUri } from "./postProdMediaSource";
import { planMvMotionTrim } from "../../shared/canvasMusicMvReferences";

const FPS = 30;
export type FillWindowSource = { startSec: number; endSec: number; kind: "video" | "photo"; gcsUri: string; cameraZh?: string; inSec?: number };

async function motionScores(file: string): Promise<number[]> {
  const meta = `${file}.motion.txt`;
  await execHeavyMedia("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", `fps=5,scale=64:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${meta}`, "-f", "null", "-"], { timeout: 120_000 });
  const text = await readFile(meta, "utf8").catch(() => "");
  return text.split("\n").filter(l => l.includes("YAVG=")).map(l => Number(l.split("=")[1]) || 0);
}

export async function buildMvFillShot(
  userId: number,
  input: { shotId: string; windows: FillWindowSource[]; aspect: "9:16" | "16:9" },
): Promise<{ gcsUri: string; durationSec: number; frames: number; windows: Array<FillWindowSource & { frames: number; usedInSec?: number }> }> {
  const bucket = getGcsBucketName();
  for (const w of input.windows) {
    const p = parseGsUri(w.gcsUri);
    if (!p || p.bucket !== bucket || !p.objectName.startsWith(`stock-footage/${userId}/`)) throw new Error("素材填充只能用本人已采用的图库素材");
  }
  const [W, H] = input.aspect === "9:16" ? [720, 1280] : [1280, 720];
  const dir = await mkdtemp(path.join(tmpdir(), "mv-fill-"));
  try {
    const parts: string[] = [];
    const used: Array<FillWindowSource & { frames: number; usedInSec?: number }> = [];
    let totalFrames = 0;
    for (let i = 0; i < input.windows.length; i++) {
      const w = input.windows[i]!;
      const frames = Math.round(w.endSec * FPS) - Math.round(w.startSec * FPS);
      if (frames < 15) throw new Error(`第${i + 1}窗不足半秒`);
      totalFrames += frames;
      const src = path.join(dir, `src-${i}`);
      await writeFile(src, (await downloadGcsObject({ gcsUri: w.gcsUri })).buffer);
      const out = path.join(dir, `part-${i}.mp4`);
      const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p`;
      if (w.kind === "video") {
        const { stdout } = await execHeavyMedia("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", src], { timeout: 30_000 });
        const sourceSec = Number(JSON.parse(String(stdout)).format?.duration);
        const plan = planMvMotionTrim({ sourceSec, shotSec: frames / FPS, maxSec: frames / FPS, inSec: w.inSec, ...(w.inSec === undefined ? { motionScores: await motionScores(src), stepSec: 0.2 } : {}) });
        if (sourceSec + 1e-6 < frames / FPS) throw new Error(`第${i + 1}窗素材只有 ${sourceSec.toFixed(1)} 秒，不够 ${(frames / FPS).toFixed(2)} 秒`);
        await execHeavyMedia("ffmpeg", ["-y", "-v", "error", "-ss", String(plan.inSec), "-i", src, "-an", "-vf", fit, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out], { timeout: 180_000 });
        used.push({ ...w, frames, usedInSec: plan.inSec });
      } else {
        // 照片推拉：推近（默认）1.0→1.15，「拉」1.15→1.0，「移」横移
        const pull = /拉/.test(w.cameraZh || "");
        const pan = /移|摇/.test(w.cameraZh || "") && !/推|拉/.test(w.cameraZh || "");
        const step = (0.15 / frames).toFixed(6);
        const z = pull ? `if(eq(on,0),1.15,max(zoom-${step},1.0))` : pan ? "1.12" : `min(zoom+${step},1.15)`;
        const x = pan ? `(iw-iw/zoom)*on/${frames}` : "iw/2-(iw/zoom/2)";
        await execHeavyMedia("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-i", src, "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='${x}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out], { timeout: 180_000 });
        used.push({ ...w, frames });
      }
      parts.push(out);
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, parts.map(p => `file '${p}'`).join("\n"));
    const final = path.join(dir, "fill.mp4");
    await execHeavyMedia("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-movflags", "+faststart", final], { timeout: 240_000 });
    const buf = await readFile(final);
    const key = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
    // post-prod/<本人>/ 前缀：合成入口按本人产物放行（resolveRegisteredPostProdMediaSource）
    const objectName = `post-prod/${userId}/mv-fill/${input.shotId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${key}.mp4`;
    await uploadBufferToGcs({ bucket, objectName, buffer: buf, contentType: "video/mp4" });
    return { gcsUri: `gs://${bucket}/${objectName}`, durationSec: totalFrames / FPS, frames: totalFrames, windows: used };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

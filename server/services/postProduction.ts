/**
 * 后期工坊核心(蓝图二①,2026-08-20):拼接 / BGM 贴装 / 响度验收。
 * 纯 ffmpeg + 规则引擎,零大模型 token;配方全部来自《雷击》《天雷劫》实弹工艺:
 * - BGM 永远后期贴(0.48 规):侧链压对白、入场淡入、尾部淡出;
 * - 响度验收 = ebur128 整体 + 分窗 RMS + 双轨三查(时长/分辨率/音轨在不在)。
 * 输入接受 gs:// 或 https URL;产物一律落 GCS,返回 gcsUri + 7 天签名链。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { downloadGcsObject, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";

const execFileAsync = promisify(execFile);
/** 拼接单次上限:超过说明该走多轮,防一条命令吃满机器 */
export const MAX_CONCAT_CLIPS = 12;

async function fetchToFile(uriOrUrl: string, filePath: string): Promise<void> {
  const src = String(uriOrUrl || "").trim();
  if (src.startsWith("gs://")) {
    const { buffer } = await downloadGcsObject({ gcsUri: src });
    await writeFile(filePath, buffer);
    return;
  }
  if (!/^https:\/\//.test(src)) throw new Error("素材地址仅接受 gs:// 或 https://");
  const res = await fetch(src);
  if (!res.ok) throw new Error(`素材下载失败 HTTP ${res.status}`);
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
}

async function uploadResult(params: {
  filePath: string;
  userId: string;
  kind: string;
  ext: string;
  contentType: string;
}): Promise<{ gcsUri: string; url: string; bytes: number }> {
  const buffer = await readFile(params.filePath);
  const safeUser = String(params.userId).replace(/[^0-9a-zA-Z_-]/g, "");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const objectName = `post-prod/${safeUser}/${stamp}/${params.kind}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${params.ext}`;
  const { gcsUri } = await uploadBufferToGcs({
    objectName,
    buffer,
    contentType: params.contentType,
  });
  return { gcsUri, url: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600), bytes: buffer.length };
}

async function probe(filePath: string): Promise<{
  durationSec: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
}> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath,
  ]);
  const info = JSON.parse(String(stdout)) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }>;
  };
  const v = (info.streams || []).find((s) => s.codec_type === "video");
  const a = (info.streams || []).find((s) => s.codec_type === "audio");
  let fps: number | null = null;
  const fr = v?.avg_frame_rate || "";
  if (/^\d+\/\d+$/.test(fr)) {
    const [n, d] = fr.split("/").map(Number);
    if (d > 0) fps = Math.round((n / d) * 100) / 100;
  }
  return {
    durationSec: Number(info.format?.duration) || 0,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps,
    hasAudio: Boolean(a),
  };
}

// ---------------------------------------------------------------- 拼接

export type ConcatInput = {
  /** 按播放顺序;gs:// 或 https;2–12 段 */
  clips: string[];
  /** 统一目标高度,默认 720(宽度按比例,-2 保偶数) */
  height?: number;
  /** 统一帧率,默认 30 */
  fps?: number;
};

export async function concatClips(
  input: ConcatInput,
  userId: string,
): Promise<{ gcsUri: string; url: string; bytes: number; durationSec: number; clipCount: number }> {
  const clips = (input.clips || []).map((c) => String(c).trim()).filter(Boolean);
  if (clips.length < 2) throw new Error("拼接至少需要 2 段素材");
  if (clips.length > MAX_CONCAT_CLIPS) throw new Error(`拼接单次最多 ${MAX_CONCAT_CLIPS} 段`);
  const height = Math.max(240, Math.min(2160, Math.floor(input.height ?? 720)));
  const fps = Math.max(12, Math.min(60, Math.floor(input.fps ?? 30)));

  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-concat-"));
  try {
    const localPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const p = path.join(tmpDir, `in-${i}.mp4`);
      await fetchToFile(clips[i], p);
      localPaths.push(p);
    }
    // 统一 分辨率/帧率/采样率 后 concat filter 一次成型(各段编码参数不齐时最稳)
    const args: string[] = ["-y"];
    for (const p of localPaths) args.push("-i", p);
    const per = localPaths
      .map(
        (_p, i) =>
          `[${i}:v]scale=-2:${height},fps=${fps},setsar=1[v${i}];` +
          `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`,
      )
      .join(";");
    const heads = localPaths.map((_p, i) => `[v${i}][a${i}]`).join("");
    const outPath = path.join(tmpDir, "out.mp4");
    args.push(
      "-filter_complex",
      `${per};${heads}concat=n=${localPaths.length}:v=1:a=1[vo][ao]`,
      "-map", "[vo]", "-map", "[ao]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-c:a", "aac", "-b:a", "256k",
      outPath,
    );
    await execFileAsync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
    const meta = await probe(outPath);
    const up = await uploadResult({ filePath: outPath, userId, kind: "concat", ext: "mp4", contentType: "video/mp4" });
    return { ...up, durationSec: meta.durationSec, clipCount: clips.length };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- BGM 贴装

export type BgmMountInput = {
  videoUri: string;
  bgmUri: string;
  /** BGM 源内起点秒(如 Ashes to Dawn 取 71s 起),默认 0 */
  bgmSourceStartSec?: number;
  /** BGM 在片内的进场秒(如天雷劫惯例 1.5s),默认 0 */
  entryOffsetSec?: number;
  /** BGM 增益,默认 0.55 */
  gain?: number;
  /** 入场淡入秒,默认 1.2 */
  fadeInSec?: number;
  /** 淡出起点(片内秒);缺省 = 片长 - fadeOutSec - 0.5 */
  fadeOutStartSec?: number;
  /** 淡出时长,默认 3.5 */
  fadeOutSec?: number;
  /** 对白侧链:阈值/压比/恢复毫秒,默认 0.035 / 7 / 280(实弹配方) */
  duckThreshold?: number;
  duckRatio?: number;
  duckReleaseMs?: number;
};

export async function mountBgm(
  input: BgmMountInput,
  userId: string,
): Promise<{ gcsUri: string; url: string; bytes: number; durationSec: number }> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-bgm-"));
  try {
    const vPath = path.join(tmpDir, "video.mp4");
    const bPath = path.join(tmpDir, "bgm.audio");
    await fetchToFile(input.videoUri, vPath);
    await fetchToFile(input.bgmUri, bPath);
    const meta = await probe(vPath);
    if (!meta.hasAudio) throw new Error("视频没有音轨,无法做对白侧链;先给视频补一条(哪怕静音)音轨");

    const gain = Math.max(0.05, Math.min(2, Number(input.gain ?? 0.55)));
    const fadeIn = Math.max(0, Number(input.fadeInSec ?? 1.2));
    const fadeOutSec = Math.max(0, Number(input.fadeOutSec ?? 3.5));
    const fadeOutStart = Number.isFinite(Number(input.fadeOutStartSec))
      ? Number(input.fadeOutStartSec)
      : Math.max(0, meta.durationSec - fadeOutSec - 0.5);
    const srcStart = Math.max(0, Number(input.bgmSourceStartSec ?? 0));
    const delayMs = Math.max(0, Math.round(Number(input.entryOffsetSec ?? 0) * 1000));
    const thr = Math.max(0.001, Math.min(0.5, Number(input.duckThreshold ?? 0.035)));
    const ratio = Math.max(1, Math.min(20, Number(input.duckRatio ?? 7)));
    const release = Math.max(50, Math.min(2000, Math.round(Number(input.duckReleaseMs ?? 280))));

    const outPath = path.join(tmpDir, "out.mp4");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", vPath,
        "-ss", String(srcStart), "-t", String(meta.durationSec + 2), "-i", bPath,
        "-filter_complex",
        `[1:a]afade=t=in:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOutSec},volume=${gain},` +
          `adelay=${delayMs}|${delayMs}[bg];` +
          `[bg][0:a]sidechaincompress=threshold=${thr}:ratio=${ratio}:attack=6:release=${release}[bgd];` +
          `[0:a][bgd]amix=inputs=2:duration=first:normalize=0[mix]`,
        "-map", "0:v", "-map", "[mix]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "256k",
        outPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const outMeta = await probe(outPath);
    const up = await uploadResult({ filePath: outPath, userId, kind: "bgm", ext: "mp4", contentType: "video/mp4" });
    return { ...up, durationSec: outMeta.durationSec };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 响度验收

export type LoudnessWindow = { label: string; startSec: number; endSec: number };

export type LoudnessCheckInput = {
  videoUri: string;
  /** 分窗(如对白窗/BGM 顶点窗/退出窗);可空 = 只出整体 */
  windows?: LoudnessWindow[];
  /** 期望值(双轨三查);可空 = 只回报实测 */
  expect?: {
    minDurationSec?: number;
    maxDurationSec?: number;
    width?: number;
    height?: number;
    requireAudio?: boolean;
  };
};

export type LoudnessReport = {
  durationSec: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  integratedLufs: number | null;
  windows: Array<LoudnessWindow & { rmsDb: number | null }>;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
};

export async function loudnessCheck(input: LoudnessCheckInput): Promise<LoudnessReport> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-loud-"));
  try {
    const vPath = path.join(tmpDir, "video.mp4");
    await fetchToFile(input.videoUri, vPath);
    const meta = await probe(vPath);

    let integratedLufs: number | null = null;
    if (meta.hasAudio) {
      // ebur128 结果走 stderr;`I: -14.7 LUFS`
      const r = await execFileAsync(
        "ffmpeg",
        ["-i", vPath, "-af", "ebur128", "-f", "null", "-"],
        { maxBuffer: 64 * 1024 * 1024 },
      ).catch((e: { stderr?: string }) => ({ stderr: String(e?.stderr || "") }) as { stdout?: string; stderr: string });
      const m = String(r.stderr || "").match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
      if (m && m.length) {
        const last = m[m.length - 1].match(/(-?\d+(?:\.\d+)?)/);
        integratedLufs = last ? Number(last[1]) : null;
      }
    }

    const windows: LoudnessReport["windows"] = [];
    for (const w of input.windows || []) {
      let rmsDb: number | null = null;
      if (meta.hasAudio && w.endSec > w.startSec) {
        const r = await execFileAsync(
          "ffmpeg",
          [
            "-i", vPath,
            "-af",
            `atrim=start=${w.startSec}:end=${w.endSec},astats=metadata=1:measure_overall=RMS_level:measure_perchannel=none`,
            "-f", "null", "-",
          ],
          { maxBuffer: 64 * 1024 * 1024 },
        ).catch((e: { stderr?: string }) => ({ stderr: String(e?.stderr || "") }) as { stdout?: string; stderr: string });
        const m = String(r.stderr || "").match(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
        rmsDb = m ? Number(m[1]) : null;
      }
      windows.push({ ...w, rmsDb });
    }

    const checks: LoudnessReport["checks"] = [];
    const ex = input.expect || {};
    if (ex.minDurationSec != null || ex.maxDurationSec != null) {
      const lo = ex.minDurationSec ?? 0;
      const hi = ex.maxDurationSec ?? Number.POSITIVE_INFINITY;
      checks.push({
        name: "时长",
        pass: meta.durationSec >= lo && meta.durationSec <= hi,
        detail: `实测 ${meta.durationSec.toFixed(2)}s,期望 [${lo}, ${hi === Number.POSITIVE_INFINITY ? "∞" : hi}]s`,
      });
    }
    if (ex.width != null || ex.height != null) {
      const pass = (ex.width == null || meta.width === ex.width) && (ex.height == null || meta.height === ex.height);
      checks.push({ name: "分辨率", pass, detail: `实测 ${meta.width}x${meta.height},期望 ${ex.width ?? "*"}x${ex.height ?? "*"}` });
    }
    if (ex.requireAudio) {
      checks.push({ name: "音轨", pass: meta.hasAudio, detail: meta.hasAudio ? "音轨在" : "缺音轨" });
    }

    return {
      durationSec: Math.round(meta.durationSec * 100) / 100,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      hasAudio: meta.hasAudio,
      integratedLufs,
      windows,
      checks,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

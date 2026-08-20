/**
 * 后期工坊核心(蓝图二①):拼接 / BGM 贴装 / 响度验收。
 * 纯 ffmpeg + 规则引擎,零大模型 token;配方来自《雷击》《天雷劫》实弹工艺:
 * - BGM 永远后期贴(0.48 规):侧链压对白、入场淡入、按完整时间线淡出;
 * - 响度验收 = ebur128 整体 + 分窗 RMS,媒体命令未完成一律抛错,不折成 null。
 *
 * 工程约束(0821 审阅清单):
 * - 所有下载/ffmpeg/ffprobe 共用同一个 AbortSignal,任务时限到即中止子进程;
 * - 单素材/拼接累计体积上限,HTTPS 流式落盘边下边数字节;
 * - 不同画幅统一 scale+pad 进同一拼接序列,无声素材补静音轨;
 * - 临时目录一律 finally 清理。
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { downloadGcsObject, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import type { BgmMountParams, ConcatParams, LoudnessParams } from "../jobs/postProdInput";

const execFileAsync = promisify(execFile);

/** 拼接单次上限:超过说明该走多轮,防一条命令吃满机器 */
export const MAX_CONCAT_CLIPS = 12;
/** 单素材体积上限 */
export const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
/** 拼接素材累计体积上限 */
export const MAX_CONCAT_TOTAL_BYTES = 1536 * 1024 * 1024;
/** 产物体积上限(buffer 上传前把关) */
export const MAX_RESULT_BYTES = 512 * 1024 * 1024;
/** 单素材下载时限(连接+读取) */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

const NEVER_ABORT = new AbortController().signal;

/** 组合多个 signal(Node<20.3 无 AbortSignal.any 的兜底) */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      c.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

/** 媒体子进程统一入口:共用任务 signal,时限到同步终止 */
export function runMediaTool(
  command: "ffmpeg" | "ffprobe",
  args: string[],
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, { signal, maxBuffer: 16 * 1024 * 1024 }) as Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export type DownloadBudget = { remainingBytes: number };

/**
 * 素材落盘:gs:// 走 GCS 下载(下载后验字节),https 流式写文件边下边数,
 * 超单素材上限或累计预算立即中止读取。
 */
export async function fetchPostProdSourceToFile(
  uriOrUrl: string,
  filePath: string,
  opts: { signal: AbortSignal; maxBytes?: number; budget?: DownloadBudget },
): Promise<number> {
  const src = String(uriOrUrl || "").trim();
  const maxBytes = Math.min(opts.maxBytes ?? MAX_SOURCE_BYTES, opts.budget?.remainingBytes ?? Infinity);
  if (maxBytes <= 0) throw new Error("拼接素材累计体积超过上限");

  let bytes = 0;
  if (src.startsWith("gs://")) {
    opts.signal.throwIfAborted();
    const { buffer } = await downloadGcsObject({ gcsUri: src });
    if (buffer.length > maxBytes) throw new Error("素材体积超过上限");
    opts.signal.throwIfAborted();
    await writeBufferToFile(filePath, buffer);
    bytes = buffer.length;
  } else if (/^https:\/\//.test(src)) {
    const signal = anySignal([opts.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
    const res = await fetch(src, { signal });
    if (!res.ok) throw new Error(`素材下载失败 HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("素材体积超过上限");
    if (!res.body) throw new Error("素材下载失败:空响应体");
    const out = createWriteStream(filePath);
    try {
      const reader = res.body.getReader();
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new Error("素材体积超过上限");
        }
        if (!out.write(value)) {
          await new Promise<void>((resolve, reject) => {
            out.once("drain", resolve);
            out.once("error", reject);
          });
        }
      }
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.once("error", reject);
      });
    } catch (e) {
      out.destroy();
      throw e;
    }
  } else {
    throw new Error("素材地址仅接受 gs:// 或 https://");
  }

  if (opts.budget) opts.budget.remainingBytes -= bytes;
  return bytes;
}

async function writeBufferToFile(filePath: string, buffer: Buffer): Promise<void> {
  const out = createWriteStream(filePath);
  await new Promise<void>((resolve, reject) => {
    out.once("error", reject);
    out.end(buffer, () => resolve());
  });
}

async function uploadResult(params: {
  filePath: string;
  userId: string;
  kind: string;
  ext: string;
  contentType: string;
}): Promise<{ gcsUri: string; url: string; bytes: number }> {
  const st = await stat(params.filePath);
  if (st.size > MAX_RESULT_BYTES) throw new Error("产物体积超过上限,请缩短素材或分批处理");
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

async function probe(
  filePath: string,
  signal: AbortSignal,
): Promise<{
  durationSec: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
}> {
  const { stdout } = await runMediaTool(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    signal,
  );
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
  const durationSec = Number(info.format?.duration) || 0;
  if (!v || durationSec <= 0) throw new Error("素材不是可用视频(探测不到视频轨/时长)");
  return {
    durationSec,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps,
    hasAudio: Boolean(a),
  };
}

export type PostProdRunOptions = { signal?: AbortSignal };

// ---------------------------------------------------------------- 拼接

export async function concatClips(
  input: ConcatParams,
  userId: string,
  options?: PostProdRunOptions,
): Promise<{ gcsUri: string; url: string; bytes: number; durationSec: number; clipCount: number }> {
  const signal = options?.signal ?? NEVER_ABORT;
  const { clips, width, height, fps } = input;
  if (clips.length < 2) throw new Error("拼接至少需要 2 段素材");
  if (clips.length > MAX_CONCAT_CLIPS) throw new Error(`拼接单次最多 ${MAX_CONCAT_CLIPS} 段`);

  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-concat-"));
  try {
    const budget: DownloadBudget = { remainingBytes: MAX_CONCAT_TOTAL_BYTES };
    const locals: Array<{ filePath: string; durationSec: number; hasAudio: boolean }> = [];
    for (let i = 0; i < clips.length; i++) {
      const p = path.join(tmpDir, `in-${i}.mp4`);
      await fetchPostProdSourceToFile(clips[i], p, { signal, budget });
      const meta = await probe(p, signal);
      locals.push({ filePath: p, durationSec: meta.durationSec, hasAudio: meta.hasAudio });
    }

    /**
     * 统一画面参数:保持原比例 scale 进 ${width}x${height} 内、余量补边居中,
     * 统一帧率/像素格式/SAR,时间戳归零;音频统一 48kHz stereo 归零,
     * 无声素材用 anullsrc 补同长度静音轨(追加为额外输入)。
     */
    const args: string[] = ["-y"];
    for (const l of locals) args.push("-i", l.filePath);
    const silentInputIndexByClip = new Map<number, number>();
    let nextInputIndex = locals.length;
    for (let i = 0; i < locals.length; i++) {
      if (!locals[i].hasAudio) {
        args.push(
          "-f", "lavfi",
          "-t", locals[i].durationSec.toFixed(3),
          "-i", "anullsrc=r=48000:cl=stereo",
        );
        silentInputIndexByClip.set(i, nextInputIndex);
        nextInputIndex += 1;
      }
    }
    const vChain = (i: number) =>
      `[${i}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,setsar=1,` +
      `setpts=PTS-STARTPTS[v${i}]`;
    const aChain = (i: number) => {
      const src = silentInputIndexByClip.has(i) ? silentInputIndexByClip.get(i) : i;
      return (
        `[${src}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `asetpts=PTS-STARTPTS[a${i}]`
      );
    };
    const per = locals.map((_l, i) => `${vChain(i)};${aChain(i)}`).join(";");
    const heads = locals.map((_l, i) => `[v${i}][a${i}]`).join("");
    const outPath = path.join(tmpDir, "out.mp4");
    args.push(
      "-filter_complex",
      `${per};${heads}concat=n=${locals.length}:v=1:a=1[vo][ao]`,
      "-map", "[vo]", "-map", "[ao]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-c:a", "aac", "-b:a", "256k",
      outPath,
    );
    await runMediaTool("ffmpeg", args, signal);
    const meta = await probe(outPath, signal);
    const up = await uploadResult({ filePath: outPath, userId, kind: "concat", ext: "mp4", contentType: "video/mp4" });
    return { ...up, durationSec: meta.durationSec, clipCount: clips.length };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- BGM 贴装

export async function mountBgm(
  input: BgmMountParams,
  userId: string,
  options?: PostProdRunOptions,
): Promise<{ gcsUri: string; url: string; bytes: number; durationSec: number }> {
  const signal = options?.signal ?? NEVER_ABORT;
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-bgm-"));
  try {
    const vPath = path.join(tmpDir, "video.mp4");
    const bPath = path.join(tmpDir, "bgm.audio");
    await fetchPostProdSourceToFile(input.videoUri, vPath, { signal });
    await fetchPostProdSourceToFile(input.bgmUri, bPath, { signal });
    const meta = await probe(vPath, signal);
    const D = meta.durationSec;

    const gain = input.bgmVolume;
    const entry = Math.min(input.entrySec, Math.max(0, D - 0.1));
    const fadeIn = input.fadeInSec;
    const fadeOutSec = Math.min(input.fadeOutSec, D);
    /** 淡出按完整视频时间线定位:晚入场也对齐片尾 */
    const fadeOutStart = Math.max(entry, D - fadeOutSec);
    const delayMs = Math.round(entry * 1000);
    /** 0.48 规侧链配方常量(钥匙=原对白轨) */
    const DUCK = { threshold: 0.035, ratio: 7, attack: 6, release: 280 };

    /**
     * 时间线整理(审阅清单七):
     * 音乐: stream_loop 循环 → atrim 到所需长度 → adelay 进场 → 按完整时间线
     *       afade 淡入/淡出 → apad → atrim 到视频总时长;
     * 原音: (无音轨用静音源) apad → atrim 到视频总时长;
     * 成片长度以视频轨为准。
     */
    const musicNeedSec = Math.max(0.1, D - entry);
    const bgmChain =
      `[1:a]atrim=0:${musicNeedSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${gain},` +
      `adelay=${delayMs}|${delayMs},` +
      `afade=t=in:st=${entry.toFixed(3)}:d=${fadeIn.toFixed(3)},` +
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutSec.toFixed(3)},` +
      `apad,atrim=0:${D.toFixed(3)}[bg]`;
    const voiceSrc = meta.hasAudio ? "[0:a]" : "[2:a]";
    // 对白轨分两路:一路做侧链钥匙,一路进混音(滤镜输出标签只能消费一次)
    const voiceChain =
      `${voiceSrc}apad,atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS,asplit=2[voxmix][voxkey]`;
    const mixChain =
      `[bg][voxkey]sidechaincompress=threshold=${DUCK.threshold}:ratio=${DUCK.ratio}:` +
      `attack=${DUCK.attack}:release=${DUCK.release}[bgd];` +
      `[voxmix][bgd]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[mix]`;

    const args: string[] = [
      "-y",
      "-i", vPath,
      // 音乐长度不足时循环;超长由 atrim 裁切
      "-stream_loop", "-1", "-i", bPath,
    ];
    if (!meta.hasAudio) {
      args.push("-f", "lavfi", "-t", D.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    }
    const outPath = path.join(tmpDir, "out.mp4");
    args.push(
      "-filter_complex", `${bgmChain};${voiceChain};${mixChain}`,
      "-map", "0:v", "-map", "[mix]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "256k",
      "-t", (D + 0.05).toFixed(3),
      outPath,
    );
    await runMediaTool("ffmpeg", args, signal);
    const outMeta = await probe(outPath, signal);
    const up = await uploadResult({ filePath: outPath, userId, kind: "bgm", ext: "mp4", contentType: "video/mp4" });
    return { ...up, durationSec: outMeta.durationSec };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 响度验收

export type LoudnessReport =
  | {
      status: "ok";
      durationSec: number;
      integratedLufs: number;
      windows: Array<{ startSec: number; durationSec: number; rmsDb: number }>;
    }
  | {
      status: "no_audio";
      durationSec: number;
      integratedLufs: null;
      windows: [];
    };

export async function loudnessCheck(
  input: LoudnessParams,
  options?: PostProdRunOptions,
): Promise<LoudnessReport> {
  const signal = options?.signal ?? NEVER_ABORT;
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-loud-"));
  try {
    const vPath = path.join(tmpDir, "video.mp4");
    await fetchPostProdSourceToFile(input.videoUri, vPath, { signal });
    const meta = await probe(vPath, signal);
    const D = Math.round(meta.durationSec * 100) / 100;

    if (!meta.hasAudio) {
      return { status: "no_audio", durationSec: D, integratedLufs: null, windows: [] };
    }

    // 媒体命令未完成一律抛错结束本次任务,不把失败折成 null 假装量过了
    const ebur = await runMediaTool(
      "ffmpeg",
      ["-i", vPath, "-af", "ebur128", "-f", "null", "-"],
      signal,
    ).catch((e: { stderr?: string; name?: string }) => {
      if (e?.name === "AbortError") throw e;
      // ffmpeg 对 -f null 常以非零码退出但 stderr 带完整结果;没有结果才算未完成
      return { stdout: "", stderr: String(e?.stderr || "") };
    });
    const lufsMatches = String(ebur.stderr || "").match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
    const lastLufs = lufsMatches?.length
      ? lufsMatches[lufsMatches.length - 1].match(/(-?\d+(?:\.\d+)?)/)
      : null;
    if (!lastLufs) throw new Error("响度检测未完成(ebur128 无结果),本次任务失败");
    const integratedLufs = Number(lastLufs[1]);

    const windows: Array<{ startSec: number; durationSec: number; rmsDb: number }> = [];
    for (const w of input.windows) {
      if (w.startSec >= D) {
        throw new Error(`检测窗口起点 ${w.startSec}s 超出视频时长 ${D}s`);
      }
      // 窗口末端超过视频长度时统一裁切
      const clippedDuration = Math.min(w.durationSec, D - w.startSec);
      const endSec = w.startSec + clippedDuration;
      const r = await runMediaTool(
        "ffmpeg",
        [
          "-i", vPath,
          "-af",
          `atrim=start=${w.startSec}:end=${endSec},` +
            `astats=metadata=1:measure_overall=RMS_level:measure_perchannel=none`,
          "-f", "null", "-",
        ],
        signal,
      ).catch((e: { stderr?: string; name?: string }) => {
        if (e?.name === "AbortError") throw e;
        return { stdout: "", stderr: String(e?.stderr || "") };
      });
      const m = String(r.stderr || "").match(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
      if (!m) throw new Error("分窗响度检测未完成,本次任务失败");
      windows.push({ startSec: w.startSec, durationSec: clippedDuration, rmsDb: Number(m[1]) });
    }

    return { status: "ok", durationSec: D, integratedLufs, windows };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

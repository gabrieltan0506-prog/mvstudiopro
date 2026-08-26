/**
 * 后期工坊核心(蓝图二①):拼接 / BGM 贴装 / 响度验收。
 * 纯 ffmpeg + 规则引擎,零大模型 token;配方来自《雷击》《天雷劫》实弹工艺:
 * - BGM 永远后期贴(0.48 规):侧链压对白、入场淡入、按完整时间线淡出;
 * - 响度验收 = ebur128 整体 + 分窗 RMS,媒体命令未完成一律抛错结束本次任务。
 *
 * 工程约束(0821 审阅清单一/二审):
 * - 所有下载/ffmpeg/ffprobe/上传共用同一个 AbortSignal,任务时限到即中止;
 * - gs:// 与 HTTPS 共用流式读取(gs:// 现签短链再流式拉),边下边数字节,
 *   超单素材上限或拼接累计预算立即中止读取;
 * - 不同画幅统一 scale+pad 进同一拼接序列;无声素材补静音轨;
 *   每段音轨 apad+atrim 对齐该段画面时长;
 * - 临时目录一律 finally 清理。
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import {
  bgmMountParamsSchema,
  isSafePostProdVolumeExpr,
  type RawBgmMountParams,
  type ConcatParams,
  type LoudnessParams,
} from "../jobs/postProdInput";

const execFileAsync = promisify(execFile);

/** 拼接单次上限:超过说明该走多轮,防一条命令吃满机器 */
export const MAX_CONCAT_CLIPS = 12;
/** 单素材体积上限 */
export const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
/** 拼接素材累计体积上限 */
export const MAX_CONCAT_TOTAL_BYTES = 1536 * 1024 * 1024;
/** 产物体积上限(上传前把关) */
export const MAX_RESULT_BYTES = 512 * 1024 * 1024;
/** 单素材下载时限(连接+读取) */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

const NEVER_ABORT = new AbortController().signal;

/** 媒体子进程统一入口:共用任务 signal,任务时限结束即同步终止 */
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

/** 边写边数字节,超出当前处理上限立即报错中止 */
class ByteBudgetTransform extends Transform {
  bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(new Error("素材体积超过当前处理上限"));
      return;
    }
    callback(null, chunk);
  }
}

/**
 * 素材落盘:gs:// 现签短链后与 HTTPS 共用同一条流式读取路径,
 * 不把整个对象读进 Buffer 后才检查体积。
 */
export async function fetchPostProdSourceToFile(
  uriOrUrl: string,
  filePath: string,
  opts: {
    signal: AbortSignal;
    maxBytes?: number;
    budget?: DownloadBudget;
    /** 测试注入口;生产用默认 DOWNLOAD_TIMEOUT_MS */
    downloadTimeoutMs?: number;
  },
): Promise<number> {
  opts.signal.throwIfAborted();

  const source = String(uriOrUrl || "").trim();
  const maxBytes = Math.min(
    opts.maxBytes ?? MAX_SOURCE_BYTES,
    opts.budget?.remainingBytes ?? Number.POSITIVE_INFINITY,
  );
  if (maxBytes <= 0) throw new Error("素材累计体积超过当前处理上限");

  const requestUrl = source.startsWith("gs://") ? signGsUriV4ReadUrl(source, 3600) : source;
  if (!requestUrl.startsWith("https://")) throw new Error("素材地址格式不正确");

  const signal = AbortSignal.any([
    opts.signal,
    AbortSignal.timeout(opts.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS),
  ]);

  // 系统素材都是同源直链;出现跳转说明地址不在当前处理范围,不继续
  const response = await fetch(requestUrl, { signal, redirect: "error" });
  if (!response.ok) throw new Error(`素材读取未完成 HTTP ${response.status}`);

  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel();
    throw new Error("素材体积超过当前处理上限");
  }
  if (!response.body) throw new Error("素材内容为空");

  const meter = new ByteBudgetTransform(maxBytes);
  await pipeline(
    Readable.fromWeb(response.body as never),
    meter,
    createWriteStream(filePath, { flags: "wx" }),
    { signal },
  );

  if (opts.budget) opts.budget.remainingBytes -= meter.bytes;
  return meter.bytes;
}

async function uploadResult(params: {
  filePath: string;
  userId: string;
  kind: string;
  ext: string;
  contentType: string;
  signal: AbortSignal;
}): Promise<{ gcsUri: string; url: string; bytes: number }> {
  params.signal.throwIfAborted();
  const st = await stat(params.filePath);
  if (st.size > MAX_RESULT_BYTES) throw new Error("产物体积超过当前处理上限,请缩短素材或分批处理");
  const buffer = await readFile(params.filePath, { signal: params.signal });
  params.signal.throwIfAborted();
  const safeUser = String(params.userId).replace(/[^0-9a-zA-Z_-]/g, "");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const objectName = `post-prod/${safeUser}/${stamp}/${params.kind}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${params.ext}`;
  const uploaded = await uploadBufferToGcs({
    objectName,
    buffer,
    contentType: params.contentType,
    signal: params.signal,
  });
  params.signal.throwIfAborted();
  return {
    gcsUri: uploaded.gcsUri,
    url: signGsUriV4ReadUrl(uploaded.gcsUri, 7 * 24 * 3600),
    bytes: buffer.length,
  };
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
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
  };
  const v = (info.streams || []).find((s) => s.codec_type === "video");
  const a = (info.streams || []).find((s) => s.codec_type === "audio");
  let fps: number | null = null;
  const fr = v?.avg_frame_rate || "";
  if (/^\d+\/\d+$/.test(fr)) {
    const [n, d] = fr.split("/").map(Number);
    if (d > 0) fps = Math.round((n / d) * 100) / 100;
  }
  // 对齐基准=画面时长:音轨长于画面时容器时长会被音轨拉长,不能拿它当画面长度
  const videoStreamSec = Number(v?.duration) || 0;
  const durationSec = videoStreamSec > 0 ? videoStreamSec : Number(info.format?.duration) || 0;
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
     * 并 apad+atrim 对齐该段画面时长(音轨短补静音、长则裁切);
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
      const sourceIndex = silentInputIndexByClip.get(i) ?? i;
      const duration = locals[i].durationSec.toFixed(3);
      return (
        `[${sourceIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad,atrim=0:${duration},asetpts=PTS-STARTPTS[a${i}]`
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
    const up = await uploadResult({
      filePath: outPath,
      userId,
      kind: "concat",
      ext: "mp4",
      contentType: "video/mp4",
      signal,
    });
    return { ...up, durationSec: meta.durationSec, clipCount: clips.length };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- BGM 贴装

export type BgmFilterPlan = {
  filterGraph: string;
  entrySec: number;
  seekSec: number;
  fadeOutStartSec: number;
};

/**
 * 生成 BGM 音轨施工链。独立导出是为了用纯测试钉住“不报错但全体错位”的顺序：
 * atrim/seek → asetpts → adelay → volume → fade。
 */
export function buildBgmFilterPlan(input: RawBgmMountParams, video: {
  durationSec: number;
  hasAudio: boolean;
}): BgmFilterPlan {
  // 服务函数也可能被旧任务/内部调用直接进入；边界再次归一，不能只依赖路由默认值。
  const normalized = bgmMountParamsSchema.parse(input);
  const durationSec = Math.max(0.1, Number(video.durationSec) || 0.1);
  const entrySec = Math.min(
    Math.max(0, Number(normalized.entrySec) || 0),
    Math.max(0, durationSec - 0.1),
  );
  const seekSec = Math.max(0, Number(normalized.bgmSeekSec) || 0);
  const audibleSec = Math.max(0.1, durationSec - entrySec);
  const fadeInSec = Math.min(Math.max(0, Number(normalized.fadeInSec) || 0), audibleSec);
  const fadeOutSec = Math.min(Math.max(0, Number(normalized.fadeOutSec) || 0), audibleSec);
  const fadeOutStartSec = Math.max(entrySec, durationSec - fadeOutSec);
  const delayMs = Math.round(entrySec * 1000);

  const rawExpression = String(normalized.volumeExpr || "").trim();
  if (rawExpression && !isSafePostProdVolumeExpr(rawExpression)) {
    throw new Error("卡点音量表达式格式不正确");
  }
  const volumeFilter = rawExpression
    ? `volume='${rawExpression}':eval=frame`
    : `volume=${normalized.bgmVolume}`;

  const bgmFilters = [
    // seek 和 end 都落在 BGM 自己的时间轴；循环输入保证短音乐可覆盖整片。
    `atrim=start=${seekSec.toFixed(3)}:end=${(seekSec + audibleSec).toFixed(3)}`,
    "asetpts=PTS-STARTPTS",
    `adelay=${delayMs}|${delayMs}`,
    // 卡点表是片内时间，必须在 adelay 之后逐帧求值。
    volumeFilter,
  ];
  if (fadeInSec > 0) {
    bgmFilters.push(`afade=t=in:st=${entrySec.toFixed(3)}:d=${fadeInSec.toFixed(3)}`);
  }
  if (fadeOutSec > 0) {
    bgmFilters.push(`afade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${fadeOutSec.toFixed(3)}`);
  }
  bgmFilters.push(`apad`, `atrim=0:${durationSec.toFixed(3)}`);

  const voiceSource = video.hasAudio ? "[0:a]" : "[2:a]";
  const voiceChain =
    `${voiceSource}apad,atrim=0:${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,`
    + "asplit=2[voxmix][voxkey]";
  // 旧入口没有独立对白轨，继续保留原音侧链；真实对白窗同时由 volumeExpr 手动压低。
  const duck = { threshold: 0.035, ratio: 7, attack: 6, release: 280 };
  const mixChain =
    `[bg][voxkey]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:`
    + `attack=${duck.attack}:release=${duck.release}[bgd];`
    + "[voxmix][bgd]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[mix]";

  return {
    filterGraph: `[1:a]${bgmFilters.join(",")}[bg];${voiceChain};${mixChain}`,
    entrySec,
    seekSec,
    fadeOutStartSec,
  };
}

export async function mountBgm(
  input: RawBgmMountParams,
  userId: string,
  options?: PostProdRunOptions,
): Promise<{ gcsUri: string; url: string; bytes: number; durationSec: number }> {
  const signal = options?.signal ?? NEVER_ABORT;
  const normalized = bgmMountParamsSchema.parse(input);
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pp-bgm-"));
  try {
    const vPath = path.join(tmpDir, "video.mp4");
    const bPath = path.join(tmpDir, "bgm.audio");
    await fetchPostProdSourceToFile(normalized.videoUri, vPath, { signal });
    await fetchPostProdSourceToFile(normalized.bgmUri, bPath, { signal });
    const meta = await probe(vPath, signal);
    const D = meta.durationSec;
    const filterPlan = buildBgmFilterPlan(normalized, {
      durationSec: D,
      hasAudio: meta.hasAudio,
    });

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
      "-filter_complex", filterPlan.filterGraph,
      "-map", "0:v", "-map", "[mix]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "256k",
      "-t", (D + 0.05).toFixed(3),
      outPath,
    );
    await runMediaTool("ffmpeg", args, signal);
    const outMeta = await probe(outPath, signal);
    const up = await uploadResult({
      filePath: outPath,
      userId,
      kind: "bgm",
      ext: "mp4",
      contentType: "video/mp4",
      signal,
    });
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

    // 媒体命令未完成一律抛错结束本次任务,不折成 null
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
    if (!lastLufs) throw new Error("响度检测的媒体命令未完成,本次任务失败");
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
      if (!m) throw new Error("分窗响度检测的媒体命令未完成,本次任务失败");
      windows.push({ startSec: w.startSec, durationSec: clippedDuration, rmsDb: Number(m[1]) });
    }

    return { status: "ok", durationSec: D, integratedLufs, windows };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

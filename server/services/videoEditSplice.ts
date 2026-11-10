/**
 * 视频局部修改的流复制拼回（纯本地 ffmpeg 步骤，不碰计费/证据/上传）：
 * 未改的前后段按关键帧原样流复制，只把「切点到最近关键帧之间的少量帧 + 编辑段」
 * 按原片参数编码一次，concat demuxer 拼接，音轨整条取原片原样复制。
 * 原片不满足条件或任何一步校验不过都返回 { ok:false, reason }，由调用方回退到整片重编码。
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

export type MediaRun = (command: "ffmpeg" | "ffprobe", args: string[], signal: AbortSignal) => Promise<{ stdout: string; stderr: string }>;

/** 流复制路径未改区间抽帧与原片同帧的 SSIM 下限。 */
export const STREAM_COPY_MIN_SSIM = 0.99;
/** 拼回后总时长与原片允许的最大差（秒）。 */
export const SPLICE_MAX_DURATION_DRIFT_SEC = 0.25;
/** 逐包探测的帧数上限（约 60fps×2 小时），超过走回退。 */
const MAX_PROBE_FRAMES = 432_000;
/** 重编码段使用的参数集编号：与原片常见的 0 号错开，段间切换不互相覆盖。 */
const REENCODE_PARAMETER_SET_ID = 5;

// ─── 流复制拼回：原片体检 ────────────────────────────────

export type StreamCopySource = {
  width: number;
  height: number;
  /** 帧率分数 n/d。 */
  fpsNum: number;
  fpsDen: number;
  /** 视频轨 timescale（time_base 分母）。 */
  timescale: number;
  /** 每帧 tick 数。 */
  frameTicks: number;
  profile: "baseline" | "main" | "high";
  level: number;
  pixFmt: "yuv420p";
  /** 解码延迟帧数（0 = 无 B 帧）。 */
  delayFrames: 0 | 1 | 2;
  color: { range?: string; space?: string; primaries?: string; transfer?: string };
  /** 按显示顺序的各帧 pts（tick，首帧归零）。 */
  pts: number[];
  /** 关键帧在显示顺序中的下标（升序，含 0）。 */
  keyframes: number[];
  /** 文件首帧显示时间（秒，相对容器起点）。 */
  firstPtsSec: number;
  frameCount: number;
  durationSec: number;
  hasAudio: boolean;
};

export type StreamCopyInspect = { ok: true; source: StreamCopySource } | { ok: false; reason: string };

const PROFILES: Record<string, StreamCopySource["profile"]> = { "Constrained Baseline": "baseline", Baseline: "baseline", Main: "main", High: "high" };
const no = (reason: string) => ({ ok: false as const, reason });
const ratio = (value: unknown): [number, number] => {
  const [n, d] = String(value || "").split("/").map(Number);
  return Number.isFinite(n) && Number.isFinite(d) && d > 0 ? [n, d] : [0, 1];
};
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

type PacketRow = { pts: number; dts: number; key: boolean };
async function readVideoPackets(file: string, run: MediaRun, signal: AbortSignal): Promise<PacketRow[]> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts,dts,flags", "-of", "csv=p=0", file], signal);
  const rows: PacketRow[] = [];
  for (const line of String(stdout).split("\n")) {
    if (!line.trim()) continue;
    const [pts, dts, flags] = line.split(",");
    rows.push({ pts: Number(pts), dts: Number(dts), key: String(flags || "").includes("K") });
  }
  return rows;
}

/** 原片是否满足流复制拼接条件：h264 / 恒定帧率 / 逐行 / 8bit 4:2:0 / 时间戳规整 / 解码延迟 ≤2 帧。 */
export async function inspectStreamCopySource(file: string, run: MediaRun, signal: AbortSignal): Promise<StreamCopyInspect> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], signal);
  const info = JSON.parse(String(stdout)) as { format?: { start_time?: string; duration?: string }; streams?: Array<Record<string, any>> };
  const videos = (info.streams || []).filter(s => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (videos.length !== 1) return no("video_stream_count");
  const v = videos[0];
  if (v.codec_name !== "h264") return no(`codec_${v.codec_name || "unknown"}`);
  const profile = PROFILES[String(v.profile)];
  if (!profile) return no(`profile_${String(v.profile || "unknown").replace(/\s+/g, "_")}`);
  if (v.pix_fmt !== "yuv420p") return no(`pix_fmt_${v.pix_fmt || "unknown"}`);
  if (v.field_order && v.field_order !== "progressive" && v.field_order !== "unknown") return no("interlaced");
  if (v.sample_aspect_ratio && !["1:1", "0:1"].includes(v.sample_aspect_ratio)) return no("non_square_pixels");
  if ((v.side_data_list || []).some((s: Record<string, unknown>) => "rotation" in s) || v.tags?.rotate) return no("rotation");
  const width = Number(v.width), height = Number(v.height), level = Number(v.level);
  if (!(width > 0 && height > 0 && level > 0)) return no("geometry_unknown");

  const [rn, rd] = ratio(v.r_frame_rate), [an, ad] = ratio(v.avg_frame_rate);
  if (!(rn > 0) || !(an > 0)) return no("frame_rate_unknown");
  if (Math.abs(rn / rd - an / ad) > 0.01 * (rn / rd)) return no("variable_frame_rate");
  const [tbN, timescale] = ratio(v.time_base);
  if (tbN !== 1 || !(timescale > 0)) return no("time_base");
  const g = gcd(rn, rd), fpsNum = rn / g, fpsDen = rd / g;
  const frameTicks = (timescale * fpsDen) / fpsNum;
  if (!Number.isInteger(frameTicks) || frameTicks <= 0) return no("time_base_not_frame_aligned");

  const packets = await readVideoPackets(file, run, signal);
  if (packets.length < 2) return no("too_few_frames");
  if (packets.length > MAX_PROBE_FRAMES) return no("too_many_frames");
  if (packets.some(p => !Number.isFinite(p.pts) || !Number.isFinite(p.dts))) return no("missing_timestamps");
  if (!packets[0].key) return no("first_frame_not_keyframe");
  for (let i = 1; i < packets.length; i++) if (packets[i].dts <= packets[i - 1].dts) return no("non_monotonic_dts");
  const delay = (packets[0].pts - packets[0].dts) / frameTicks;
  if (![0, 1, 2].includes(delay)) return no(`decode_delay_${Number.isFinite(delay) ? delay : "unknown"}`);
  if (delay > 0 && profile === "baseline") return no("baseline_with_reorder");

  const ordered = packets.map((p, order) => ({ ...p, order })).sort((a, b) => a.pts - b.pts);
  const first = ordered[0].pts;
  if (ordered[0].order !== 0) return no("leading_frames_before_first_keyframe");
  for (let i = 1; i < ordered.length; i++) if (ordered[i].pts - ordered[i - 1].pts !== frameTicks) return no("variable_frame_rate");
  // 关键帧必须是闭合的切点：显示顺序在它之前的帧，解码顺序也都在它之前
  const keyframes: number[] = [];
  let maxOrderBefore = -1;
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].key) {
      if (maxOrderBefore > ordered[i].order) return no("open_gop");
      if (ordered[i].order !== i) return no("open_gop");
      keyframes.push(i);
    }
    maxOrderBefore = Math.max(maxOrderBefore, ordered[i].order);
  }

  const formatStart = Number(info.format?.start_time) || 0;
  const firstPtsSec = first / timescale - formatStart;
  if (Math.abs(firstPtsSec) > 0.5 * (frameTicks / timescale)) return no("video_start_offset");
  const frameCount = ordered.length;
  return {
    ok: true,
    source: {
      width, height, fpsNum, fpsDen, timescale, frameTicks, profile, level, pixFmt: "yuv420p", delayFrames: delay as 0 | 1 | 2,
      color: { range: known(v.color_range), space: known(v.color_space), primaries: known(v.color_primaries), transfer: known(v.color_transfer) },
      pts: ordered.map(p => p.pts - first), keyframes, firstPtsSec, frameCount,
      durationSec: (frameCount * frameTicks) / timescale,
      hasAudio: (info.streams || []).some(s => s.codec_type === "audio"),
    },
  };
}
const known = (value: unknown) => (typeof value === "string" && value && value !== "unknown" && value !== "unspecified" ? value : undefined);

// ─── 流复制拼回：切点规划 ────────────────────────────────

export type StreamCopyPlan = {
  /** 被替换的帧区间 [editStart, editEnd)。 */
  editStart: number;
  editEnd: number;
  /** 重编码区间 [encodeStart, encodeEnd)：两端落在关键帧（或片头/片尾）。 */
  encodeStart: number;
  encodeEnd: number;
  frameCount: number;
};

/** 选段秒点 → 帧下标；重编码区间向外扩到最近关键帧，其余帧原样流复制。 */
export function planStreamCopySplice(source: Pick<StreamCopySource, "pts" | "keyframes" | "timescale" | "frameCount">, startSec: number, endSec: number): StreamCopyPlan | { ok: false; reason: string } {
  const { pts, keyframes, timescale, frameCount } = source;
  const indexAt = (sec: number) => {
    const target = sec * timescale - 1e-4 * timescale;
    let lo = 0, hi = frameCount;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid] >= target) hi = mid; else lo = mid + 1; }
    return lo;
  };
  const editStart = indexAt(startSec), editEnd = indexAt(endSec);
  if (!(editEnd > editStart)) return no("empty_edit_range");
  let encodeStart = 0;
  for (const k of keyframes) { if (k <= editStart) encodeStart = k; else break; }
  const encodeEnd = keyframes.find(k => k >= editEnd) ?? frameCount;
  if (encodeStart === 0 && encodeEnd === frameCount) return no("no_copyable_range");
  return { editStart, editEnd, encodeStart, encodeEnd, frameCount };
}

/** 未改区间抽 3 帧：优先贴着编辑段两侧与流复制段首尾（对位差一帧或接缝花屏最先在这里暴露）。 */
export function pickUntouchedSampleFrames(plan: StreamCopyPlan): number[] {
  const { editStart, editEnd, encodeStart, encodeEnd, frameCount } = plan;
  const untouched = (i: number) => i >= 0 && i < frameCount && (i < editStart || i >= editEnd);
  const candidates = [editStart - 1, editEnd, encodeEnd, encodeStart - 1, Math.floor(encodeStart / 2), Math.floor((encodeEnd + frameCount) / 2), frameCount - 1, 0];
  const picked: number[] = [];
  for (const c of candidates) if (untouched(c) && !picked.includes(c)) { picked.push(c); if (picked.length === 3) break; }
  return picked.sort((a, b) => a - b);
}

// ─── 流复制拼回：执行 ────────────────────────────────────

export type StreamCopyStats = {
  frames: { total: number; headCopied: number; reencoded: number; edited: number; tailCopied: number };
  editedFrameRange: { start: number; end: number };
  durationSec: number;
  sourceDurationSec: number;
  ssim: Array<{ frame: number; timeSec: number; ssim: number }>;
  minSsim: number;
  encode: { profile: string; level: number; pixFmt: string; fps: string; timescale: number; delayFrames: number };
  elapsedMs: number;
};
export type StreamCopySpliceResult = { ok: true; outPath: string; stats: StreamCopyStats } | { ok: false; reason: string };

async function countVideoPackets(file: string, run: MediaRun, signal: AbortSignal) {
  return readVideoPackets(file, run, signal);
}

/** 同帧 SSIM：两边都精确定位到该帧，只比一帧。 */
export async function frameSsim(a: string, b: string, timeSec: number, halfFrameSec: number, run: MediaRun, signal: AbortSignal): Promise<number> {
  const seek = timeSec - halfFrameSec > 0 ? ["-ss", (timeSec - halfFrameSec).toFixed(6)] : [];
  const { stderr } = await run("ffmpeg", ["-hide_banner", ...seek, "-i", a, ...seek, "-i", b, "-an",
    "-filter_complex", "[0:v]trim=end_frame=1,setpts=0[a];[1:v]trim=end_frame=1,setpts=0[b];[a][b]ssim",
    "-f", "null", "-"], signal);
  const hit = /SSIM[^\n]*All:([0-9.]+)/.exec(String(stderr));
  if (!hit) throw new Error("SSIM 读数缺失");
  return Number(hit[1]);
}

export async function spliceByStreamCopy(
  input: { sourceFile: string; editedFile: string; startSec: number; endSec: number; dir: string },
  run: MediaRun,
  signal: AbortSignal,
): Promise<StreamCopySpliceResult> {
  const startedAt = Date.now();
  const inspected = await inspectStreamCopySource(input.sourceFile, run, signal);
  if (!inspected.ok) return inspected;
  const src = inspected.source;
  const plan = planStreamCopySplice(src, input.startSec, input.endSec);
  if ("ok" in plan) return plan;
  const { editStart, editEnd, encodeStart, encodeEnd, frameCount } = plan;
  const frameSec = src.frameTicks / src.timescale, half = frameSec / 2;
  const timeOf = (frame: number) => src.firstPtsSec + (frame * src.frameTicks) / src.timescale;
  const seekTo = (frame: number) => (frame > 0 ? ["-ss", (timeOf(frame) - half).toFixed(6)] : []);
  const editedFrames = editEnd - editStart;

  // 编辑结果须覆盖选段（末尾几帧误差用尾帧冻结补齐，不变速）；过短交给回退路径按原口径报错
  const editedProbe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "json", input.editedFile], signal);
  const editedInfo = JSON.parse(String(editedProbe.stdout)) as { streams?: Array<{ duration?: string }>; format?: { duration?: string } };
  const editedSec = Number(editedInfo.streams?.[0]?.duration) || Number(editedInfo.format?.duration) || 0;
  if (!(editedSec >= editedFrames * frameSec - 0.3)) return no("edited_too_short");

  const part = (name: string) => path.join(input.dir, `splice-${name}.mp4`);
  const pieces: Array<{ file: string; frames: number }> = [];

  // 1) 前段：片头到重编码起点（关键帧）之前的全部包，原样复制
  if (encodeStart > 0) {
    await run("ffmpeg", ["-y", "-i", input.sourceFile, "-map", "0:v:0", "-c", "copy", "-frames:v", String(encodeStart), part("head")], signal);
    const got = await countVideoPackets(part("head"), run, signal);
    if (got.length !== encodeStart || !got[0]?.key) return no("head_copy_mismatch");
    pieces.push({ file: part("head"), frames: encodeStart });
  }

  // 2) 中段：切点到最近关键帧之间的原片帧 + 编辑段，按原片参数只编码一次
  const args: string[] = ["-y"], chains: string[] = [], labels: string[] = [];
  let index = 0;
  if (editStart > encodeStart) {
    args.push(...seekTo(encodeStart), "-i", input.sourceFile);
    chains.push(`[${index}:v]trim=end_frame=${editStart - encodeStart},setpts=PTS-STARTPTS,setsar=1,format=${src.pixFmt}[pre]`);
    labels.push("[pre]"); index++;
  }
  args.push("-i", input.editedFile);
  chains.push(`[${index}:v]fps=${src.fpsNum}/${src.fpsDen},scale=w=${src.width}:h=${src.height}:force_original_aspect_ratio=decrease,` +
    `pad=${src.width}:${src.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=${src.pixFmt},tpad=stop_mode=clone:stop_duration=2,` +
    `trim=end_frame=${editedFrames},setpts=PTS-STARTPTS[mid]`);
  labels.push("[mid]"); index++;
  if (encodeEnd > editEnd) {
    args.push(...seekTo(editEnd), "-i", input.sourceFile);
    chains.push(`[${index}:v]trim=end_frame=${encodeEnd - editEnd},setpts=PTS-STARTPTS,setsar=1,format=${src.pixFmt}[post]`);
    labels.push("[post]"); index++;
  }
  const x264 = [`sps-id=${REENCODE_PARAMETER_SET_ID}`, ...(src.delayFrames === 1 ? ["b-pyramid=none"] : [])].join(":");
  await run("ffmpeg", [...args,
    "-filter_complex", `${chains.join(";")};${labels.join("")}concat=n=${labels.length}:v=1:a=0[v]`,
    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "14",
    "-profile:v", src.profile, "-level", (src.level / 10).toFixed(1), "-pix_fmt", src.pixFmt,
    "-bf", src.delayFrames === 0 ? "0" : src.delayFrames === 1 ? "2" : "3",
    "-x264-params", x264,
    "-r", `${src.fpsNum}/${src.fpsDen}`, "-video_track_timescale", String(src.timescale),
    ...(src.color.range ? ["-color_range", src.color.range] : []),
    ...(src.color.space ? ["-colorspace", src.color.space] : []),
    ...(src.color.primaries ? ["-color_primaries", src.color.primaries] : []),
    ...(src.color.transfer ? ["-color_trc", src.color.transfer] : []),
    part("mid")], signal);
  const midPackets = await countVideoPackets(part("mid"), run, signal);
  if (midPackets.length !== encodeEnd - encodeStart) return no("reencode_frame_count");
  pieces.push({ file: part("mid"), frames: encodeEnd - encodeStart });

  // 3) 后段：重编码终点（关键帧）起到片尾，原样复制（按关键帧分段，时间戳归零）
  if (encodeEnd < frameCount) {
    const pattern = path.join(input.dir, "splice-tail-%d.mp4");
    await run("ffmpeg", ["-y", "-i", input.sourceFile, "-map", "0:v:0", "-c", "copy", "-f", "segment",
      "-segment_times", timeOf(encodeEnd).toFixed(6), "-segment_time_delta", half.toFixed(6),
      "-reset_timestamps", "1", "-segment_format", "mp4", pattern], signal);
    const tail = path.join(input.dir, "splice-tail-1.mp4");
    const got = await countVideoPackets(tail, run, signal).catch(() => []);
    if (got.length !== frameCount - encodeEnd || !got[0]?.key) return no("tail_copy_mismatch");
    pieces.push({ file: tail, frames: frameCount - encodeEnd });
  }

  // 4) concat demuxer 拼接画面；音轨整条取原片原样复制，不分段处理
  const list = path.join(input.dir, "splice-list.txt");
  await writeFile(list, ["ffconcat version 1.0", ...pieces.flatMap(p => [`file '${p.file.replace(/'/g, "'\\''")}'`, `duration ${(p.frames * frameSec).toFixed(6)}`])].join("\n") + "\n", "utf8");
  const outPath = part("out");
  const mux = await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-i", input.sourceFile,
    "-map", "0:v:0", "-map", "1:a?", "-c", "copy", "-map_metadata", "1",
    "-video_track_timescale", String(src.timescale), "-movflags", "+faststart", outPath], signal);
  if (/Non-monotonic DTS|non monotonically increasing dts/i.test(String(mux.stderr))) return no("splice_timestamp_discontinuity");

  // 5) 校验：帧数与逐帧时间戳须与原片完全一致，时长差 ≤0.25s，未改区间抽 3 帧 SSIM ≥0.99
  const outPackets = await countVideoPackets(outPath, run, signal);
  if (outPackets.length !== frameCount) return no("output_frame_count");
  for (let i = 1; i < outPackets.length; i++) if (outPackets[i].dts <= outPackets[i - 1].dts) return no("output_non_monotonic_dts");
  const outPts = outPackets.map(p => p.pts).sort((a, b) => a - b);
  for (let i = 0; i < frameCount; i++) if (outPts[i] - outPts[0] !== src.pts[i]) return no("output_timestamp_mismatch");
  const durationSec = (frameCount * src.frameTicks) / src.timescale;
  if (Math.abs(durationSec - src.durationSec) > SPLICE_MAX_DURATION_DRIFT_SEC) return no("output_duration_drift");
  const ssim: StreamCopyStats["ssim"] = [];
  for (const frame of pickUntouchedSampleFrames(plan)) {
    const value = await frameSsim(outPath, input.sourceFile, timeOf(frame), half, run, signal);
    ssim.push({ frame, timeSec: Number(timeOf(frame).toFixed(4)), ssim: value });
  }
  const minSsim = ssim.length ? Math.min(...ssim.map(s => s.ssim)) : 0;
  if (ssim.length < Math.min(3, frameCount - editedFrames) || !(minSsim >= STREAM_COPY_MIN_SSIM)) return no(`untouched_ssim_${minSsim.toFixed(4)}`);

  return {
    ok: true,
    outPath,
    stats: {
      frames: { total: frameCount, headCopied: encodeStart, reencoded: encodeEnd - encodeStart, edited: editedFrames, tailCopied: frameCount - encodeEnd },
      editedFrameRange: { start: editStart, end: editEnd },
      durationSec, sourceDurationSec: src.durationSec, ssim, minSsim,
      encode: { profile: src.profile, level: src.level, pixFmt: src.pixFmt, fps: `${src.fpsNum}/${src.fpsDen}`, timescale: src.timescale, delayFrames: src.delayFrames },
      elapsedMs: Date.now() - startedAt,
    },
  };
}

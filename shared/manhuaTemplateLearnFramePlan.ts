/**
 * 漫剧模板学习 · 自适应抽帧时间轴（纯函数，可单测）。
 *
 * 基线：前 5 秒内抽钩子帧 + 之后约每 10 秒一帧。
 * 语音/高潮窗：命中后该窗内改为约每 3 秒一帧。
 * 成稿红线：帧仅内部研究，不进用户可见成稿、不抄台词画面。
 */

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type ClimaxWindow = {
  startSec: number;
  endSec: number;
  reasonZh: string;
};

export type FramePlanResult = {
  durationSec: number;
  baseTimestamps: number[];
  climaxWindows: ClimaxWindow[];
  timestamps: number[];
  densifiedCount: number;
};

/** 前 5 秒钩子采样点 */
export const INTRO_HOOK_SEC = [1, 2.5, 5] as const;
export const BASE_STRIDE_SEC = 10;
export const CLIMAX_STRIDE_SEC = 3;
/** 高潮窗前后各扩这么多秒 */
export const CLIMAX_PAD_SEC = 4;

const CLIMAX_KEYWORDS =
  /打脸|反转|真相|爆发|高潮|杀招|翻盘|崩溃|跪|掌掴|揭穿|背叛|觉醒|进化|碾压|绝杀|反杀|夺冠|夺舍|血战|对决|哭|撕|崩/;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** 基线时间戳：前 5s 钩子 + 每 10s */
export function buildBaseFrameTimestamps(durationSec: number): number[] {
  const duration = Math.max(0.5, Number(durationSec) || 0);
  const out: number[] = [];
  for (const t of INTRO_HOOK_SEC) {
    if (t < duration - 0.05) out.push(round2(t));
  }
  for (let t = BASE_STRIDE_SEC; t < duration - 0.35; t += BASE_STRIDE_SEC) {
    out.push(round2(t));
  }
  // 保证片尾附近有一帧（若距上一帧够远）
  const tail = round2(Math.max(0.2, duration - 0.8));
  if (tail > 5 && (!out.length || tail - out[out.length - 1]! >= 4)) {
    out.push(tail);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** 从带时间戳的转写片段找高潮窗 */
export function detectClimaxWindowsFromTranscript(
  segments: TranscriptSegment[],
  durationSec: number,
): ClimaxWindow[] {
  const duration = Math.max(0.5, Number(durationSec) || 0);
  const windows: ClimaxWindow[] = [];
  for (const seg of segments || []) {
    const text = String(seg.text || "").trim();
    if (!text || !CLIMAX_KEYWORDS.test(text)) continue;
    const start = clamp(Number(seg.start) - CLIMAX_PAD_SEC, 0, duration);
    const end = clamp(Number(seg.end) + CLIMAX_PAD_SEC, 0, duration);
    if (end - start < 1.5) continue;
    windows.push({
      startSec: round2(start),
      endSec: round2(end),
      reasonZh: `对白命中：${text.slice(0, 24)}`,
    });
  }
  return mergeClimaxWindows(windows);
}

/**
 * 无转写时：用「非静音段」近似高潮（由 CLI 解析 ffmpeg silencedetect 后传入）。
 * speechRegions: 有声区间 [start,end]
 */
export function detectClimaxWindowsFromSpeechRegions(
  speechRegions: Array<{ start: number; end: number }>,
  durationSec: number,
): ClimaxWindow[] {
  const duration = Math.max(0.5, Number(durationSec) || 0);
  const scored = (speechRegions || [])
    .map((r) => ({
      start: clamp(Number(r.start), 0, duration),
      end: clamp(Number(r.end), 0, duration),
    }))
    .filter((r) => r.end - r.start >= 2.5)
    .map((r) => ({ ...r, len: r.end - r.start }))
    .sort((a, b) => b.len - a.len)
    .slice(0, 4);
  return mergeClimaxWindows(
    scored.map((r) => ({
      startSec: round2(clamp(r.start - CLIMAX_PAD_SEC, 0, duration)),
      endSec: round2(clamp(r.end + CLIMAX_PAD_SEC, 0, duration)),
      reasonZh: `有声加长段 ${r.len.toFixed(1)}s`,
    })),
  );
}

export function mergeClimaxWindows(windows: ClimaxWindow[]): ClimaxWindow[] {
  if (!windows.length) return [];
  const sorted = [...windows].sort((a, b) => a.startSec - b.startSec);
  const out: ClimaxWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (!last || w.startSec > last.endSec + 1.5) {
      out.push({ ...w });
      continue;
    }
    last.endSec = Math.max(last.endSec, w.endSec);
    last.reasonZh = `${last.reasonZh}；${w.reasonZh}`.slice(0, 120);
  }
  return out;
}

/** 在高潮窗内按 3s 加密 */
export function densifyTimestampsInWindows(
  base: number[],
  windows: ClimaxWindow[],
  durationSec: number,
  strideSec = CLIMAX_STRIDE_SEC,
): number[] {
  const duration = Math.max(0.5, Number(durationSec) || 0);
  const set = new Set(base.map(round2));
  for (const w of windows) {
    const start = clamp(w.startSec, 0, duration);
    const end = clamp(w.endSec, 0, duration);
    for (let t = start; t <= end + 0.001; t += strideSec) {
      const x = round2(t);
      if (x > 0.05 && x < duration - 0.05) set.add(x);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function buildAdaptiveFramePlan(input: {
  durationSec: number;
  transcriptSegments?: TranscriptSegment[];
  /** Gemini 音频分段（优先于静音检测） */
  geminiSections?: Array<{
    name?: string;
    timeRange?: string;
    energy?: string;
    lyrics?: string;
    mood?: string;
  }>;
  speechRegions?: Array<{ start: number; end: number }>;
}): FramePlanResult {
  const durationSec = Math.max(0.5, Number(input.durationSec) || 0);
  const baseTimestamps = buildBaseFrameTimestamps(durationSec);
  let climaxWindows = detectClimaxWindowsFromGeminiAudioSections(
    input.geminiSections || [],
    durationSec,
  );
  if (!climaxWindows.length) {
    climaxWindows = detectClimaxWindowsFromTranscript(
      input.transcriptSegments || [],
      durationSec,
    );
  }
  if (!climaxWindows.length && input.speechRegions?.length) {
    climaxWindows = detectClimaxWindowsFromSpeechRegions(input.speechRegions, durationSec);
  }
  const timestamps = densifyTimestampsInWindows(baseTimestamps, climaxWindows, durationSec);
  return {
    durationSec,
    baseTimestamps,
    climaxWindows,
    timestamps,
    densifiedCount: Math.max(0, timestamps.length - baseTimestamps.length),
  };
}

/** 解析 ffmpeg silencedetect 日志 → 有声区间 */
/** 解析 "0:58-1:12" / "58-72" / "1:02.5-1:20" → 秒 */
export function parseTimeRangeToSec(range: string): { start: number; end: number } | null {
  const raw = String(range || "").trim();
  if (!raw) return null;
  const m = raw.match(
    /^(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?\s*[-–~～到至]\s*(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?/,
  );
  if (!m) return null;
  const toSec = (a: string, b?: string) => {
    if (b == null || b === "") return Number(a);
    return Number(a) * 60 + Number(b);
  };
  const start = toSec(m[1]!, m[2]);
  const end = toSec(m[3]!, m[4]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start: round2(start), end: round2(end) };
}

/**
 * 把 Gemini 音频分段（含 timeRange / energy / 对白）转成高潮窗。
 * 高能量段或关键词命中都会加密抽帧。
 */
export function detectClimaxWindowsFromGeminiAudioSections(
  sections: Array<{
    name?: string;
    timeRange?: string;
    energy?: string;
    lyrics?: string;
    mood?: string;
  }>,
  durationSec: number,
): ClimaxWindow[] {
  const duration = Math.max(0.5, Number(durationSec) || 0);
  const windows: ClimaxWindow[] = [];
  for (const sec of sections || []) {
    const tr = parseTimeRangeToSec(String(sec.timeRange || ""));
    if (!tr) continue;
    const hay = `${sec.name || ""} ${sec.lyrics || ""} ${sec.mood || ""} ${sec.energy || ""}`;
    const highEnergy = /极高|很高|高|爆发|紧张/.test(String(sec.energy || ""));
    const nameHit = /高潮|副歌|爆发|对决|反转|打脸|决战/.test(String(sec.name || ""));
    const textHit = CLIMAX_KEYWORDS.test(hay);
    if (!highEnergy && !nameHit && !textHit) continue;
    windows.push({
      startSec: round2(clamp(tr.start - CLIMAX_PAD_SEC, 0, duration)),
      endSec: round2(clamp(tr.end + CLIMAX_PAD_SEC, 0, duration)),
      reasonZh: `音频段·${String(sec.name || "高潮").slice(0, 12)}·${String(sec.energy || "").slice(0, 6)}`,
    });
  }
  return mergeClimaxWindows(windows);
}

export function speechRegionsFromSilenceDetectLog(
  logText: string,
  durationSec: number,
): Array<{ start: number; end: number }> {
  const duration = Math.max(0.5, Number(durationSec) || 0);
  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];
  for (const line of String(logText || "").split(/\r?\n/)) {
    const a = line.match(/silence_start:\s*([0-9.]+)/);
    if (a) silenceStarts.push(Number(a[1]));
    const b = line.match(/silence_end:\s*([0-9.]+)/);
    if (b) silenceEnds.push(Number(b[1]));
  }
  // 有声 = 静音之间的空隙
  const regions: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  const events: Array<{ t: number; kind: "start" | "end" }> = [
    ...silenceStarts.map((t) => ({ t, kind: "start" as const })),
    ...silenceEnds.map((t) => ({ t, kind: "end" as const })),
  ].sort((x, y) => x.t - y.t);

  let inSilence = false;
  for (const ev of events) {
    if (ev.kind === "start") {
      if (!inSilence && ev.t > cursor + 0.4) {
        regions.push({ start: cursor, end: ev.t });
      }
      inSilence = true;
    } else {
      cursor = ev.t;
      inSilence = false;
    }
  }
  if (!inSilence && cursor < duration - 0.4) {
    regions.push({ start: cursor, end: duration });
  }
  if (!events.length && duration > 1) {
    regions.push({ start: 0, end: duration });
  }
  return regions
    .map((r) => ({
      start: round2(clamp(r.start, 0, duration)),
      end: round2(clamp(r.end, 0, duration)),
    }))
    .filter((r) => r.end > r.start + 0.5);
}

/**
 * 补扫取帧秒位规划（**纯函数、零外呼、可单测**）。
 *
 * 用户 0920 拍板「改」：不再让厂商按 1 秒 1 帧均匀抽，改成**我们按信号决定抽哪几秒**。
 *
 * 为什么不是「按 Gemini 已标的 keyMoments 取帧」——用户戳破的循环论证：
 * 补扫的目的正是找 Gemini **漏掉**的，照它标的地方取帧，按构造就永远找不到漏的。
 *
 * 为什么不用 LLM 决定秒位：切点与有声区间是**纯信号**，ffmpeg 就能测：
 *   · `select='gt(scene,N)'` → 真实剪辑切点
 *   · `silencedetect`        → 有声区间（说话/爆音密集处＝戏多的地方）
 * 模型只负责「这一帧精不精彩、是不是广告、跟不跟剧情相关」——那才需要理解内容。
 *
 * 取帧密度沿用旧抽帧链已验的档位（shared/manhuaTemplateLearnFramePlan.ts）：
 * 有声/切点密集处密、静段疏。
 */

/** 高潮（有声）窗内的取帧步长：密。 */
export const SWEEP_CLIMAX_STRIDE_SEC = 1.5;
/** 静段取帧步长：疏。 */
export const SWEEP_BASE_STRIDE_SEC = 8;
/** 切点两侧各取一帧的偏移：看得到「切之前」与「切之后」。 */
export const SWEEP_CUT_PAD_SEC = 0.3;
/** 同一秒位去重粒度。 */
export const SWEEP_DEDUPE_SEC = 0.5;

export type SweepFramePlanInput = {
  /** 本片时长（秒）。 */
  lenSec: number;
  /** ffmpeg scene 检测出的切点（**段内局部秒**）。 */
  sceneCutsSec?: readonly number[];
  /** ffmpeg silencedetect 推出的有声区间（**段内局部秒**）。 */
  speechRegions?: ReadonlyArray<{ start: number; end: number }>;
  /** 本次最多取多少帧。预算闸：帧多＝输入 token 多＝钱。 */
  maxFrames: number;
};

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 产出**段内局部秒**的取帧秒位表，升序、已去重、已截到 maxFrames。
 *
 * 优先级（预算不够时按此保留）：
 *   ① 切点两侧   —— 最贵的信息，帧间差分抓不到但切点位置抓得到
 *   ② 有声窗内   —— 戏多的地方
 *   ③ 静段均匀   —— 兜底覆盖，避免整段只盯着热闹处
 */
export function buildManhuaNativeSweepFramePlan(input: SweepFramePlanInput): number[] {
  const lenSec = Math.max(0, Number(input.lenSec) || 0);
  if (lenSec <= 0) return [];
  const maxFrames = Math.max(0, Math.floor(Number(input.maxFrames) || 0));
  if (maxFrames === 0) return [];
  const clamp = (v: number) => Math.min(Math.max(0, round1(v)), round1(Math.max(0, lenSec - 0.1)));

  const tier1: number[] = [];
  for (const cut of input.sceneCutsSec ?? []) {
    const c = Number(cut);
    if (!Number.isFinite(c) || c < 0 || c > lenSec) continue;
    tier1.push(clamp(c - SWEEP_CUT_PAD_SEC));
    tier1.push(clamp(c + SWEEP_CUT_PAD_SEC));
  }

  const tier2: number[] = [];
  for (const region of input.speechRegions ?? []) {
    const start = Number(region?.start);
    const end = Number(region?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (let t = Math.max(0, start); t < Math.min(end, lenSec); t += SWEEP_CLIMAX_STRIDE_SEC) {
      tier2.push(clamp(t));
    }
  }

  const tier3: number[] = [];
  for (let t = 0; t < lenSec; t += SWEEP_BASE_STRIDE_SEC) tier3.push(clamp(t));

  const out: number[] = [];
  const taken: number[] = [];
  const tooClose = (v: number) => taken.some((t) => Math.abs(t - v) < SWEEP_DEDUPE_SEC);
  for (const tier of [tier1, tier2, tier3]) {
    for (const v of tier) {
      if (out.length >= maxFrames) break;
      if (tooClose(v)) continue;
      taken.push(v);
      out.push(v);
    }
    if (out.length >= maxFrames) break;
  }
  return out.sort((a, b) => a - b);
}

/** 解析 `ffmpeg -vf "select='gt(scene,N)',showinfo"` 的 stderr → 切点局部秒。 */
export function parseSweepSceneCutsFromShowinfo(stderr: string): number[] {
  const out: number[] = [];
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(stderr || ""))) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v >= 0) out.push(round1(v));
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/**
 * 解析 `silencedetect` 的 stderr → **有声**区间（静音段的补集）。
 * 只用 silence_start / silence_end 两个标记，缺尾时用 lenSec 收口。
 */
export function parseSweepSpeechRegionsFromSilenceLog(
  stderr: string,
  lenSec: number,
): Array<{ start: number; end: number }> {
  const marks: Array<{ kind: "start" | "end"; at: number }> = [];
  const re = /silence_(start|end):\s*(-?[0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(stderr || ""))) !== null) {
    const at = Number(m[2]);
    if (Number.isFinite(at)) marks.push({ kind: m[1] as "start" | "end", at: Math.max(0, at) });
  }
  marks.sort((a, b) => a.at - b.at);
  const regions: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.kind === "start") {
      if (mark.at > cursor) regions.push({ start: round1(cursor), end: round1(Math.min(mark.at, lenSec)) });
    } else {
      cursor = Math.max(cursor, mark.at);
    }
  }
  if (cursor < lenSec) regions.push({ start: round1(cursor), end: round1(lenSec) });
  return regions.filter((r) => r.end > r.start);
}

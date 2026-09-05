/**
 * 剪辑字幕轨数据：默认只生成轨/导出文案，不自动烧进成片；
 * 创作者主动勾选「烧字进片」后才用 buildManhuaSubtitleBurnSrt 产出
 * 可进 ffmpeg 的 SRT（清洗防注入 + 毫秒整体取整）。
 */

import type { ManhuaRoughCutClip } from "./manhuaEditWorkflowBank.js";
import type { ManhuaFineCutByShot } from "./manhuaEditFineCut.js";
import { clampFineCut, fineCutEffectiveSec } from "./manhuaEditFineCut.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";

export type ManhuaSubtitleCue = {
  shotIndex: number;
  order: number;
  /** 时间线绝对起点（秒） */
  startSec: number;
  /** 时间线绝对终点（秒） */
  endSec: number;
  textZh: string;
};

export type BuildSubtitleCuesOpts = {
  roughClips: ManhuaRoughCutClip[];
  shots: ManhuaWorkbenchShot[];
  fineCutByShot?: ManhuaFineCutByShot;
  /** false 时返回空轨 */
  enabled: boolean;
};

export function buildManhuaSubtitleCues(opts: BuildSubtitleCuesOpts): ManhuaSubtitleCue[] {
  if (!opts.enabled) return [];
  const byShot = new Map(opts.shots.map((s) => [s.index, s]));
  let cursor = 0;
  const cues: ManhuaSubtitleCue[] = [];
  for (const c of opts.roughClips) {
    const trim = clampFineCut(c.durationSec, opts.fineCutByShot?.[c.shotIndex]);
    const eff = fineCutEffectiveSec(c.durationSec, trim);
    const dialogue = String(byShot.get(c.shotIndex)?.dialogueZh || "").trim();
    if (dialogue) {
      cues.push({
        shotIndex: c.shotIndex,
        order: c.order,
        startSec: Math.round(cursor * 10) / 10,
        endSec: Math.round((cursor + eff) * 10) / 10,
        textZh: dialogue,
      });
    }
    cursor += eff;
  }
  return cues;
}

/** 简易 SRT 文本（导出/预览用，不自动烧字） */
export function formatManhuaSubtitleSrt(cues: ManhuaSubtitleCue[]): string {
  if (!cues.length) return "";
  // 预览／复制与烧字共用整毫秒进位，不能生成 59,1000 这种非法时间码。
  const ts = (sec: number) => subtitleTimecode(Math.round(sec * 1000));
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.startSec)} --> ${ts(c.endSec)}\n${c.textZh}\n`)
    .join("\n");
}

// ---------------------------------------------------------------- 烧字进片用 SRT

/**
 * 烧字前的台词清洗。台词最终写进 ffmpeg subtitles 滤镜读的 SRT 文件，
 * 每条规则都在堵一个真实注入口，不是美化：
 * - \r 去掉：\r\n 混排会被部分解析器当空行，提前断 cue；
 * - {} 换全角：libass 把 {...} 当 ASS 样式覆写块，台词里出现即样式注入口；
 * - --> 换箭头：防台词整行伪装成时间码行；
 * - 行内空行滤掉：空行是 SRT 的 cue 结束符，留着就能在台词里伪造第二条 cue。
 */
export function sanitizeBurnSubtitleText(text: string): string {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/-->/g, "→")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/** 毫秒 → HH:MM:SS,mmm。输入已整体取整，不会再出现 1000ms 进位残位。 */
function subtitleTimecode(totalMs: number): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(totalMs % 1000, 3)}`;
}

/**
 * 字幕轨 → 真正进 ffmpeg 的 SRT 文本。
 * 与导出／预览共用时间码格式；烧字额外执行台词清洗与时间范围校验：
 * - 毫秒先整体取整再拆位：秒数尾差按位拆会出 "01,1000" 这类坏时间码；
 * - 台词过 sanitizeBurnSubtitleText，清洗后全空视同空轨；
 * - 时间码非法（负数/终点不晚于起点）直接报错，宁可不入队也不烧出错位片。
 */
export function buildManhuaSubtitleBurnSrt(track: ManhuaSubtitleCue[]): string {
  if (!track.length) throw new Error("字幕轨为空，无法烧字");
  const cleaned = track
    .map((cue) => ({ ...cue, textZh: sanitizeBurnSubtitleText(cue.textZh) }))
    .filter((cue) => cue.textZh.length > 0)
    .sort((a, b) => a.startSec - b.startSec || a.order - b.order);
  if (!cleaned.length) throw new Error("字幕轨清洗后没有可烧的台词");

  const lines: string[] = [];
  cleaned.forEach((cue, i) => {
    const startMs = Math.round(cue.startSec * 1000);
    const endMs = Math.round(cue.endSec * 1000);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new Error(`字幕时间码不可用（镜 ${cue.shotIndex}）`);
    }
    lines.push(String(i + 1), `${subtitleTimecode(startMs)} --> ${subtitleTimecode(endMs)}`, cue.textZh, "");
  });
  return lines.join("\n");
}

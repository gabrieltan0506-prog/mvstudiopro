/**
 * 剪辑字幕轨数据：只生成轨/导出文案，默认不烧进成片。
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
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const ts = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.startSec)} --> ${ts(c.endSec)}\n${c.textZh}\n`)
    .join("\n");
}

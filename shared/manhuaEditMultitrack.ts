/**
 * 剪辑多轨：按粗剪序 + 细剪进出点铺 V1/V2/A1/字幕轨。
 */

import type { ManhuaRoughCutClip } from "./manhuaEditWorkflowBank.js";
import type { ManhuaFineCutByShot } from "./manhuaEditFineCut.js";
import { clampFineCut, fineCutEffectiveSec } from "./manhuaEditFineCut.js";
import { buildManhuaSubtitleCues } from "./manhuaEditSubtitle.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";

export type ManhuaEditTrackKind = "v1_still" | "v2_clip" | "a1_dialogue" | "srt_subtitle";

export type ManhuaEditTrackSegment = {
  shotIndex: number;
  order: number;
  durationSec: number;
  inSec: number;
  outSec: number;
  /** 0–1 相对整条时间线起点 */
  startRatio: number;
  /** 0–1 宽度占比 */
  widthRatio: number;
  labelZh: string;
  hasMedia: boolean;
  dialogueZh?: string;
};

export type ManhuaEditTrack = {
  kind: ManhuaEditTrackKind;
  nameZh: string;
  hintZh: string;
  segments: ManhuaEditTrackSegment[];
};

export type BuildMultitrackOpts = {
  roughClips: ManhuaRoughCutClip[];
  shots: ManhuaWorkbenchShot[];
  stillIndexes?: Set<number>;
  clipIndexes?: Set<number>;
  fineCutByShot?: ManhuaFineCutByShot;
  /** 字幕轨：开则写入对白文案；默认不烧进成片 */
  subtitleEnabled?: boolean;
};

export function buildManhuaEditMultitrack(opts: BuildMultitrackOpts): {
  totalSec: number;
  tracks: ManhuaEditTrack[];
} {
  const clips = opts.roughClips;
  const byShot = new Map(opts.shots.map((s) => [s.index, s]));

  type Laid = {
    shotIndex: number;
    order: number;
    durationSec: number;
    inSec: number;
    outSec: number;
    timelineStart: number;
    dialogueZh?: string;
    labelZh: string;
  };

  let cursor = 0;
  const laid: Laid[] = clips.map((c) => {
    const shot = byShot.get(c.shotIndex);
    const trim = clampFineCut(c.durationSec, opts.fineCutByShot?.[c.shotIndex]);
    const durationSec = fineCutEffectiveSec(c.durationSec, trim);
    const row: Laid = {
      shotIndex: c.shotIndex,
      order: c.order,
      durationSec,
      inSec: trim.inSec,
      outSec: trim.outSec,
      timelineStart: cursor,
      dialogueZh: shot?.dialogueZh,
      labelZh: c.labelZh,
    };
    cursor += durationSec;
    return row;
  });

  const totalSec = Math.max(1, Math.round(cursor * 10) / 10);

  const toSeg = (s: Laid, patch: Partial<ManhuaEditTrackSegment>): ManhuaEditTrackSegment => ({
    shotIndex: s.shotIndex,
    order: s.order,
    durationSec: s.durationSec,
    inSec: s.inSec,
    outSec: s.outSec,
    startRatio: s.timelineStart / totalSec,
    widthRatio: Math.max(0.04, s.durationSec / totalSec),
    labelZh: s.labelZh,
    hasMedia: false,
    dialogueZh: s.dialogueZh,
    ...patch,
  });

  const v1: ManhuaEditTrack = {
    kind: "v1_still",
    nameZh: "V1 静帧",
    hintZh: "按粗剪序排列的分镜静帧",
    segments: laid.map((s) =>
      toSeg(s, {
        hasMedia: opts.stillIndexes?.has(s.shotIndex) ?? false,
        labelZh: `静帧 ${String(s.shotIndex).padStart(2, "0")}`,
      }),
    ),
  };

  const v2: ManhuaEditTrack = {
    kind: "v2_clip",
    nameZh: "V2 成片",
    hintZh: "同序片段 · 已套细剪进出点",
    segments: laid.map((s) =>
      toSeg(s, {
        hasMedia: opts.clipIndexes?.has(s.shotIndex) ?? false,
        labelZh: `成片 ${String(s.shotIndex).padStart(2, "0")} · ${s.inSec}-${s.outSec}s`,
      }),
    ),
  };

  const a1: ManhuaEditTrack = {
    kind: "a1_dialogue",
    nameZh: "A1 对白",
    hintZh: "台词提示轨（不烧字）",
    segments: laid.map((s) =>
      toSeg(s, {
        hasMedia: Boolean(s.dialogueZh),
        labelZh: s.dialogueZh ? `「${s.dialogueZh.slice(0, 12)}」` : "（无对白）",
      }),
    ),
  };

  const cues = buildManhuaSubtitleCues({
    roughClips: clips,
    shots: opts.shots,
    fineCutByShot: opts.fineCutByShot,
    enabled: Boolean(opts.subtitleEnabled),
  });
  const cueByShot = new Map(cues.map((c) => [c.shotIndex, c]));

  const srt: ManhuaEditTrack = {
    kind: "srt_subtitle",
    nameZh: "字幕",
    hintZh: opts.subtitleEnabled
      ? `字幕轨已开 · ${cues.length} 条（默认不烧进成片）`
      : "关闭时不生成轨数据（默认不烧字）",
    segments: laid.map((s) => {
      const cue = cueByShot.get(s.shotIndex);
      return toSeg(s, {
        hasMedia: Boolean(cue),
        labelZh: cue ? cue.textZh.slice(0, 14) : "—",
      });
    }),
  };

  return { totalSec, tracks: [v1, v2, a1, srt] };
}

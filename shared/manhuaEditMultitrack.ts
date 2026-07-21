/**
 * 剪辑多轨骨架数据（D1）：按粗剪序铺 V1 静帧 / V2 成片 / A1 对白 / 字幕占位。
 */

import type { ManhuaRoughCutClip } from "./manhuaEditWorkflowBank.js";
import { roughCutTotalSec } from "./manhuaEditWorkflowBank.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";

export type ManhuaEditTrackKind = "v1_still" | "v2_clip" | "a1_dialogue" | "srt_subtitle";

export type ManhuaEditTrackSegment = {
  shotIndex: number;
  order: number;
  durationSec: number;
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
  /** 字幕轨占位：D1 仅展示空段，D2 再填文案 */
  subtitleEnabled?: boolean;
};

export function buildManhuaEditMultitrack(opts: BuildMultitrackOpts): {
  totalSec: number;
  tracks: ManhuaEditTrack[];
} {
  const clips = opts.roughClips;
  const totalSec = Math.max(1, roughCutTotalSec(clips));
  const byShot = new Map(opts.shots.map((s) => [s.index, s]));
  let cursor = 0;
  const baseSegs: ManhuaEditTrackSegment[] = clips.map((c) => {
    const shot = byShot.get(c.shotIndex);
    const startRatio = cursor / totalSec;
    const widthRatio = c.durationSec / totalSec;
    cursor += c.durationSec;
    return {
      shotIndex: c.shotIndex,
      order: c.order,
      durationSec: c.durationSec,
      startRatio,
      widthRatio: Math.max(0.04, widthRatio),
      labelZh: c.labelZh,
      hasMedia: false,
      dialogueZh: shot?.dialogueZh,
    };
  });

  const v1: ManhuaEditTrack = {
    kind: "v1_still",
    nameZh: "V1 静帧",
    hintZh: "按粗剪序排列的分镜静帧",
    segments: baseSegs.map((s) => ({
      ...s,
      hasMedia: opts.stillIndexes?.has(s.shotIndex) ?? false,
      labelZh: `静帧 ${String(s.shotIndex).padStart(2, "0")}`,
    })),
  };

  const v2: ManhuaEditTrack = {
    kind: "v2_clip",
    nameZh: "V2 成片",
    hintZh: "同序片段成片",
    segments: baseSegs.map((s) => ({
      ...s,
      hasMedia: opts.clipIndexes?.has(s.shotIndex) ?? false,
      labelZh: `成片 ${String(s.shotIndex).padStart(2, "0")}`,
    })),
  };

  const a1: ManhuaEditTrack = {
    kind: "a1_dialogue",
    nameZh: "A1 对白",
    hintZh: "台词提示轨（不烧字）",
    segments: baseSegs.map((s) => ({
      ...s,
      hasMedia: Boolean(s.dialogueZh),
      labelZh: s.dialogueZh ? `「${s.dialogueZh.slice(0, 12)}」` : "（无对白）",
    })),
  };

  const srt: ManhuaEditTrack = {
    kind: "srt_subtitle",
    nameZh: "字幕",
    hintZh: opts.subtitleEnabled
      ? "字幕轨已开（默认不烧进成片）"
      : "占位轨 · 可开关（默认关闭烧字）",
    segments: baseSegs.map((s) => ({
      ...s,
      hasMedia: Boolean(opts.subtitleEnabled && s.dialogueZh),
      labelZh: opts.subtitleEnabled && s.dialogueZh ? "字幕" : "—",
    })),
  };

  return { totalSec, tracks: [v1, v2, a1, srt] };
}

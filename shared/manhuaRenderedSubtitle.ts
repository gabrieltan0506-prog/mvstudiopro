import type { ManhuaSubtitleCue } from "./manhuaEditSubtitle.js";
import { resolveManhuaShotWindowsForSegment } from "./manhuaEditAutoCut.js";

/** 合成时冻结的对白来源；秒位仍由实际源片探测与裁切决定，不是语音识别回执。 */
export type ManhuaSubtitleSource = {
  directorPrompt?: string;
  shots: Array<{ shotIndex: number; durationSec: number; textZh: string }>;
};
export type ManhuaRenderedSubtitle = {
  version: 1;
  textSource: "assembly_script_snapshot";
  timing: "rendered_shot_windows";
  durationSec: number;
  cues: ManhuaSubtitleCue[];
};

export function normalizeManhuaSubtitleSource(raw: unknown): ManhuaSubtitleSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as ManhuaSubtitleSource;
  if (!Array.isArray(row.shots) || !row.shots.length) return undefined;
  const seen = new Set<number>();
  for (const shot of row.shots) {
    if (!shot || !Number.isInteger(shot.shotIndex) || shot.shotIndex < 1 ||
      seen.has(shot.shotIndex) || !Number.isFinite(shot.durationSec) || shot.durationSec <= 0 ||
      typeof shot.textZh !== "string") return undefined;
    seen.add(shot.shotIndex);
  }
  return { directorPrompt: typeof row.directorPrompt === "string" ? row.directorPrompt : undefined,
    shots: row.shots.map(shot => ({ shotIndex: shot.shotIndex, durationSec: shot.durationSec, textZh: shot.textZh })) };
}

export function normalizeManhuaRenderedSubtitle(raw: unknown): ManhuaRenderedSubtitle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as ManhuaRenderedSubtitle;
  if (row.version !== 1 || row.textSource !== "assembly_script_snapshot" || row.timing !== "rendered_shot_windows" ||
    !Number.isFinite(row.durationSec) || row.durationSec <= 0 || !Array.isArray(row.cues)) return undefined;
  for (const cue of row.cues) {
    if (!cue || !Number.isInteger(cue.shotIndex) || cue.shotIndex < 1 ||
      !Number.isInteger(cue.order) || cue.order < 1 || typeof cue.textZh !== "string" ||
      !Number.isFinite(cue.startSec) || !Number.isFinite(cue.endSec) ||
      cue.startSec < 0 || cue.endSec <= cue.startSec || cue.endSec > row.durationSec + 0.001) return undefined;
  }
  return { version: 1, textSource: "assembly_script_snapshot", timing: "rendered_shot_windows", durationSec: row.durationSec,
    cues: row.cues.map(cue => ({ shotIndex: cue.shotIndex, order: cue.order,
      startSec: cue.startSec, endSec: cue.endSec, textZh: cue.textZh })) };
}

/** 原片镜窗 ∩ 实际裁切窗口，返回裁切后的局部字幕；不填补被裁掉的对白。 */
export function subtitleCuesForRenderedSource(input: {
  source: ManhuaSubtitleSource; sourceDuration: number; trimStart: number;
  renderedDuration: number; shotIndex?: number;
}): ManhuaSubtitleCue[] {
  const windows = resolveManhuaShotWindowsForSegment({ directorPrompt: input.source.directorPrompt,
    videoDurationSec: input.sourceDuration, shots: input.source.shots });
  return windows.flatMap(window => {
    const textZh = input.source.shots.find(shot => shot.shotIndex === window.shotIndex)?.textZh.trim();
    if (!textZh || (input.shotIndex != null && input.shotIndex !== window.shotIndex)) return [];
    const startSec = Math.max(0, window.winStart - input.trimStart);
    const endSec = Math.min(input.renderedDuration, window.winEnd - input.trimStart);
    return endSec > startSec ? [{ shotIndex: window.shotIndex, order: 1, startSec, endSec, textZh }] : [];
  });
}

/** 与实际声画转场共用同一重叠长度，静帧也参与累计，但不产生字幕。 */
export function manhuaRenderOverlap(previous: number, next: number, transition: unknown): number {
  return String(transition || "cut").trim().toLowerCase() === "fade" ? Math.min(1, previous / 2, next / 2) : 0;
}

export function buildRenderedSubtitleTimeline(
  clips: Array<{ duration: number; cues: ManhuaSubtitleCue[] }>, transition: unknown, actualDuration: number,
): ManhuaRenderedSubtitle {
  let cursor = 0;
  const cues: ManhuaSubtitleCue[] = [];
  clips.forEach((clip, index) => {
    if (index) cursor -= manhuaRenderOverlap(clips[index - 1]!.duration, clip.duration, transition);
    clip.cues.forEach(cue => {
      const startSec = Math.round(Math.max(0, cursor + cue.startSec) * 1000) / 1000;
      // 浮点累计的3.999999999不能错误裁掉整毫秒；仍以实际视频终点封顶。
      const endSec = Math.floor((Math.min(actualDuration, cursor + cue.endSec) + 1e-9) * 1000) / 1000;
      if (endSec > startSec) cues.push({ ...cue, startSec, endSec, order: cues.length + 1 });
    });
    cursor += clip.duration;
  });
  return { version: 1, textSource: "assembly_script_snapshot", timing: "rendered_shot_windows", durationSec: actualDuration, cues };
}

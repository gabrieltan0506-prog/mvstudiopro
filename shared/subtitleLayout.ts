import { normalizeDialogueSubtitleSrt } from "./dialogueSubtitleSrt";
import type { SubtitleHighlight } from "./subtitleHighlights";

const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });
const closingPunctuation = /^[，。！？、；：）》」』】,.!?;:]$/;
const widthUnits = (char: string) =>
  /^[\x20-\x7e]$/.test(char) ? (/[MW@]/.test(char) ? 1 : 0.65) : 1;

/** 按字素换行，保留显式换行与每个对白字，避免句首孤立标点。 */
export function wrapSubtitleEffectText(
  text: string,
  maxUnits: number
): string[] {
  const lines: string[] = [];
  for (const original of text.split("\n")) {
    let current: string[] = [];
    let units = 0;
    for (const { segment } of Array.from(graphemes.segment(original))) {
      const width = widthUnits(segment);
      if (current.length && units + width > maxUnits) {
        // 标点随前一个字换行，避免句首孤立标点。
        const carry =
          closingPunctuation.test(segment) &&
          current.length > 1 &&
          widthUnits(current[current.length - 1]) + width <= maxUnits
            ? current.pop()!
            : "";
        lines.push(current.join(""));
        current = carry ? [carry] : [];
        units = carry ? widthUnits(carry) : 0;
      }
      current.push(segment);
      units += width;
    }
    if (current.length) lines.push(current.join(""));
  }
  return lines;
}

export type SubtitleLayoutCue = {
  startSec: number;
  endSec: number;
  lines: string[];
};
export function subtitleLayoutCues(
  srt: string,
  width: number,
  fontSize: number,
  outline = 0.35
): SubtitleLayoutCue[] {
  const marginH = Math.max(8, Math.ceil(width * 0.06));
  const maxUnits = (width - 2 * marginH - 2 * outline) / (fontSize * 1.1);
  if (maxUnits < 1) throw new Error("字幕字号过大，请缩小字号后重试");
  const seconds = (value: string) => {
    const [h, m, s, ms] = value.split(/[:,]/).map(Number);
    return h * 3600 + m * 60 + s + ms / 1000;
  };
  return normalizeDialogueSubtitleSrt(srt)
    .trim()
    .split(/\n\s*\n/)
    .map(block => {
      const [, times, ...text] = block.split("\n"),
        [startSec, endSec] = times.split(" --> ").map(seconds);
      return {
        startSec,
        endSec,
        lines: wrapSubtitleEffectText(text.join("\n"), maxUnits),
      };
    });
}
/** 全段固定重点位置，按相交时段的普通字幕和其他重点向上避让，避免随帧跳动。 */
export function placeSubtitleHighlights(
  highlights: SubtitleHighlight[],
  cues: SubtitleLayoutCue[],
  style: {
    fontSize: number;
    marginV: number;
    outline?: number;
    alignment?: 2 | 5 | 8;
  }
): SubtitleHighlight[] {
  type Box = { startSec: number; endSec: number; top: number; bottom: number };
  const boxes: Box[] = cues.map(cue => {
    const height =
      cue.lines.length * style.fontSize * 1.35 + 2 * (style.outline ?? 0.35);
    const top =
      style.alignment === 8
        ? style.marginV
        : style.alignment === 5
          ? (288 - height) / 2
          : 288 - style.marginV - height;
    return { ...cue, top, bottom: top + height };
  });
  return highlights.map(cue => {
    const above = cue.fontSize * 0.8 + 2,
      below =
        cue.effect === "spiral"
          ? cue.fontSize * 0.7 + 9
          : cue.fontSize * 0.8 + 2;
    const overlaps = boxes
      .filter(box => cue.startSec < box.endSec && cue.endSec > box.startSec)
      .sort((a, b) => b.top - a.top);
    const originalY = (288 * cue.positionPercent) / 100;
    let y = originalY;
    for (const box of overlaps) {
      if (y + below + 4 > box.top && y - above - 4 < box.bottom)
        y = box.top - below - 4;
    }
    if (y - above < 8)
      throw new Error(
        "同时出现的字幕放不下，请缩小字号、减少同屏重点或错开时间"
      );
    boxes.push({
      startSec: cue.startSec,
      endSec: cue.endSec,
      top: y - above,
      bottom: y + below,
    });
    return {
      ...cue,
      positionPercent: y === originalY ? cue.positionPercent : (y / 288) * 100,
    };
  });
}

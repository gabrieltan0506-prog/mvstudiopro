import { normalizeDialogueSubtitleSrt } from "../../shared/dialogueSubtitleSrt.js";
import type { SubtitleEffect } from "../../shared/subtitleEffects.js";
import { burnSubtitleStyleOverrideSchema, type BurnSubtitleStyleOverride } from "../jobs/postProdInput.js";

// ASS uses centiseconds. Quantize once, rather than accumulating per-cue offsets.
function assTime(ms: number): string {
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function srtTime(value: string): number {
  const [h, m, s, ms] = value.split(/[:,]/).map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + ms;
}

/** Plain dialogue only; user-provided ASS escapes must never become commands. */
function assText(value: string): string {
  return value.replace(/\\/g, "＼").replace(/\{/g, "｛").replace(/\}/g, "｝");
}

const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });
const closingPunctuation = /^[，。！？、；：）》」』】,.!?;:]$/;
const widthUnits = (char: string) => /^[\x20-\x7e]$/.test(char) ? (/[MW@]/.test(char) ? 1 : 0.65) : 1;

/** Conservative CJK wrapping; keep explicit line breaks and every dialogue character. */
export function wrapSubtitleEffectText(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  for (const original of text.split("\n")) {
    let current: string[] = [];
    let units = 0;
    for (const { segment } of Array.from(graphemes.segment(original))) {
      const width = widthUnits(segment);
      if (current.length && units + width > maxUnits) {
        // Carry the preceding character with punctuation instead of starting with a comma.
        const carry = closingPunctuation.test(segment) && current.length > 1
          && widthUnits(current[current.length - 1]) + width <= maxUnits ? current.pop()! : "";
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

/**
 * Generate native libass effects inside the existing ffmpeg job, with no model call.
 * Effect syntax follows https://aegisub.org/docs/latest/ass_tags/ (fad, t, fscx/fscy).
 * No guessed word timestamps: these effects animate whole cues only.
 */
export function buildSubtitleEffectAss(input: {
  subtitleSrt: string;
  effect: Exclude<SubtitleEffect, "none">;
  width: number;
  height: number;
  styleOverride?: BurnSubtitleStyleOverride;
}): string {
  if (!["fade", "pop"].includes(input.effect)) throw new Error("请选择有效的字幕特效");
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error("无法读取成片尺寸，不能排版字幕特效");
  }
  const style = burnSubtitleStyleOverrideSchema.parse(input.styleOverride ?? {});
  const fontSize = style.fontSize ?? 16;
  const outline = style.outline ?? 2;
  const marginV = style.marginV ?? 35;
  // Match the existing SRT renderer's 288-unit vertical font/margin scale.
  // Derive the horizontal canvas from the video, so portrait glyphs stay proportional.
  const playResY = 288;
  const playResX = Math.max(1, Math.round(playResY * input.width / input.height));
  const marginH = Math.max(8, Math.ceil(playResX * 0.06));
  const maxUnits = (playResX - 2 * marginH - 2 * outline) / (fontSize * 1.1);
  if (maxUnits < 1) throw new Error("字幕字号过大，请缩小字号后重试");
  const srt = normalizeDialogueSubtitleSrt(input.subtitleSrt);
  const events = srt.trim().split(/\n\s*\n/).map((block, index) => {
    const [, times, ...text] = block.split("\n");
    const [start, end] = times.split(" --> ").map(srtTime);
    const startCs = Math.round(start / 10), endCs = Math.round(end / 10);
    if (endCs <= startCs) throw new Error(`第${index + 1}条字幕太短，请调整时间码`);
    const durationMs = (endCs - startCs) * 10;
    const fadeMs = Math.min(160, Math.floor(durationMs / 4));
    const lines = wrapSubtitleEffectText(assText(text.join("\n")), maxUnits);
    if (lines.length * fontSize * 1.35 + 2 * outline > playResY - marginV - 8) {
      throw new Error(`第${index + 1}条字幕过长，请分条或缩小字号后重试`);
    }
    const animation = input.effect === "pop"
      ? `\\fscx94\\fscy94\\t(0,${Math.min(180, Math.floor(durationMs / 4))},\\fscx100\\fscy100)`
      : "";
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\fad(${fadeMs},${fadeMs})${animation}}${lines.join("\\N")}`;
  });
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${playResX}`, `PlayResY: ${playResY}`,
    "ScaledBorderAndShadow: yes", "WrapStyle: 2", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.fontName ?? "Noto Sans CJK SC"},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${outline},0,${style.alignment ?? 2},${marginH},${marginH},${marginV},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}

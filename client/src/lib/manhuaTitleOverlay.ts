import { buildManhuaSubtitleBurnSrt } from "@shared/manhuaEditSubtitle";

export type ManhuaTitleStyle = { fontSize: number; outline: number; marginV: number; fontName: string; alignment: 2 | 5 | 8 };
export type ManhuaTitlePayload = { subtitleSrt: string; effect: "none"; styleOverride: ManhuaTitleStyle };

/** A title uses the existing subtitle renderer and its text escaping, never raw ASS overrides. */
export function compileManhuaTitle(input: { text: string; startSec: number; endSec: number; fontSize: number; alignment: number }, durationSec?: number): ManhuaTitlePayload {
  if (!input.text.trim() || input.text.length > 120) throw new Error("请填写1至120字标题");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) throw new Error("标题不能包含控制字符");
  if (!Number.isFinite(durationSec) || !durationSec || durationSec <= 0) throw new Error("请等待原片时长读取完成");
  if (!Number.isFinite(input.startSec) || !Number.isFinite(input.endSec) || input.startSec < 0 || input.endSec <= input.startSec || input.endSec > durationSec) throw new Error("标题时段须在原片内，结束时间须晚于开始时间");
  if (!Number.isInteger(input.fontSize) || input.fontSize < 8 || input.fontSize > 96) throw new Error("标题字号须为8至96的整数");
  if (![2, 5, 8].includes(input.alignment)) throw new Error("请选择标题位置");
  return {
    subtitleSrt: buildManhuaSubtitleBurnSrt([{ shotIndex: 1, order: 1, startSec: input.startSec, endSec: input.endSec, textZh: input.text }]),
    effect: "none",
    styleOverride: { fontSize: input.fontSize, outline: 0.7, marginV: 24, fontName: "Noto Sans CJK SC", alignment: input.alignment as 2 | 5 | 8 },
  };
}

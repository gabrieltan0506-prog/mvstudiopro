import { buildManhuaSubtitleBurnSrt, type ManhuaSubtitleCue } from "./manhuaEditSubtitle.js";

/** 严格读取手工对白字幕，拒绝坏时间码；复用烧录文字清洗。 */
export function normalizeDialogueSubtitleSrt(raw: string, durationSec?: number): string {
  if (!raw.trim() || raw.length > 200_000) throw new Error("请填写有效的对白字幕，最多20万字符");
  const cues: ManhuaSubtitleCue[] = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").trim().split(/\n\s*\n/).map((block, index) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]!.trim())) lines.shift();
    const match = lines.shift()?.trim().match(/^(\d{2}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/);
    if (!match || !lines.join("").trim()) throw new Error(`第${index + 1}条字幕缺少有效时间码或对白`);
    const seconds = (offset: number) => Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    const startSec = seconds(1), endSec = seconds(5);
    if (endSec <= startSec || (durationSec != null && endSec > durationSec + 0.05)) throw new Error(`第${index + 1}条字幕超出视频或时间范围不正确`);
    return { shotIndex: index + 1, order: index + 1, startSec, endSec, textZh: lines.join("\n") };
  });
  return buildManhuaSubtitleBurnSrt(cues);
}

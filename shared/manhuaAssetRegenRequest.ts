/**
 * 设定图「重出」请求：用户自己说哪里要改进，再决定按描述重画、还是换成库里类似的那张。
 *
 * 产品口径（用户 2026-07-29 定）：
 * - 重出必须让用户先写「哪里要改进」，别再让他对着一张烧了字/性别飘了的图干瞪眼。
 * - 两条路都要**另外扣积分**，且都按「用库内资产」那档价：1 张 15、2 张 20（超出每张 +5）。
 *   换库里那张不生图也照收——用户拿走的是别人贡献的成品。
 */

import {
  manhuaLibraryAssetUseCredits,
  manhuaLibraryAssetUsePriceLabelZh,
} from "./manhuaAssetSharePricing.js";

/** 用户写的改进描述上限：够说清「刻字去掉、改成女性、衣服压深」，又不至于顶爆提示词 */
export const MANHUA_ASSET_REGEN_NOTE_MAX = 400;

export type ManhuaAssetRegenMode =
  /** 按用户描述重画（生图） */
  | "redraw"
  /** 直接换成公有库里挑的那张（不生图） */
  | "library";

export function normalizeManhuaAssetRegenNoteZh(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MANHUA_ASSET_REGEN_NOTE_MAX);
}

/**
 * 把用户的改进描述接到原提示词尾部。
 *
 * 放尾部是故意的：越靠后的指令越压得住前面的通用描述，用户点名的毛病（烧字、性别）才改得掉；
 * 同时明说「其余设定不变」，免得模型顺手把脸和服装一起重新设计，锁了半天的 ID 又漂。
 */
export function appendManhuaAssetRegenNoteZh(
  basePrompt: string,
  noteZh: unknown,
): string {
  const base = String(basePrompt || "").trim();
  const note = normalizeManhuaAssetRegenNoteZh(noteZh);
  if (!note) return base;
  const revision = [
    "本次重出的修订要求（用户指出的问题，必须改掉）：",
    note,
    "除上述修订外，其余人物身份、五官、体型、服装配色、场景与画风一律保持不变，不要重新设计。",
  ].join("\n");
  return base ? `${base}\n\n${revision}` : revision;
}

/** 重出报价：与「用库内资产」同档（1 张 15、2 张 20、超出每张 +5） */
export function quoteManhuaAssetRegenCredits(tileCount: number): number {
  return manhuaLibraryAssetUseCredits(tileCount);
}

export function manhuaAssetRegenPriceLabelZh(
  tileCount: number,
  mode: ManhuaAssetRegenMode = "redraw",
): string {
  const n = Math.max(1, Math.floor(Number(tileCount) || 1));
  if (mode === "library") return manhuaLibraryAssetUsePriceLabelZh(n);
  return `${quoteManhuaAssetRegenCredits(n)} 积分（重出 · ${n} 张）`;
}

/**
 * 节奏策略（PR-6）：可拍表段意图 + 导演包手法 + 是否有接触事件 → 快/慢/中档，
 * 给运镜文法（choreographManhuaCameras）的切镜上限、最短镜长、反应镜停留与风格档。
 * 纯函数、无副作用；reasonZh 一句话说明为何快/慢，进白模草案摘要。
 */
import type { ManhuaCameraStyle } from "./manhuaCameraGrammar";
import { getManhuaDirectionCard } from "./manhuaDirectionCanonLibrary";

export type ManhuaCameraTempoTier = "fast" | "slow" | "neutral";

export type ManhuaCameraTempo = {
  tier: ManhuaCameraTempoTier;
  style: ManhuaCameraStyle;
  maxCuts: number;
  minShotSec: number;
  reactionHoldSec: number;
  reasonZh: string;
  /** 导演卡「大场面/戏核/角色视点」：先用建立镜立戏核 */
  establishFirst?: boolean;
  /** 导演卡「非人角色先成为人物」：反应镜给非人角色 */
  reactionToNonHuman?: boolean;
  /** 反应镜焦段（默认 55） */
  reactionLens?: number;
};

export type ManhuaCameraTempoInput = {
  intentZh?: string;
  directionCardId?: string | null;
  /** 直接传手法文本（测试或无卡库时用）；与 directionCardId 叠加 */
  directionRulesText?: string;
  eventManner?: Record<string, "melee" | "ranged">;
  hasContact: boolean;
};

const FAST_WORDS = ["燃", "爽", "打脸", "逆袭", "神迹", "冲", "追", "砸", "爆"];
const SLOW_WORDS = ["戳", "亏欠", "牺牲", "揭底", "悬", "迟疑", "静", "疼"];

const PRESET: Record<ManhuaCameraTempoTier, Pick<ManhuaCameraTempo, "style" | "maxCuts" | "minShotSec" | "reactionHoldSec">> = {
  fast: { style: "hard", maxCuts: 8, minShotSec: 0.5, reactionHoldSec: 1.0 },
  slow: { style: "slow_orbit", maxCuts: 3, minShotSec: 3, reactionHoldSec: 4 },
  neutral: { style: "hard", maxCuts: 5, minShotSec: 1.5, reactionHoldSec: 2 },
};

export const MANHUA_TEMPO_TIER_LABEL_ZH: Record<ManhuaCameraTempoTier, string> = { fast: "快", slow: "慢", neutral: "中" };
export const MANHUA_CAMERA_STYLE_LABEL_ZH: Record<ManhuaCameraStyle, string> = { hard: "硬切", slow_orbit: "慢环绕", handheld: "手持" };

function cardRulesText(cardId: string | null | undefined): string {
  if (!cardId) return "";
  const card = getManhuaDirectionCard(cardId);
  if (!card) return "";
  return [card.labelZh, ...card.rules.flatMap((r) => [r.titleZh, r.ruleZh, r.predictZh ?? ""])].join("\n");
}

export function resolveManhuaCameraTempo(input: ManhuaCameraTempoInput): ManhuaCameraTempo {
  const intent = String(input.intentZh || "").trim();
  const hasContact = input.hasContact || Object.keys(input.eventManner ?? {}).length > 0;
  const fastHit = FAST_WORDS.filter((w) => intent.includes(w));
  const slowHit = SLOW_WORDS.filter((w) => intent.includes(w));

  let tier: ManhuaCameraTempoTier;
  let reason: string;
  if (hasContact || fastHit.length) {
    tier = "fast";
    reason = hasContact ? `有接触事件${fastHit.length ? `、意图「${fastHit.join("/")}」` : ""}，按快档切` : `意图「${fastHit.join("/")}」，按快档切`;
  } else if (slowHit.length) {
    tier = "slow";
    reason = `意图「${slowHit.join("/")}」且无接触，按慢档留长镜`;
  } else {
    tier = "neutral";
    reason = intent ? "意图无快慢词、无接触，按中档" : "无段意图、无接触，按中档";
  }
  const tempo: ManhuaCameraTempo = { tier, ...PRESET[tier], reasonZh: reason };

  const rules = [cardRulesText(input.directionCardId), input.directionRulesText || ""].join("\n");
  const cardNotes: string[] = [];
  if (/大场面|戏核|角色视点/.test(rules)) {
    tempo.style = "slow_orbit";
    tempo.establishFirst = true;
    cardNotes.push("先立戏核（慢环绕建立镜）");
  }
  if (/动作必须改变关系/.test(rules)) {
    if (tempo.tier !== "fast") Object.assign(tempo, { tier: "fast", ...PRESET.fast, style: tempo.style === "slow_orbit" ? "slow_orbit" : PRESET.fast.style });
    tempo.reactionHoldSec = Math.max(tempo.reactionHoldSec, 2);
    cardNotes.push("动作要改关系，反应镜 ≥2s");
  }
  if (/非人角色先成为人物/.test(rules)) {
    tempo.reactionToNonHuman = true;
    tempo.reactionLens = 55;
    cardNotes.push("反应镜给非人角色");
  }
  if (cardNotes.length) tempo.reasonZh = `${tempo.reasonZh}；导演包：${cardNotes.join("、")}`;
  return tempo;
}

/** 运镜句块的字符预算：最小引擎提示词上限 7000（Hailuo）减去正文，留 1200 给逐镜句足够放 8 镜 */
export const MANHUA_CAMERA_PROMPT_BLOCK_MAX_CHARS = 1200;

/** 把每镜运镜句追加进运动指引；超出 maxChars 逐镜从尾部丢，保留前面镜头 */
export function appendManhuaCameraPromptToMotionGuide(guideZh: string, cameraPromptZh: string[], maxChars: number): string {
  const guide = String(guideZh || "");
  const lines = cameraPromptZh.map((s) => String(s || "").trim()).filter(Boolean);
  if (!lines.length) return guide;
  const head = `${guide}\n运镜（逐镜）：`;
  if (head.length + lines[0]!.length > maxChars) return guide;
  let out = head;
  let n = 0;
  for (const l of lines) {
    const piece = (n ? "；" : "") + l;
    const tail = n + 1 < lines.length ? "；后续镜略".length : 0;
    if (out.length + piece.length + tail > maxChars) break;
    out += piece;
    n += 1;
  }
  if (n < lines.length) out += "；后续镜略";
  return out;
}

/**
 * 导演卡库（内置快照）+ 选卡 ↔ 提示词标记往返。
 * 卡片来自 gen-manhua-direction-canon-library 生成的去名快照；卡库只放过了卡级准入的卡。
 * 授权：目前全部内置卡对所有用户开放（商品位 P3 再接购买记录），authorizedCardIds 由本文件统一填。
 */
import {
  manhuaDirectionCardIsProductionReady,
  normalizeManhuaDirectionCanon,
  type ManhuaDirectionCanon,
  type ManhuaDirectionCard,
  type ManhuaDirectionSceneType,
} from "./manhuaDirectionCanon.js";
import type { ManhuaDirectorStrategyStage } from "./manhuaDirectorStrategy.js";
import { MANHUA_DIRECTION_CARDS_GENERATED } from "./manhuaDirectionCanonLibrary.generated.js";

export const MANHUA_DIRECTION_SCENE_TYPES: ManhuaDirectionSceneType[] = ["action", "dialogue", "reveal", "emotion", "transition"];
export const MANHUA_DIRECTION_SCENE_TYPE_LABEL_ZH: Record<ManhuaDirectionSceneType, string> = {
  action: "打戏",
  dialogue: "对白戏",
  reveal: "揭露戏",
  emotion: "情感戏",
  transition: "过场",
  default: "其他",
};
export const MANHUA_DIRECTION_SCENE_LABEL_ZH: Record<ManhuaDirectionSceneType, string> = {
  action: "动作场",
  dialogue: "对话场",
  reveal: "揭示场",
  emotion: "情感场",
  transition: "过场",
  default: "默认",
};

export function listManhuaDirectionCards(): ManhuaDirectionCard[] {
  return MANHUA_DIRECTION_CARDS_GENERATED.filter(manhuaDirectionCardIsProductionReady);
}

export function getManhuaDirectionCard(id: string): ManhuaDirectionCard | null {
  return listManhuaDirectionCards().find((c) => c.id === String(id || "").trim()) || null;
}

export type ManhuaDirectionSelection = {
  mainCardId: string;
  sceneOverrides?: Partial<Record<ManhuaDirectionSceneType, { cardId: string; stages?: ManhuaDirectorStrategyStage[] }>>;
};

/** 会话/请求回读：只留库里有的卡；主卡不在库 → null */
export function normalizeManhuaDirectionSelection(raw: unknown): ManhuaDirectionSelection | null {
  const canon = buildManhuaDirectionCanonFromSelection(raw && typeof raw === "object" ? (raw as ManhuaDirectionSelection) : null);
  if (!canon) return null;
  return { mainCardId: canon.mainCardId, ...(canon.sceneOverrides ? { sceneOverrides: canon.sceneOverrides } : {}) };
}

/** 用户选卡 → 法典；主卡不在库里返回 null（不猜、不换卡） */
export function buildManhuaDirectionCanonFromSelection(selection: ManhuaDirectionSelection | null | undefined): ManhuaDirectionCanon | null {
  if (!selection?.mainCardId) return null;
  const main = getManhuaDirectionCard(selection.mainCardId);
  if (!main) return null;
  const cards: ManhuaDirectionCard[] = [main];
  const sceneOverrides: NonNullable<ManhuaDirectionCanon["sceneOverrides"]> = {};
  for (const scene of MANHUA_DIRECTION_SCENE_TYPES) {
    const o = selection.sceneOverrides?.[scene];
    if (!o?.cardId) continue;
    const sub = getManhuaDirectionCard(o.cardId);
    if (!sub) continue;
    if (!cards.some((c) => c.id === sub.id)) cards.push(sub);
    sceneOverrides[scene] = { cardId: sub.id, ...(o.stages?.length ? { stages: o.stages } : {}) };
  }
  return normalizeManhuaDirectionCanon({
    version: 1,
    mainCardId: main.id,
    cards,
    sceneOverrides,
    authorizedCardIds: cards.map((c) => c.id),
  }) || null;
}

const SELECTION_MARKER_RE = /【导演法典选卡·v1·([a-z0-9_]+)((?:·[a-z]+=[a-z0-9_]+(?::[a-z,]+)?)*)】/;

/** 写进 story/beats 节点的选卡标记；下游阶段从已铺节点回读，硬刷新/续跑都不丢 */
export function formatManhuaDirectionSelectionMarker(canon: ManhuaDirectionCanon): string {
  const parts = [`main=${canon.mainCardId}`];
  for (const scene of MANHUA_DIRECTION_SCENE_TYPES) {
    const o = canon.sceneOverrides?.[scene];
    if (o) parts.push(`${scene}=${o.cardId}${o.stages?.length ? `:${o.stages.join(",")}` : ""}`);
  }
  return `【导演法典选卡·v1·${canon.mainCardId}${parts.slice(1).map((p) => `·${p}`).join("")}】`;
}

/** 从任一节点 prompt 回读选卡；没标记或卡已不在库 → null（不猜、不静默换卡） */
export function readManhuaDirectionCanonFromPrompt(prompt: string | null | undefined): ManhuaDirectionCanon | null {
  const m = SELECTION_MARKER_RE.exec(String(prompt || ""));
  if (!m) return null;
  const selection: ManhuaDirectionSelection = { mainCardId: m[1]!, sceneOverrides: {} };
  for (const seg of (m[2] || "").split("·").filter(Boolean)) {
    const [k, v] = seg.split("=");
    if (!k || !v || !(MANHUA_DIRECTION_SCENE_TYPES as string[]).includes(k)) continue;
    const [cardId, stagesRaw] = v.split(":");
    selection.sceneOverrides![k as ManhuaDirectionSceneType] = {
      cardId: cardId!,
      ...(stagesRaw ? { stages: stagesRaw.split(",") as ManhuaDirectorStrategyStage[] } : {}),
    };
  }
  return buildManhuaDirectionCanonFromSelection(selection);
}

/** 从一组节点里找第一份选卡（与 readManhuaDirectorStrategyContract 的用法对称） */
export function readManhuaDirectionCanonFromBlocks(blocks: Array<{ prompt?: string | null }>): ManhuaDirectionCanon | null {
  for (const b of blocks) {
    const canon = readManhuaDirectionCanonFromPrompt(b.prompt);
    if (canon) return canon;
  }
  return null;
}

/**
 * 去掉旧的导演法典投影段（含选卡标记），供「已铺节点同步设置」幂等重写。
 * 两种形态都要剥：多行形态（story/keyart，块在行首）；单行形态（beats/reverse 过了 stripManhuaPromptSlop，
 * `\n\n` 被压成一个空格，块夹在同一行里）。审查 P1：只认行首时 beats/reverse 每同步一次就多一份。
 */
export function stripManhuaDirectionStyleBlocks(prompt: string | null | undefined): string {
  return String(prompt || "")
    // 新格式：以闭合哨兵定边界（多行/单行通吃），不吞块后正文
    .replace(/\s?【导演法典·v1·[\s\S]*?【\/导演法典】/g, "")
    .replace(/ ?【导演法典选卡·v1·[^】]*】/g, "")
    // 旧格式（没有哨兵的历史节点）：多行形态按行首；单行形态只到下一个 【 为止
    .replace(/(?:^|\n)【导演法典·v1·[^\n]*(?:\n(?!\n)[^\n]*)*/g, "")
    .replace(/(?:^|\n)【导演法典选卡·v1·[^\n]*/g, "")
    .replace(/ ?【导演法典·v1·[^【]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

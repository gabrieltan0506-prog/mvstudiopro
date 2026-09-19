import type { ManhuaDirectorStrategyStage } from "./manhuaDirectorStrategy.js";
/**
 * 紧凑导演卡（对照图 04 的 `mvs-director-continuity`：当前有效手法｜来源范围｜覆盖理由｜影响预览｜连续性提醒）。
 *
 * 线上实测（0919 `mvstudiopro.com/canvas` 分镜阶段）：导演包主卡 + **五类场次副卡下拉常驻顶栏**
 * （打戏／对白戏／揭露戏／情感戏／过场），每个下拉六个选项，全在最上面一排。
 * 用户在分镜阶段看的是「这一段到底用哪张卡」，顶栏那五个下拉既回答不了这个问题，又一直占着位置。
 *
 * 这里只做**派生与说明**：按当前段的场次类型算出此刻真正生效的是主卡还是副卡、为什么、影响哪几处。
 * 不改选卡逻辑（仍是 `resolveDirectorStyleBlocks` 那套），不替用户换卡。
 */
import {
  MANHUA_DIRECTION_STAGES,
  type ManhuaDirectionCanon,
  type ManhuaDirectionSceneType,
  manhuaDirectionCardIsProductionReady,
} from "./manhuaDirectionCanon.js";

export const MANHUA_DIRECTION_SCENE_TYPE_SHORT_ZH: Record<ManhuaDirectionSceneType, string> = {
  action: "打戏",
  dialogue: "对白戏",
  reveal: "揭露戏",
  emotion: "情感戏",
  transition: "过场",
  default: "通用",
};

/** 与 ManhuaDirectorStrategyStage 的六个真实取值一一对应（story/assets/storyboard/keyframe/clip/review） */
const STAGE_LABEL_ZH: Record<ManhuaDirectorStrategyStage, string> = {
  story: "剧本",
  assets: "资产",
  storyboard: "分镜",
  keyframe: "关键帧",
  clip: "成片",
  review: "审查",
};

export type ManhuaDirectorCardView = {
  /** 此刻真正生效的卡；没有导演包时为 null（不许编一张默认卡） */
  effectiveCardId: string | null;
  effectiveLabelZh: string;
  /** 「系列主卡」或「场次副卡·打戏」 */
  sourceZh: string;
  /** 用副卡的理由；走主卡时为空串 */
  overrideReasonZh: string;
  /** 这张卡会投影到哪几处 */
  impactZh: string;
  /** 换卡后已铺节点不会自动跟着变 —— 没有这个风险时为空串 */
  continuityZh: string;
  /** 当前段的场次类型（派生自段正文） */
  sceneType: ManhuaDirectionSceneType;
  sceneTypeZh: string;
};

export function buildManhuaDirectorCardView(input: {
  canon?: ManhuaDirectionCanon | null;
  /** 当前段的场次类型（用 classifyManhuaDirectionSceneType 从段正文派生） */
  sceneType: ManhuaDirectionSceneType;
  /** 画布上已经铺过节点：换卡不会自动跟着变 */
  hasSpawnedNodes: boolean;
  stage?: ManhuaDirectorStrategyStage;
}): ManhuaDirectorCardView | null {
  const canon = input.canon;
  const sceneTypeZh = MANHUA_DIRECTION_SCENE_TYPE_SHORT_ZH[input.sceneType];
  if (!canon?.mainCardId) return null;
  const byId = new Map(canon.cards.map((card) => [card.id, card] as const));
  const main = byId.get(canon.mainCardId);
  if (!main || !canon.authorizedCardIds.includes(main.id) || !manhuaDirectionCardIsProductionReady(main)) return null;

  const override = canon.sceneOverrides?.[input.sceneType];
  const sub = override ? byId.get(override.cardId) : undefined;
  const subAuthorized = Boolean(sub && canon.authorizedCardIds.includes(sub.id) && manhuaDirectionCardIsProductionReady(sub));
  const stages: ManhuaDirectorStrategyStage[] =
    override?.stages?.length ? [...override.stages] : [...MANHUA_DIRECTION_STAGES];

  const effective = subAuthorized && sub && (!input.stage || stages.includes(input.stage)) ? sub : main;
  const usingSub = effective.id !== main.id;

  return {
    effectiveCardId: effective.id,
    effectiveLabelZh: effective.labelZh,
    sourceZh: usingSub ? `场次副卡 · ${sceneTypeZh}` : "系列主卡",
    overrideReasonZh: usingSub
      ? `本段判为${sceneTypeZh}，按场次副卡覆盖主卡「${main.labelZh}」`
      : sub && !subAuthorized
        ? `本段判为${sceneTypeZh}，副卡「${sub.labelZh}」未获生产准入，仍走主卡`
        : "",
    impactZh: `投影到 ${(usingSub ? stages : MANHUA_DIRECTION_STAGES).map((stage) => STAGE_LABEL_ZH[stage] || stage).join(" / ")}`,
    continuityZh: input.hasSpawnedNodes
      ? "换卡后已铺的剧本／分镜／关键帧／成片节点不会自动跟着变，要重铺一次才生效"
      : "",
    sceneType: input.sceneType,
    sceneTypeZh,
  };
}

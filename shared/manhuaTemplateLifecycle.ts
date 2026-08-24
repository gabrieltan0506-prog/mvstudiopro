/**
 * 模板的更新与淘汰判据。
 *
 * 立此模块的由头：**学习方式升级了**（抽帧读图 → 原生视频精读）。
 * 库里于是同时躺着两代卡，而它们的门槛差很多：
 *   抽帧卡  只有节拍与画面描述，运镜/转场/力度学不到（那是帧间差分，单帧里没有）
 *   精读卡  多出「可复用手法」与「生成要素」两栏 —— 学习产出里最有门槛的部分
 *
 * 所以「该不该淘汰」不是看新旧日期，是看**这张卡是用哪一代方法学的**，
 * 以及**有没有同一素材的新一代卡可以顶上**。
 */
import {
  describeManhuaTemplateLearnSourceZh,
  type ManhuaViralTemplateCard,
} from "./manhuaViralTemplateBank.js";

export type TemplateLearnGeneration = "native_deep_read" | "frame_vision" | "unknown";

/** 这张卡是哪一代学的 */
export function templateLearnGeneration(card: ManhuaViralTemplateCard): TemplateLearnGeneration {
  if (card.provenance?.nativeVideoDeepRead) return "native_deep_read";
  if (card.provenance?.frameVision) return "frame_vision";
  return "unknown";
}

export type TemplateRetirementAdvice = {
  generation: TemplateLearnGeneration;
  learnSourceZh?: string;
  /** 建议怎么处理 */
  action: "keep" | "consider_relearn" | "replace_with";
  reasonZh: string;
  /** action=replace_with 时，顶上来的那张卡 id */
  replacementId?: string;
};

/**
 * 给一张已批准模板的处置建议。
 *
 * **只建议不自动执行**：淘汰是不可逆的业务判断（归档件虽可查，但正式库少一张
 * 就会影响编剧室能选什么）。自动替换等于替用户拍板。
 */
export function adviseTemplateRetirement(
  card: ManhuaViralTemplateCard,
  candidates: readonly ManhuaViralTemplateCard[] = [],
): TemplateRetirementAdvice {
  const generation = templateLearnGeneration(card);
  const learnSourceZh = describeManhuaTemplateLearnSourceZh(card.provenance);

  if (generation === "native_deep_read") {
    return { generation, learnSourceZh, action: "keep", reasonZh: "已是原生精读卡，无需替换" };
  }

  // 同赛道、原生精读、镜头数不少于现役的，才算够格顶上
  const better = candidates.find(
    (c) =>
      c.id !== card.id
      && c.laneZh === card.laneZh
      && templateLearnGeneration(c) === "native_deep_read"
      && c.beatGrid.length >= card.beatGrid.length,
  );
  if (better) {
    return {
      generation,
      learnSourceZh,
      action: "replace_with",
      replacementId: better.id,
      reasonZh:
        `同赛道已有原生精读卡（${better.beatGrid.length} 镜，带可复用手法与生成要素），`
        + "可下架本卡改用它；旧版归档仍可查、可恢复",
    };
  }

  return {
    generation,
    learnSourceZh,
    action: "consider_relearn",
    reasonZh:
      generation === "frame_vision"
        ? "抽帧卡：运镜/转场/力度是帧间差分，单帧里学不到。建议用原生精读重学一版再替换"
        : "来源不明的旧卡：没有 provenance，无法判断学习方式。建议重学一版",
  };
}

/**
 * 淘汰前的安全检查。
 *
 * 淘汰是不可逆的业务动作，两条硬拦：
 *   · 不是 approved 的没什么可淘汰
 *   · **同赛道最后一张不许淘汰** —— 淘完这条赛道就选不出模板了，
 *     编剧室会直接空掉。要换先把新的批进来。
 */
export function canRetireTemplate(input: {
  card: ManhuaViralTemplateCard;
  sameLaneApprovedCount: number;
}): { ok: true; warnZh?: string } | { ok: false; reasonZh: string } {
  if (input.card.status !== "approved") {
    return { ok: false, reasonZh: "该模板不是已批准状态，无需下架" };
  }
  if (input.sameLaneApprovedCount <= 1) {
    return {
      ok: false,
      reasonZh: `「${input.card.laneZh}」只剩这一张正式模板，下架后该赛道会选不出模板。请先批准替代卡再下架`,
    };
  }
  if (templateLearnGeneration(input.card) === "native_deep_read") {
    return { ok: true, warnZh: "这是原生精读卡（当前最高门槛的一代），确认要下架？" };
  }
  return { ok: true };
}

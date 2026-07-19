/**
 * 漫剧工厂 · 全题材人物/服装/道具自动套用包。
 * 面孔与时代跟剧本设定走，不锁死东亚；用户可微调或重生成。
 */

import {
  getAncientArchetypeById,
  isAncientCostumeTopic,
  recommendAncientArchetypesFromTopic,
} from "./manhuaAncientArchetypeLibrary.js";
import {
  getManhuaCharacterById,
  recommendManhuaCharactersFromTopic,
} from "./manhuaCharacterAssetLibrary.js";
import {
  getWardrobePropContinuityById,
  type ManhuaWardrobePropContinuityCard,
} from "./manhuaWardrobePropContinuity.js";
import {
  getManhuaDemoAsset,
  listManhuaDemoPropsForLane,
  recommendManhuaContentLanesFromTopic,
  type ManhuaDemoAsset,
} from "./manhuaScenePropDemoCatalog.js";
import { resolveManhuaGenreId } from "./screenwriterGenreTemplates.js";

export type ManhuaCastLane = "urban" | "ancient";

export type ManhuaCastBundle = {
  lane: ManhuaCastLane;
  genreId?: string;
  characterIds: string[];
  femaleId: string;
  maleId: string;
  ancientArchetypeIds: string[];
  wardrobePropContinuityIds: string[];
  propIds: string[];
  /** 注入角色卡/静帧/成片：剧本跟随，不锁死族裔 */
  identityLockZh: string;
  reasonZh: string;
  matched: string[];
};

/** 剧本跟随身份锁（全题材共用；不写死东亚/外国人） */
export const MANHUA_SCRIPT_IDENTITY_LOCK_ZH = `【身份与时代·跟剧本】
- 严格遵循用户题材与编剧人物表的时代、族裔、国籍、服饰与妆发；剧本写海外/非华人/外国人则按此塑造，禁止擅自改成另一族裔。
- 禁止与剧本冲突的错时代穿戴（古装戏禁西装街拍；现代商战禁甲胄宫装，除非剧本时空穿越）。
- 库内定妆图若与剧本时代冲突：只借骨相/气质，衣着以服装连续与剧本为准。`.trim();

function buildIdentityLockZh(opts: {
  lane: ManhuaCastLane;
  topic: string;
  charactersMd?: string;
}): string {
  const t = `${opts.topic}\n${opts.charactersMd || ""}`;
  const extras: string[] = [];
  if (/外国|海外|华尔街|欧美|韩|日|混血|非华人|international|Western|Caucasian/i.test(t)) {
    extras.push("本题材含海外/非华人信号：面孔与妆造按人物表国籍/族裔执行，勿强制华人脸。");
  }
  if (opts.lane === "ancient") {
    extras.push("本包为古风造型轨：服饰以古风原型与服装连续为准，忽略都市库现代定妆衣。");
  } else if (/商战|并购|董事会|华尔街|职场|总裁/.test(t)) {
    extras.push("本包为现代商战/职场轨：西装大衣等现代正装可；勿套古装甲胄。");
  }
  return [MANHUA_SCRIPT_IDENTITY_LOCK_ZH, ...extras].join("\n");
}

function recommendUrbanWardrobeIds(topic: string): string[] {
  const t = topic;
  if (/追逃|穿越|机甲|战术|末日/.test(t)) return ["wpc_06_tactical_runner"];
  if (/商战|并购|董事会|华尔街|职场|总裁|权谋|谈判|合同|上市/.test(t)) {
    return ["wpc_03_urban_power"];
  }
  // 都市情感默认也给一套都市连续，避免空服装锚点
  return ["wpc_03_urban_power"];
}

function recommendPropIds(topic: string, genreId?: string, limit = 3): string[] {
  const lanes = recommendManhuaContentLanesFromTopic(topic);
  // 剧种微调：古风优先 ancient/intrigue；都市商战优先 business
  const ordered = [...lanes];
  if (genreId === "ancient" || genreId === "xianxia") {
    for (const l of ["ancient", "intrigue", "xianxia"] as const) {
      if (!ordered.includes(l)) ordered.unshift(l);
    }
  }
  if (/商战|华尔街|并购|董事会/.test(topic) && !ordered.includes("business")) {
    ordered.unshift("business");
  }
  const picked: string[] = [];
  for (const lane of ordered) {
    for (const p of listManhuaDemoPropsForLane(lane)) {
      if (picked.length >= limit) break;
      if (!picked.includes(p.id)) picked.push(p.id);
    }
    if (picked.length >= limit) break;
  }
  return picked.slice(0, limit);
}

/**
 * 从编剧人物表抽一点信号（可选）：有「古装/外国」等词时强化 lane / identity，不强制换脸库。
 */
function mergeWriterCharactersMd(
  bundle: ManhuaCastBundle,
  charactersMd?: string | null,
): ManhuaCastBundle {
  const md = String(charactersMd || "").trim();
  if (!md) return bundle;
  const identityLockZh = buildIdentityLockZh({
    lane: bundle.lane,
    topic: `${bundle.reasonZh}\n${md}`,
    charactersMd: md,
  });
  const reasonZh = `${bundle.reasonZh}；已对照编剧人物表微调身份锁`;
  return { ...bundle, identityLockZh, reasonZh };
}

/**
 * 全题材一次推荐：人物或古风原型 + 服装连续 + 道具 + 剧本跟随身份锁。
 */
export function recommendManhuaCastBundle(opts?: {
  topic?: string | null;
  genreId?: string | null;
  /** 编剧室已确认人物表（可选二次对齐） */
  charactersMd?: string | null;
  propLimit?: number;
}): ManhuaCastBundle {
  const topic = String(opts?.topic || "").trim();
  const resolved = resolveManhuaGenreId({ genreId: opts?.genreId || undefined, topic });
  const genreId = resolved.genreId;
  const ancient = isAncientCostumeTopic(topic, genreId);

  if (ancient) {
    const arch = recommendAncientArchetypesFromTopic(topic, { genreId, max: 2 });
    const propIds = recommendPropIds(topic, genreId, opts?.propLimit ?? 3);
    const matched = [...arch.matched];
    const names = arch.archetypeIds
      .map((id) => getAncientArchetypeById(id)?.nameZh)
      .filter(Boolean)
      .join("·");
    const wardrobeNames = arch.wardrobePropContinuityIds
      .map((id) => getWardrobePropContinuityById(id)?.nameZh)
      .filter(Boolean)
      .join("·");
    const propNames = propIds
      .map((id) => getManhuaDemoAsset(id)?.nameZh)
      .filter(Boolean)
      .join("·");
    const reasonZh = [
      arch.reasonZh || `古风原型 ${names}`,
      wardrobeNames ? `服装 ${wardrobeNames}` : "",
      propNames ? `道具 ${propNames}` : "",
    ]
      .filter(Boolean)
      .join("；");

    const bundle: ManhuaCastBundle = {
      lane: "ancient",
      genreId,
      characterIds: [],
      femaleId: "",
      maleId: "",
      ancientArchetypeIds: arch.archetypeIds,
      wardrobePropContinuityIds: arch.wardrobePropContinuityIds,
      propIds,
      identityLockZh: buildIdentityLockZh({ lane: "ancient", topic }),
      reasonZh: reasonZh || "古风题材已自动套用原型/服装/道具",
      matched,
    };
    return mergeWriterCharactersMd(bundle, opts?.charactersMd);
  }

  const leads = recommendManhuaCharactersFromTopic(topic);
  const femaleId = String(leads.femaleId || "").trim();
  const maleId = String(leads.maleId || "").trim();
  const characterIds = [femaleId, maleId].filter((id) => Boolean(getManhuaCharacterById(id)));
  const wardrobePropContinuityIds = recommendUrbanWardrobeIds(topic);
  const propIds = recommendPropIds(topic, genreId, opts?.propLimit ?? 3);
  const wardrobeNames = wardrobePropContinuityIds
    .map((id) => getWardrobePropContinuityById(id)?.nameZh)
    .filter(Boolean)
    .join("·");
  const propNames = propIds
    .map((id) => getManhuaDemoAsset(id)?.nameZh)
    .filter(Boolean)
    .join("·");
  const fName = getManhuaCharacterById(femaleId)?.nameZh;
  const mName = getManhuaCharacterById(maleId)?.nameZh;
  const reasonZh = [
    leads.reasonZh,
    fName || mName ? `人物 ${[fName, mName].filter(Boolean).join("·")}` : "",
    wardrobeNames ? `服装 ${wardrobeNames}` : "",
    propNames ? `道具 ${propNames}` : "",
  ]
    .filter(Boolean)
    .join("；");

  const bundle: ManhuaCastBundle = {
    lane: "urban",
    genreId,
    characterIds,
    femaleId,
    maleId,
    ancientArchetypeIds: [],
    wardrobePropContinuityIds,
    propIds,
    identityLockZh: buildIdentityLockZh({ lane: "urban", topic }),
    reasonZh: reasonZh || "都市题材已自动套用人物/服装/道具",
    matched: leads.matchedTags,
  };
  return mergeWriterCharactersMd(bundle, opts?.charactersMd);
}

/** 供 UI 摘要：服装卡 */
export function describeCastBundleWardrobe(bundle: ManhuaCastBundle): ManhuaWardrobePropContinuityCard[] {
  return bundle.wardrobePropContinuityIds
    .map(getWardrobePropContinuityById)
    .filter(Boolean) as ManhuaWardrobePropContinuityCard[];
}

/** 供 UI 摘要：道具 */
export function describeCastBundleProps(bundle: ManhuaCastBundle): ManhuaDemoAsset[] {
  return bundle.propIds
    .map((id) => getManhuaDemoAsset(id))
    .filter((a): a is ManhuaDemoAsset => Boolean(a && a.kind === "prop"));
}

/** 拼接注入块用的身份锁（空则返回标准锁） */
export function resolveManhuaIdentityLockZh(identityLockZh?: string | null): string {
  const t = String(identityLockZh || "").trim();
  return t || MANHUA_SCRIPT_IDENTITY_LOCK_ZH;
}

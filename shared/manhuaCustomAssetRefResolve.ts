/**
 * 资产图参考解析：有可用库图（精确或近似）才垫图 Edit；否则纯文案出图。
 */
import { getAncientArchetypeById } from "./manhuaAncientArchetypeLibrary.js";
import {
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
} from "./manhuaCharacterAssetLibrary.js";
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
  listManhuaDemoAssetsReady,
  type ManhuaContentLane,
} from "./manhuaScenePropDemoCatalog.js";
import { isManhuaDemoAssetPublicReady } from "./manhuaDemoPublicReady.js";
import type { ManhuaCustomAssetRole } from "./manhuaCustomAssetRefs.js";

export type ManhuaAssetRefStrategy = "exact" | "similar" | "text";

export type ManhuaResolvedAssetReference = {
  role: ManhuaCustomAssetRole;
  seedLibraryId: string;
  labelZh: string;
  promptZh: string;
  /** 相对路径或空；空=纯文案出图 */
  previewPath: string;
  strategy: ManhuaAssetRefStrategy;
  /** 实际用作垫图的库 id（可能是近似条目） */
  referenceLibraryId?: string;
  referenceNoteZh?: string;
};

/** 古风板 → 优先近似服装道具，再场景（定妆垫图；无人物 sheet 时） */
const ARCH_SIMILAR_DEMO_IDS: Record<string, string[]> = {
  arch_rain_jianghu_dao: [
    "demo_prop_xianxia_sword",
    "demo_scene_revenge_rain_alley",
    "demo_scene_ancient_jianghu_inn",
  ],
  arch_phoenix_empress: [
    "demo_prop_ancient_phoenix_crown",
    "demo_scene_ancient_palace",
    "demo_scene_intrigue_court",
  ],
  arch_red_armor_general: [
    "demo_prop_intrigue_hu_tablet",
    "demo_scene_revenge_border_farm",
    "demo_scene_intrigue_court",
  ],
  arch_xianmen_sword_cold: [
    "demo_prop_xianxia_sword",
    "demo_scene_xianxia_sect",
    "demo_scene_xianxia_cave",
  ],
  arch_yaolu_physician: [
    "demo_prop_xianxia_pill",
    "demo_scene_xianxia_cave",
    "demo_scene_novel_manor_yard",
  ],
  arch_forest_phoenix_queen: [
    "demo_prop_xuanhuan_token",
    "demo_scene_xuanhuan_spirit_field",
    "demo_scene_xianxia_sect",
  ],
  arch_cloud_phoenix_queen: [
    "demo_prop_ancient_phoenix_crown",
    "demo_scene_xuanhuan_demon_palace",
    "demo_scene_xianxia_sect",
  ],
};

function firstReadyDemoPath(ids: string[]): { id: string; path: string } | null {
  for (const id of ids) {
    if (!isManhuaDemoAssetPublicReady(id)) continue;
    const path = getManhuaDemoAssetPublicUrl(id);
    if (path) return { id, path };
  }
  return null;
}

function similarScenePath(opts: {
  sceneTemplateId?: string;
  labelZh?: string;
  topic?: string;
}): { id: string; path: string; noteZh: string } | null {
  const tid = String(opts.sceneTemplateId || "").trim();
  if (tid) {
    const bound = listManhuaDemoAssetsForSceneTemplate(tid)
      .map((a) => a.id)
      .filter((id) => isManhuaDemoAssetPublicReady(id));
    const hit = firstReadyDemoPath(bound);
    if (hit) {
      return { ...hit, noteZh: `对齐场景库「${tid}」示范空镜` };
    }
  }
  const hay = `${opts.labelZh || ""} ${opts.topic || ""}`;
  const lanePrefer: ManhuaContentLane[] = /仙侠|宗门|御剑/.test(hay)
    ? ["xianxia", "xuanhuan", "ancient"]
    : /朝堂|宫廷|皇宫|大殿|权谋/.test(hay)
      ? ["intrigue", "ancient"]
      : /江湖|客栈|雨夜|刀/.test(hay)
        ? ["ancient", "revenge"]
        : /雪关|边关|军田|粮仓|开荒/.test(hay)
          ? ["revenge", "ancient", "intrigue"]
          : ["ancient", "intrigue", "xianxia"];
  for (const lane of lanePrefer) {
    const ready = listManhuaDemoAssetsReady({ kind: "scene", lane });
    const first = ready[0];
    if (first) {
      const path = getManhuaDemoAssetPublicUrl(first.id);
      if (path) {
        return {
          id: first.id,
          path,
          noteZh: `近似赛道「${lane}」示范空镜·${first.nameZh}`,
        };
      }
    }
  }
  return null;
}

function similarPropPath(opts: {
  propId?: string;
  labelZh?: string;
}): { id: string; path: string; noteZh: string } | null {
  const exact = String(opts.propId || "").trim();
  if (exact && isManhuaDemoAssetPublicReady(exact)) {
    const path = getManhuaDemoAssetPublicUrl(exact);
    if (path) return { id: exact, path, noteZh: "精确道具示范" };
  }
  const hay = String(opts.labelZh || "");
  const lane: ManhuaContentLane = /剑|刀|符|丹/.test(hay)
    ? "xianxia"
    : /玉|簪|扇|凤冠/.test(hay)
      ? "ancient"
      : /印|笏|密信/.test(hay)
        ? "intrigue"
        : "ancient";
  const ready = listManhuaDemoAssetsReady({ kind: "prop", lane });
  const first = ready[0];
  if (!first) return null;
  const path = getManhuaDemoAssetPublicUrl(first.id);
  if (!path) return null;
  return { id: first.id, path, noteZh: `近似道具·${first.nameZh}` };
}

/**
 * 解析出图参考：exact → similar → text（无垫图）。
 * 古风 arch_* 示范板未上架时，改用赛道近似场景/道具图；再没有才纯文案。
 */
export function resolveManhuaCustomAssetReference(opts: {
  role: ManhuaCustomAssetRole;
  seedLibraryId: string;
  artStyleId?: string | null;
  topic?: string;
}): ManhuaResolvedAssetReference | null {
  const id = String(opts.seedLibraryId || "").trim();
  if (!id) return null;

  if (opts.role === "character") {
    const arch = getAncientArchetypeById(id);
    if (arch) {
      // 古风板 *_sheet.jpg 未上架：用赛道近似示范图；没有才纯文案
      const similarIds = ARCH_SIMILAR_DEMO_IDS[id] || [
        "demo_scene_ancient_jianghu_inn",
        "demo_scene_ancient_palace",
        "demo_prop_ancient_jade",
      ];
      const sim = firstReadyDemoPath(similarIds);
      if (sim) {
        return {
          role: "character",
          seedLibraryId: id,
          labelZh: arch.nameZh,
          promptZh: arch.promptZh,
          previewPath: sim.path,
          strategy: "similar",
          referenceLibraryId: sim.id,
          referenceNoteZh: `库内近似参考（${getManhuaDemoAsset(sim.id)?.nameZh || sim.id}）；服化道以剧本为准`,
        };
      }
      return {
        role: "character",
        seedLibraryId: id,
        labelZh: arch.nameZh,
        promptZh: arch.promptZh,
        previewPath: "",
        strategy: "text",
        referenceNoteZh: "无可用库图，纯文案出定妆",
      };
    }
    const c = getManhuaCharacterById(id);
    if (!c) return null;
    const path = getManhuaCharacterPreviewUrl(id, { artStyleId: opts.artStyleId }) || "";
    if (path) {
      return {
        role: "character",
        seedLibraryId: id,
        labelZh: c.nameZh,
        promptZh: c.promptZh,
        previewPath: path,
        strategy: "exact",
        referenceLibraryId: id,
      };
    }
    return {
      role: "character",
      seedLibraryId: id,
      labelZh: c.nameZh,
      promptZh: c.promptZh,
      previewPath: "",
      strategy: "text",
      referenceNoteZh: "无可用库图，纯文案出定妆",
    };
  }

  if (opts.role === "scene") {
    const s = getManhuaSceneTemplate(id);
    const labelZh = s?.nameZh || id;
    const promptZh = s?.promptZh || labelZh;
    const bound = listManhuaDemoAssetsForSceneTemplate(id);
    const exact = firstReadyDemoPath(bound.map((a) => a.id));
    if (exact) {
      return {
        role: "scene",
        seedLibraryId: id,
        labelZh,
        promptZh,
        previewPath: exact.path,
        strategy: "exact",
        referenceLibraryId: exact.id,
      };
    }
    const sim = similarScenePath({
      sceneTemplateId: id,
      labelZh,
      topic: opts.topic,
    });
    if (sim) {
      return {
        role: "scene",
        seedLibraryId: id,
        labelZh,
        promptZh,
        previewPath: sim.path,
        strategy: "similar",
        referenceLibraryId: sim.id,
        referenceNoteZh: sim.noteZh,
      };
    }
    // writer wa_scene_* 等：按中文名找近似
    const byName = similarScenePath({ labelZh, topic: opts.topic });
    if (byName) {
      return {
        role: "scene",
        seedLibraryId: id,
        labelZh,
        promptZh,
        previewPath: byName.path,
        strategy: "similar",
        referenceLibraryId: byName.id,
        referenceNoteZh: byName.noteZh,
      };
    }
    return {
      role: "scene",
      seedLibraryId: id,
      labelZh,
      promptZh,
      previewPath: "",
      strategy: "text",
      referenceNoteZh: "无可用库图，纯文案出空镜",
    };
  }

  const prop = getManhuaDemoAsset(id);
  const labelZh = prop?.nameZh || id;
  const promptZh = prop?.promptZh || labelZh;
  if (prop && isManhuaDemoAssetPublicReady(id)) {
    const path = getManhuaDemoAssetPublicUrl(id);
    if (path) {
      return {
        role: "prop",
        seedLibraryId: id,
        labelZh,
        promptZh,
        previewPath: path,
        strategy: "exact",
        referenceLibraryId: id,
      };
    }
  }
  const sim = similarPropPath({ propId: id, labelZh });
  if (sim) {
    return {
      role: "prop",
      seedLibraryId: id,
      labelZh,
      promptZh,
      previewPath: sim.path,
      strategy: "similar",
      referenceLibraryId: sim.id,
      referenceNoteZh: sim.noteZh,
    };
  }
  return {
    role: "prop",
    seedLibraryId: id,
    labelZh,
    promptZh,
    previewPath: "",
    strategy: "text",
    referenceNoteZh: "无可用库图，纯文案出道具图",
  };
}

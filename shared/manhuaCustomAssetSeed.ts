/**
 * 从内建库取「仅作参考」的种子文案，供用户生成新人物/场景/服装道具。
 */

import { getManhuaCharacterById } from "./manhuaCharacterAssetLibrary.js";
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "./manhuaScenePropDemoCatalog.js";
import { getManhuaCharacterPreviewUrl } from "./manhuaCharacterAssetLibrary.js";
import {
  getAncientArchetypeById,
} from "./manhuaAncientArchetypeLibrary.js";
import { getAncientArchetypePreviewUrl } from "./manhuaAncientDesignBoard.js";
import type { ManhuaCustomAssetRole } from "./manhuaCustomAssetRefs.js";

export type ManhuaCustomAssetSeed = {
  role: ManhuaCustomAssetRole;
  seedLibraryId: string;
  labelZh: string;
  promptZh: string;
  /** 库示意封面（相对路径或空）；生成时可选作 edit 底图 */
  previewPath: string;
};

export function resolveManhuaCustomAssetSeed(opts: {
  role: ManhuaCustomAssetRole;
  seedLibraryId: string;
  artStyleId?: string | null;
}): ManhuaCustomAssetSeed | null {
  const id = String(opts.seedLibraryId || "").trim();
  if (!id) return null;
  if (opts.role === "character") {
    const arch = getAncientArchetypeById(id);
    if (arch) {
      return {
        role: "character",
        seedLibraryId: id,
        labelZh: arch.nameZh,
        promptZh: arch.promptZh,
        previewPath: getAncientArchetypePreviewUrl(id) || "",
      };
    }
    const c = getManhuaCharacterById(id);
    if (!c) return null;
    return {
      role: "character",
      seedLibraryId: id,
      labelZh: c.nameZh,
      promptZh: c.promptZh,
      previewPath: getManhuaCharacterPreviewUrl(id, { artStyleId: opts.artStyleId }) || "",
    };
  }
  if (opts.role === "scene") {
    const s = getManhuaSceneTemplate(id);
    if (!s) return null;
    const demo = listManhuaDemoAssetsForSceneTemplate(id)[0];
    const previewPath = demo ? getManhuaDemoAssetPublicUrl(demo.id) || "" : "";
    return {
      role: "scene",
      seedLibraryId: id,
      labelZh: s.nameZh,
      promptZh: s.promptZh,
      previewPath,
    };
  }
  const prop = getManhuaDemoAsset(id);
  if (!prop || prop.kind !== "prop") return null;
  return {
    role: "prop",
    seedLibraryId: id,
    labelZh: prop.nameZh,
    promptZh: prop.promptZh,
    previewPath: getManhuaDemoAssetPublicUrl(id) || "",
  };
}

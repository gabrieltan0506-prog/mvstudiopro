/**
 * 从内建库取「仅作参考」的种子文案，供用户生成新人物/场景/服装道具。
 * 垫图策略见 resolveManhuaCustomAssetReference：有类似库图才给 previewPath。
 */

import { resolveManhuaCustomAssetReference } from "./manhuaCustomAssetRefResolve.js";
import type { ManhuaCustomAssetRole } from "./manhuaCustomAssetRefs.js";

export type ManhuaCustomAssetSeed = {
  role: ManhuaCustomAssetRole;
  seedLibraryId: string;
  labelZh: string;
  promptZh: string;
  /** 有类似库图时为相对路径；空=纯文案出图（勿拿未上架路径当垫图） */
  previewPath: string;
  strategy?: "exact" | "similar" | "text";
  referenceNoteZh?: string;
};

export function resolveManhuaCustomAssetSeed(opts: {
  role: ManhuaCustomAssetRole;
  seedLibraryId: string;
  artStyleId?: string | null;
  topic?: string;
}): ManhuaCustomAssetSeed | null {
  const hit = resolveManhuaCustomAssetReference({
    role: opts.role,
    seedLibraryId: opts.seedLibraryId,
    artStyleId: opts.artStyleId,
    topic: opts.topic,
  });
  if (!hit) return null;
  return {
    role: hit.role,
    seedLibraryId: hit.seedLibraryId,
    labelZh: hit.labelZh,
    promptZh: hit.promptZh,
    previewPath: hit.strategy === "text" ? "" : hit.previewPath,
    strategy: hit.strategy,
    referenceNoteZh: hit.referenceNoteZh,
  };
}

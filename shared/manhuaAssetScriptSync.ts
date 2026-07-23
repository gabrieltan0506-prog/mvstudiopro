/**
 * 剧本表 ↔ 设定图对齐：指纹侦测过期资产、清掉与现稿不符的生成图。
 * 重扩写后若「我的角色」旧垫图仍在，门禁会误报已齐并藏掉「生成全部」。
 */

import {
  stripManhuaCustomAssetLabelPrefix,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon.js";

export function fingerprintManhuaWriterAssetCanon(
  canon: ManhuaWriterAssetCanon | null | undefined,
): string {
  if (!canon) return "";
  const chars = (canon.characters || [])
    .map((c) => `${c.id}|${c.nameZh}|${String(c.lookZh || "").slice(0, 80)}`)
    .join(";");
  const locs = (canon.locations || [])
    .map((l) => `${l.id}|${l.nameZh}|${String(l.lookZh || "").slice(0, 80)}`)
    .join(";");
  return `${chars}::${locs}`;
}

function labelMatchesName(labelZh: string | undefined, nameZh: string): boolean {
  const label = stripManhuaCustomAssetLabelPrefix(labelZh);
  const name = String(nameZh || "").trim();
  if (!label || !name) return false;
  return label.includes(name) || name.includes(label);
}

function refMatchesCanonCharacter(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon,
): boolean {
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed && canon.characters.some((c) => c.id === seed)) return true;
  return canon.characters.some((c) => labelMatchesName(ref.labelZh, c.nameZh));
}

function refMatchesCanonLocation(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon,
): boolean {
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed && canon.locations.some((l) => l.id === seed)) return true;
  return canon.locations.some((l) => labelMatchesName(ref.labelZh, l.nameZh));
}

function refMatchesCanonProp(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon,
): boolean {
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed && canon.props.some((p) => p.id === seed)) return true;
  return canon.props.some((p) => labelMatchesName(ref.labelZh, p.nameZh));
}

/** 生成垫图是否仍对应当前剧本表（上传手改图默认保留） */
export function isCustomAssetRefAlignedWithCanon(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon | null | undefined,
): boolean {
  if (!canon) return true;
  if (ref.source === "upload") return true;
  if (ref.role === "character") return refMatchesCanonCharacter(ref, canon);
  if (ref.role === "scene") return refMatchesCanonLocation(ref, canon);
  if (ref.role === "prop") {
    if (!canon.props.length) return true;
    return refMatchesCanonProp(ref, canon);
  }
  return true;
}

export function extractAssetSheetSeedId(blockId: string): {
  kind: "charsheet" | "sceneplate" | null;
  seedId: string;
} {
  const id = String(blockId || "");
  if (id.startsWith("charsheet-")) {
    return { kind: "charsheet", seedId: id.replace(/^charsheet-/, "") };
  }
  if (id.startsWith("sceneplate-")) {
    return { kind: "sceneplate", seedId: id.replace(/^sceneplate-/, "") };
  }
  return { kind: null, seedId: "" };
}

export function isAssetSheetBlockAlignedWithCanon(
  blockId: string,
  canon: ManhuaWriterAssetCanon | null | undefined,
): boolean {
  if (!canon) return true;
  const { kind, seedId } = extractAssetSheetSeedId(blockId);
  if (!kind || !seedId) return true;
  if (kind === "charsheet") {
    return canon.characters.some(
      (c) => c.id === seedId || seedId.includes(c.id) || c.id.includes(seedId),
    );
  }
  return canon.locations.some(
    (l) => l.id === seedId || seedId.includes(l.id) || l.id.includes(seedId),
  );
}

export type ManhuaAssetScriptAlignResult = {
  fingerprint: string;
  aligned: boolean;
  staleGeneratedRefCount: number;
  staleSheetBlockCount: number;
  /** 用户可见短句 */
  hintZh: string | null;
};

export function evaluateManhuaAssetScriptAlignment(input: {
  assetCanon?: ManhuaWriterAssetCanon | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
  assetBlocks?: Array<{ id: string }> | null;
}): ManhuaAssetScriptAlignResult {
  const fingerprint = fingerprintManhuaWriterAssetCanon(input.assetCanon);
  const refs = input.customRefs || [];
  const blocks = input.assetBlocks || [];
  if (!input.assetCanon || !fingerprint) {
    return {
      fingerprint,
      aligned: true,
      staleGeneratedRefCount: 0,
      staleSheetBlockCount: 0,
      hintZh: null,
    };
  }
  const staleRefs = refs.filter(
    (r) => r.source === "generated" && !isCustomAssetRefAlignedWithCanon(r, input.assetCanon),
  );
  const staleBlocks = blocks.filter(
    (b) =>
      (b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-")) &&
      !isAssetSheetBlockAlignedWithCanon(b.id, input.assetCanon),
  );
  const staleGeneratedRefCount = staleRefs.length;
  const staleSheetBlockCount = staleBlocks.length;
  const aligned = staleGeneratedRefCount === 0 && staleSheetBlockCount === 0;
  return {
    fingerprint,
    aligned,
    staleGeneratedRefCount,
    staleSheetBlockCount,
    hintZh: aligned
      ? null
      : `剧本人物/场景已变：有 ${staleGeneratedRefCount + staleSheetBlockCount} 项旧设定图与现稿不符，请清掉并按剧本重出`,
  };
}

/**
 * 清掉与现稿不符的「生成」垫图；用户上传默认保留。
 * forceAllGenerated=true 时清掉全部 generated（按剧本整批重出）。
 */
export function purgeStaleCustomAssetRefsForCanon(
  refs: ManhuaCustomAssetRef[] | null | undefined,
  canon: ManhuaWriterAssetCanon | null | undefined,
  opts?: { forceAllGenerated?: boolean },
): { refs: ManhuaCustomAssetRef[]; removedCount: number } {
  const list = refs || [];
  if (!list.length) return { refs: [], removedCount: 0 };
  const force = Boolean(opts?.forceAllGenerated);
  const next = list.filter((r) => {
    if (r.source !== "generated") return true;
    if (force) return false;
    return isCustomAssetRefAlignedWithCanon(r, canon);
  });
  return { refs: next, removedCount: list.length - next.length };
}

/** 返回应删除的设定图节点 id */
export function collectStaleAssetSheetBlockIds(
  blocks: Array<{ id: string }> | null | undefined,
  canon: ManhuaWriterAssetCanon | null | undefined,
  opts?: { forceAllSheets?: boolean },
): string[] {
  const force = Boolean(opts?.forceAllSheets);
  return (blocks || [])
    .filter((b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"))
    .filter((b) => force || !isAssetSheetBlockAlignedWithCanon(b.id, canon))
    .map((b) => b.id);
}

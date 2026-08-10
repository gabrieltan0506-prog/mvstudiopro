/**
 * 剧本表 ↔ 设定图对齐：指纹侦测过期资产、清掉与现稿不符的生成图。
 * 重扩写后若「我的角色」旧垫图仍在，门禁会误报已齐并藏掉「生成全部」。
 */

import {
  stripManhuaCustomAssetLabelPrefix,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";
import type { ManhuaWriterAssetAnchor, ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon.js";

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

/**
 * 资产包命名习惯归一：去掉「s01_02_」类场景序号前缀与「_半身/_全身」类
 * 视角后缀，让「阿咎_半身」「s01_02_雁门军营马厩」能对上剧本表的
 * 「阿咎」「雁门军营马厩」。只求自动认领到大头（约 95%），
 * 剩下认不出的由用户在卡片上手动改名认领，不赌全自动。
 */
export function normalizeAssetClaimLabel(label: string): string {
  return label
    .replace(/^s\d{1,3}(?:[_-]\d{1,3})?[_-]/i, "")
    .replace(/[_\-–—·\s]*(?:半身|全身|大头|头像|特写|正面|侧面|背面|立绘|设定图?)$/, "")
    .replace(/[\s·•_\-—–（）()《》「」『』]/g, "")
    .trim();
}

export function labelMatchesManhuaAnchor(
  labelZh: string | undefined,
  anchor: Pick<ManhuaWriterAssetAnchor, "nameZh" | "aliasZh">,
): boolean {
  const label = stripManhuaCustomAssetLabelPrefix(labelZh);
  const bare = normalizeAssetClaimLabel(label);
  if (!bare) return false;
  const names = [anchor.nameZh, anchor.aliasZh]
    .flatMap((v) => String(v || "").split(/[\/／、,，]/))
    .map(normalizeAssetClaimLabel)
    .filter((v) => v.length >= 2);
  return names.some((name) => bare === name || (Math.min(bare.length, name.length) >= 3 && (bare.includes(name) || name.includes(bare))));
}

/** 单一认领真源：显式 anchor id > seed id > 名称/别名；隔离图永不命中。 */
export function customAssetRefClaimsAnchor(
  ref: ManhuaCustomAssetRef,
  anchor: ManhuaWriterAssetAnchor,
): boolean {
  if (ref.reviewStatus === "needs_review") return false;
  if ((ref.claimedAnchorIds || []).includes(anchor.id)) return true;
  // 用户手动认领（含“清除认领”）必须覆盖 manifest/文件名猜测。
  if (ref.claimSource === "manual") return false;
  if ((ref.claimedAnchorNamesZh || []).some((name) => labelMatchesManhuaAnchor(name, anchor))) {
    return true;
  }
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed === anchor.id) return true;
  return labelMatchesManhuaAnchor(ref.labelZh, anchor);
}

function refMatchesCanonCharacter(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon,
): boolean {
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed && canon.characters.some((c) => c.id === seed)) return true;
  return canon.characters.some((c) => customAssetRefClaimsAnchor(ref, c));
}

function refMatchesCanonLocation(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon,
): boolean {
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed && canon.locations.some((l) => l.id === seed)) return true;
  return canon.locations.some((l) => customAssetRefClaimsAnchor(ref, l));
}

function refMatchesCanonProp(
  ref: ManhuaCustomAssetRef,
  canon: ManhuaWriterAssetCanon,
): boolean {
  const seed = String(ref.seedLibraryId || "").trim();
  if (seed && canon.props.some((p) => p.id === seed)) return true;
  return canon.props.some((p) => customAssetRefClaimsAnchor(ref, p));
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

export type ManhuaAssetCoverageGap = {
  role: "character" | "scene";
  id: string;
  nameZh: string;
};

/**
 * 剧本表里有、却一张图都没有的人物/场景。
 *
 * 扩写会按剧情添人加景，导入的外部剧本更是随时冒出新角色。只比「张数够不够」
 * 会把新人物漏过去：六个旧定妆挡住第七个新角色，后面锁脸就锁了个空。
 */
export function findManhuaAssetCoverageGaps(input: {
  assetCanon?: ManhuaWriterAssetCanon | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
  assetBlocks?: Array<{ id: string; hasMedia?: boolean }> | null;
}): ManhuaAssetCoverageGap[] {
  const canon = input.assetCanon;
  if (!canon) return [];
  const refs = input.customRefs || [];
  const blocks = (input.assetBlocks || []).filter((b) => b.hasMedia !== false);
  const seedIdHit = (kind: "charsheet" | "sceneplate", anchorId: string): boolean =>
    blocks.some((b) => {
      const parsed = extractAssetSheetSeedId(b.id);
      if (parsed.kind !== kind || !parsed.seedId) return false;
      return (
        parsed.seedId === anchorId ||
        parsed.seedId.includes(anchorId) ||
        anchorId.includes(parsed.seedId)
      );
    });
  const refHit = (role: "character" | "scene", anchor: ManhuaWriterAssetAnchor): boolean =>
    refs.some((r) => {
      if (r.role !== role) return false;
      return customAssetRefClaimsAnchor(r, anchor);
    });

  const gaps: ManhuaAssetCoverageGap[] = [];
  for (const c of canon.characters || []) {
    if (seedIdHit("charsheet", c.id) || refHit("character", c)) continue;
    gaps.push({ role: "character", id: c.id, nameZh: c.nameZh });
  }
  for (const l of canon.locations || []) {
    if (seedIdHit("sceneplate", l.id) || refHit("scene", l)) continue;
    gaps.push({ role: "scene", id: l.id, nameZh: l.nameZh });
  }
  return gaps;
}

export type ManhuaAssetScriptAlignResult = {
  fingerprint: string;
  aligned: boolean;
  staleGeneratedRefCount: number;
  staleSheetBlockCount: number;
  /** 剧本新增、还没有任何图的人物/场景 */
  coverageGaps: ManhuaAssetCoverageGap[];
  /** 用户可见短句 */
  hintZh: string | null;
};

export function evaluateManhuaAssetScriptAlignment(input: {
  assetCanon?: ManhuaWriterAssetCanon | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
  assetBlocks?: Array<{ id: string; hasMedia?: boolean }> | null;
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
      coverageGaps: [],
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
  const coverageGaps = findManhuaAssetCoverageGaps({
    assetCanon: input.assetCanon,
    customRefs: refs,
    assetBlocks: blocks,
  });
  const aligned =
    staleGeneratedRefCount === 0 && staleSheetBlockCount === 0 && coverageGaps.length === 0;
  let hintZh: string | null = null;
  if (staleGeneratedRefCount > 0 || staleSheetBlockCount > 0) {
    hintZh = `剧本人物/场景已变：有 ${staleGeneratedRefCount + staleSheetBlockCount} 项旧设定图与现稿不符，请清掉并按剧本重出`;
  } else if (coverageGaps.length > 0) {
    const names = coverageGaps.map((g) => g.nameZh).filter(Boolean).slice(0, 4).join("、");
    hintZh = `剧本新增了 ${coverageGaps.length} 个还没有设定图的人物/场景${names ? `（${names}）` : ""}，请先补图再进分镜`;
  }
  return {
    fingerprint,
    aligned,
    staleGeneratedRefCount,
    staleSheetBlockCount,
    coverageGaps,
    hintZh,
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

export type ManhuaSheetAdoptionPlan = {
  blockId: string;
  kind: "charsheet" | "sceneplate" | "propsheet";
  role: "character" | "scene" | "prop";
  seedId: string;
  labelZh: string;
  url: string;
  /** 四格拼板：认领时要先切图再挂主视角 */
  layout?: "grid2x2";
};

/**
 * 画布上已出图、却没进「我的角色 / 我的场景 / 我的道具」的设定图。
 *
 * 从前认领只挂在「资产已齐 → 早退进分镜」那一条分支上，而按剧本重出与增量补图
 * 都绕开它，于是十张定妆只有最早那张有 @角色 槽位，其余人在静帧里锁不到脸。
 * 道具更是一张都进不来：assetBlocks 过滤时就没收 propsheet-。
 */
export function planManhuaSheetAdoptions(input: {
  blocks?: Array<{ id: string; prompt?: string; outputUrl?: string; outputUrls?: string[] }> | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
  assetCanon?: ManhuaWriterAssetCanon | null;
}): ManhuaSheetAdoptionPlan[] {
  const refs = input.customRefs || [];
  const canon = input.assetCanon;
  const adopted = new Set<string>();
  for (const r of refs) {
    const seed = String(r.seedLibraryId || "").trim();
    if (seed) adopted.add(`${r.role}:${seed}`);
  }
  const out: ManhuaSheetAdoptionPlan[] = [];
  for (const b of input.blocks || []) {
    const id = String(b.id || "");
    const kind: ManhuaSheetAdoptionPlan["kind"] | null = id.startsWith("charsheet-")
      ? "charsheet"
      : id.startsWith("sceneplate-")
        ? "sceneplate"
        : id.startsWith("propsheet-")
          ? "propsheet"
          : null;
    if (!kind) continue;
    const url = String(b.outputUrl || b.outputUrls?.[0] || "").trim();
    if (!/^https:\/\//i.test(url)) continue;
    /**
     * 主角的脸特写块是 charsheet-face-<seed>：去掉两层前缀才拿得到 seed，
     * 否则 face 那张会带着 "face-" 去比对 canon，永远对不上、永远重复认领。
     */
    const seedId = id
      .replace(/^charsheet-face-/, "")
      .replace(/^(charsheet|sceneplate|propsheet)-/, "");
    if (!seedId) continue;
    const role =
      kind === "charsheet" ? "character" : kind === "sceneplate" ? "scene" : "prop";
    // 脸特写与全身照分工不同，两张都要挂，所以按 blockId 而非 seed 去重
    const isFace = id.startsWith("charsheet-face-");
    if (!isFace && adopted.has(`${role}:${seedId}`)) continue;
    if (refs.some((r) => r.url === url)) continue;
    const labelZh =
      (kind === "charsheet"
        ? canon?.characters.find((c) => c.id === seedId || seedId.includes(c.id))?.nameZh
        : kind === "sceneplate"
          ? canon?.locations.find((l) => l.id === seedId || seedId.includes(l.id))?.nameZh
          : canon?.props.find((p) => p.id === seedId || seedId.includes(p.id))?.nameZh) ||
      (kind === "charsheet" ? "角色定妆" : kind === "sceneplate" ? "场景参考" : "道具参考");
    const layout =
      kind === "sceneplate" && /2×2|四格/.test(String(b.prompt || ""))
        ? ("grid2x2" as const)
        : undefined;
    out.push({ blockId: id, kind, role, seedId, labelZh, url, layout });
  }
  return out;
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

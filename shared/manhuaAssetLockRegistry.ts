/**
 * 漫剧资产锁编号（对齐 Skill：角色/场景/道具分离 + 路径编号思路）。
 * 给静帧 Edit 提示与 UI 角标用：@角色1 / @场景1 / @道具1。
 * 定妆特写格自动进 @道具N + @角色K·道具i 子号（跨集同号）。
 * 编号：有垫图/融图进表；特写格逻辑号也可进表（logical://）。
 */
import { getManhuaCharacterDisplayName, getManhuaCharacterPreviewUrl } from "./manhuaCharacterAssetLibrary.js";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "./manhuaScenePropDemoCatalog.js";
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import {
  customRefsByRole,
  type ManhuaCustomAssetRef,
  type ManhuaCustomAssetRole,
} from "./manhuaCustomAssetRefs.js";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon.js";
import {
  buildManhuaSheetPropSubSlots,
  formatManhuaSheetPropSubTagsLockBlock,
  stampManhuaSheetPropSubTagsOnPrompt,
  type ManhuaSheetPropSubSlot,
} from "./manhuaSheetPropSubTags.js";

export type ManhuaAssetLockSlot = {
  /** 如 @角色1 */
  tag: string;
  role: ManhuaCustomAssetRole;
  index: number;
  id: string;
  labelZh: string;
  path: string;
  /** 定妆特写：父角色 @角色K */
  parentCharacterTag?: string;
  /** 定妆特写：@角色K·道具i */
  subTag?: string;
  fromSheetInset?: boolean;
};

export type ManhuaAssetLockRegistry = {
  slots: ManhuaAssetLockSlot[];
  byRole: Record<ManhuaCustomAssetRole, ManhuaAssetLockSlot[]>;
  /** 写入静帧 prompt：编号对照表 */
  promptBlockZh: string;
  /** 定妆特写格 → 道具子编号（跨集锁） */
  sheetPropSlots: ManhuaSheetPropSubSlot[];
};

const ROLE_TAG_PREFIX: Record<ManhuaCustomAssetRole, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

function uniqSlots(slots: ManhuaAssetLockSlot[]): ManhuaAssetLockSlot[] {
  const seenId = new Set<string>();
  const seenPath = new Set<string>();
  const out: ManhuaAssetLockSlot[] = [];
  for (const s of slots) {
    const id = String(s.id || "").trim();
    const path = String(s.path || "").trim();
    if (!path) continue;
    if (id && seenId.has(id)) continue;
    // 同一定妆卡 URL 可挂多件特写道具：特写格按 id 去重，其它按 path
    if (!s.fromSheetInset && path && seenPath.has(path)) continue;
    if (id) seenId.add(id);
    if (path) seenPath.add(path);
    out.push(s);
  }
  return out;
}

/**
 * 按 角色 → 场景 → 道具 建编号表。
 * 人物：上传优先，再补库预览；场景/道具同理。
 * 定妆特写格：自动编入 @道具N + @角色K·道具i（跨集同号）。
 */
export function buildManhuaAssetLockRegistry(opts?: {
  characterIds?: string[] | null;
  artStyleId?: string | null;
  sceneId?: string | null;
  propIds?: string[] | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
  /** 系列人物/道具表：用于特写格子编号 */
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** wa_char_* → 定妆卡 HTTPS */
  characterSheetUrlById?: Record<string, string> | null;
}): ManhuaAssetLockRegistry {
  const draft: ManhuaAssetLockSlot[] = [];

  const pushRole = (
    role: ManhuaCustomAssetRole,
    id: string,
    labelZh: string,
    path: string,
    extra?: Partial<
      Pick<ManhuaAssetLockSlot, "parentCharacterTag" | "subTag" | "fromSheetInset">
    >,
  ) => {
    const p = String(path || "").trim();
    if (!p) return;
    const index = draft.filter((s) => s.role === role).length + 1;
    draft.push({
      tag: `@${ROLE_TAG_PREFIX[role]}${index}`,
      role,
      index,
      id: String(id || "").trim() || `${role}_${index}`,
      labelZh: String(labelZh || ROLE_TAG_PREFIX[role]).trim().slice(0, 40),
      path: p,
      ...extra,
    });
  };

  // 上传与本集生成的人物垫图都进锁（生成图也是可用 HTTPS）
  const customChars = customRefsByRole(opts?.customRefs, "character");
  for (const c of customChars) {
    pushRole(
      "character",
      c.id,
      c.labelZh || (c.source === "generated" ? "角色定妆" : "上传人物"),
      c.url,
    );
  }
  for (const id of opts?.characterIds || []) {
    const key = String(id || "").trim();
    if (!key) continue;
    const path = getManhuaCharacterPreviewUrl(key, { artStyleId: opts?.artStyleId });
    if (!path) continue;
    const name =
      getManhuaCharacterDisplayName(key, { artStyleId: opts?.artStyleId }) || key;
    pushRole("character", key, name, path);
  }

  // 上传 + 本集生成的场景图都进锁；有自有图时不再塞库内皇宫大殿示范
  const customScenes = customRefsByRole(opts?.customRefs, "scene");
  for (const c of customScenes) {
    pushRole(
      "scene",
      c.id,
      c.labelZh || (c.source === "generated" ? "场景参考" : "上传场景"),
      c.url,
    );
  }
  const sceneId = String(opts?.sceneId || "").trim();
  if (sceneId && !customScenes.length) {
    const demos = listManhuaDemoAssetsForSceneTemplate(sceneId);
    const sceneName = getManhuaSceneTemplate(sceneId)?.nameZh || sceneId;
    for (const demo of demos.slice(0, 2)) {
      const path = getManhuaDemoAssetPublicUrl(demo.id);
      if (path) pushRole("scene", demo.id, demo.nameZh || sceneName, path);
    }
  }

  const customProps = customRefsByRole(opts?.customRefs, "prop");
  for (const c of customProps) {
    pushRole(
      "prop",
      c.id,
      c.labelZh || (c.source === "generated" ? "道具参考" : "上传道具"),
      c.url,
    );
  }
  if (!customProps.length) {
    for (const id of opts?.propIds || []) {
      const key = String(id || "").trim();
      if (!key) continue;
      const asset = getManhuaDemoAsset(key);
      const path = getManhuaDemoAssetPublicUrl(key);
      if (path && asset) pushRole("prop", key, asset.nameZh, path);
    }
  }

  // 定妆特写格 → 先按人物表序估 @角色，再写入道具草稿（最终 tag 在下方重编号后回填）
  const canonChars = opts?.assetCanon?.characters || [];
  const draftCharTagById: Record<string, string> = {};
  const draftChars = draft.filter((s) => s.role === "character");
  canonChars.forEach((ch, i) => {
    const hit =
      draftChars.find((s) => s.id === ch.id || s.id.includes(ch.id)) ||
      draftChars[i];
    draftCharTagById[ch.id] = hit?.tag || `@角色${i + 1}`;
  });
  const sheetDraft = buildManhuaSheetPropSubSlots({
    assetCanon: opts?.assetCanon,
    characterTagById: draftCharTagById,
    sheetUrlByCharacterId: opts?.characterSheetUrlById,
  });
  const existingPropIds = new Set(
    draft.filter((s) => s.role === "prop").map((s) => s.id),
  );
  for (const sp of sheetDraft) {
    if (existingPropIds.has(sp.propId)) continue;
    existingPropIds.add(sp.propId);
    pushRole("prop", sp.propId, sp.propNameZh, sp.path, {
      fromSheetInset: true,
      parentCharacterTag: sp.parentCharacterTag,
      subTag: sp.subTag,
    });
  }

  const counters: Record<ManhuaCustomAssetRole, number> = {
    character: 0,
    scene: 0,
    prop: 0,
  };
  const slots = uniqSlots(draft).map((s) => {
    counters[s.role] += 1;
    const index = counters[s.role];
    return { ...s, index, tag: `@${ROLE_TAG_PREFIX[s.role]}${index}` };
  });

  const byRole: Record<ManhuaCustomAssetRole, ManhuaAssetLockSlot[]> = {
    character: slots.filter((s) => s.role === "character"),
    scene: slots.filter((s) => s.role === "scene"),
    prop: slots.filter((s) => s.role === "prop"),
  };

  // 用最终 @角色 / @道具 重算子编号（跨集稳定：propId 排序）
  const finalCharTagById: Record<string, string> = {};
  for (const ch of canonChars) {
    const hit = byRole.character.find(
      (s) => s.id === ch.id || s.id.includes(ch.id) || ch.id.includes(s.id),
    );
    if (hit) finalCharTagById[ch.id] = hit.tag;
  }
  const sheetPropSlots = buildManhuaSheetPropSubSlots({
    assetCanon: opts?.assetCanon,
    characterTagById: finalCharTagById,
    sheetUrlByCharacterId: opts?.characterSheetUrlById,
  }).map((sp) => {
    const propSlot = byRole.prop.find((s) => s.id === sp.propId);
    return propSlot ? { ...sp, propTag: propSlot.tag } : sp;
  });
  // 回填 prop slot 的 subTag（取该道具首次挂靠的子号）
  for (const sp of sheetPropSlots) {
    const slot = byRole.prop.find((s) => s.id === sp.propId);
    if (!slot) continue;
    slot.parentCharacterTag = sp.parentCharacterTag;
    slot.subTag = sp.subTag;
    slot.fromSheetInset = true;
  }

  const lines = slots.map((s) => {
    const kind = s.fromSheetInset
      ? "定妆特写格"
      : `${ROLE_TAG_PREFIX[s.role]}参考图`;
    const sub = s.subTag ? ` · ${s.subTag}` : "";
    return `${s.tag}=${s.labelZh}（${kind}${sub}）`;
  });
  const sheetBlock = formatManhuaSheetPropSubTagsLockBlock(sheetPropSlots);
  const promptBlockZh = slots.length
    ? [
        "【资产锁·编号对照·必守】",
        "以下编号对应已挂载的垫图/融图参考（按序号吸收外形与场景，禁止另造新脸/新场/新道具）：",
        ...lines,
        "分镜动作须兑现上述编号资产；关系镜须同框画出已锁角色。",
        "定妆特写格道具：优先用全局 @道具N 跨集锁定；子号 @角色K·道具i 标明挂在哪张定妆卡。",
        sheetBlock,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return { slots, byRole, promptBlockZh, sheetPropSlots };
}

const ASSET_IMAGE_BIND_MARK = "【资产·Image对照】";

export type ManhuaAssetImageBindRow = {
  tag: string;
  id: string;
  labelZh: string;
  path: string;
};

export type ManhuaClipSeedanceImageBindEntry = {
  imageIndex: number;
  kind: "tail" | "asset" | "still";
  url: string;
  roleTag?: string;
  assetId?: string;
  labelZh?: string;
};

export type ManhuaClipSeedanceImageBindPlan = {
  imageUrls: string[];
  entries: ManhuaClipSeedanceImageBindEntry[];
  /** 写入 Seedance 的硬绑句 */
  bindLineZh: string;
};

function isBindableAssetPath(path: string): boolean {
  const p = String(path || "").trim();
  if (!p || p.startsWith("logical://")) return false;
  return /^https?:\/\//i.test(p) || p.startsWith("/") || p.startsWith("data:image/");
}

/** 节点可审：每行 tag|id|label|path，出片可解析并真绑 @Image */
export function formatManhuaAssetImageBindBlock(
  registry: ManhuaAssetLockRegistry | null | undefined,
  maxSlots = 12,
): string {
  const rows = (registry?.slots || [])
    .filter((s) => isBindableAssetPath(s.path))
    .slice(0, Math.max(1, maxSlots));
  if (!rows.length) return "";
  const lines = rows.map((s) => {
    const label = String(s.labelZh || "").replace(/[|\n]/g, " ").trim() || ROLE_TAG_PREFIX[s.role];
    const id = String(s.id || "").replace(/[|\n]/g, "").trim() || "unknown";
    return `${s.tag}|id=${id}|label=${label}|${String(s.path).trim()}`;
  });
  return [ASSET_IMAGE_BIND_MARK, ...lines].join("\n");
}

/**
 * @deprecated 用 formatManhuaAssetImageBindBlock；保留别名以免旧调用丢对照。
 * 现在也写 Image 对照（含 id/path），不再只写名字。
 */
export function formatManhuaAssetLockShortBlock(
  registry: ManhuaAssetLockRegistry | null | undefined,
  maxSlots = 12,
): string {
  return formatManhuaAssetImageBindBlock(registry, maxSlots);
}

export function parseManhuaAssetImageBindBlock(
  prompt: string | null | undefined,
): ManhuaAssetImageBindRow[] {
  const raw = String(prompt || "");
  const idx = raw.indexOf(ASSET_IMAGE_BIND_MARK);
  if (idx < 0) {
    // 兼容旧「【资产】@角色1=名」——无 path，无法硬绑
    return [];
  }
  const body = raw.slice(idx + ASSET_IMAGE_BIND_MARK.length);
  const end = body.search(/\n【/);
  const section = (end >= 0 ? body.slice(0, end) : body).trim();
  const rows: ManhuaAssetImageBindRow[] = [];
  for (const line of section.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("【")) continue;
    // @角色1|id=c1|label=女主|https://...
    const m = t.match(
      /^(@(?:角色|场景|道具)\d+)\|id=([^|]+)\|label=([^|]*)\|(.+)$/,
    );
    if (!m) continue;
    const path = String(m[4] || "").trim();
    if (!isBindableAssetPath(path)) continue;
    rows.push({
      tag: m[1]!,
      id: String(m[2] || "").trim(),
      labelZh: String(m[3] || "").trim(),
      path,
    });
  }
  return rows;
}

export function extractManhuaMentionedAssetTags(prompt: string | null | undefined): string[] {
  const found = String(prompt || "").match(/@(?:角色|场景|道具)\d+/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of found) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 出片硬绑：上段末帧 → 资产定妆/场/道具（按秒轴提及优先）→ 本段静帧。
 * 配额默认 6；保证至少留 1 张静帧位（有静帧时）。
 */
export function planManhuaClipSeedanceImageBind(input: {
  assetRows: ManhuaAssetImageBindRow[];
  stillUrls: string[];
  tailUrls?: string[];
  mentionedTags?: string[] | null;
  maxImages?: number;
}): ManhuaClipSeedanceImageBindPlan {
  const max = Math.max(1, Math.min(6, Math.floor(input.maxImages ?? 6)));
  const tails = (input.tailUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const stills = (input.stillUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const mentioned = new Set(
    (input.mentionedTags || []).map((t) => String(t || "").trim()).filter(Boolean),
  );

  const reserveStill = stills.length ? 1 : 0;
  const maxTail = Math.min(tails.length, Math.max(0, max - reserveStill - 1));
  // 至少给资产留 1 位（若有资产且总配额够）
  const takeTail = Math.min(tails.length, maxTail > 0 ? Math.min(2, maxTail) : 0);
  const roomAfterTail = max - takeTail;
  const assetBudget = Math.max(0, roomAfterTail - reserveStill);

  const roleOrder = (tag: string) => {
    if (tag.startsWith("@角色")) return 0;
    if (tag.startsWith("@场景")) return 1;
    return 2;
  };
  const sortedAssets = [...input.assetRows].sort((a, b) => {
    const am = mentioned.has(a.tag) ? 0 : 1;
    const bm = mentioned.has(b.tag) ? 0 : 1;
    if (am !== bm) return am - bm;
    const ro = roleOrder(a.tag) - roleOrder(b.tag);
    if (ro !== 0) return ro;
    return a.tag.localeCompare(b.tag, "zh");
  });

  const entries: ManhuaClipSeedanceImageBindEntry[] = [];
  const push = (e: Omit<ManhuaClipSeedanceImageBindEntry, "imageIndex">) => {
    if (entries.length >= max) return;
    if (entries.some((x) => x.url === e.url)) return;
    entries.push({ ...e, imageIndex: entries.length + 1 });
  };

  for (let i = 0; i < takeTail; i++) {
    push({ kind: "tail", url: tails[i]!, labelZh: "上段末帧起幅" });
  }
  let assetsTaken = 0;
  for (const row of sortedAssets) {
    if (assetsTaken >= assetBudget) break;
    push({
      kind: "asset",
      url: row.path,
      roleTag: row.tag,
      assetId: row.id,
      labelZh: row.labelZh,
    });
    assetsTaken += 1;
  }
  for (const u of stills) {
    push({ kind: "still", url: u, labelZh: "本段静帧" });
  }

  const bindLineZh = formatManhuaClipSeedanceBindLineFromEntries(entries);

  return {
    imageUrls: entries.map((e) => e.url),
    entries,
    bindLineZh,
  };
}

/** 由已定序 entries 生成 Seedance 硬绑句（含 @角色N=@ImageK 与 id） */
export function formatManhuaClipSeedanceBindLineFromEntries(
  entries: ManhuaClipSeedanceImageBindEntry[],
): string {
  const bits = entries.map((e, i) => {
    const img = `@Image${e.imageIndex || i + 1}`;
    if (e.kind === "tail") return `${img}承接上段起幅`;
    if (e.kind === "asset") {
      const idBit = e.assetId ? ` id=${e.assetId}` : "";
      const name = e.labelZh ? `（${e.labelZh}）` : "";
      return `${e.roleTag}=${img}${name}${idBit}`;
    }
    return `${img}=本段静帧`;
  });
  return bits.length
    ? `${bits.join("；")}。只按秒轴改动作/口型/运镜，脸服场锁上表@Image。`
    : "";
}

/**
 * 出片时按实际 imageUrls 顺序写 @ImageN 职责（无资产对照时的回退）。
 * 有资产对照时请用 planManhuaClipSeedanceImageBind.bindLineZh。
 */
export function formatManhuaClipImageRoleBindLine(
  imageCount: number,
  opts?: { tailCount?: number },
): string {
  const n = Math.max(0, Math.min(9, Math.floor(imageCount)));
  if (n < 1) return "";
  const tail = Math.max(0, Math.min(n - 1, Math.floor(opts?.tailCount || 0)));
  if (tail > 0) {
    const tailTags = Array.from({ length: tail }, (_, i) => `@Image${i + 1}`).join("、");
    const stillTags = Array.from(
      { length: n - tail },
      (_, i) => `@Image${tail + i + 1}`,
    ).join("、");
    return `${tailTags}承接上段起幅；${stillTags}锁定本段脸服场；只按秒轴改动作/口型/运镜。`;
  }
  if (n === 1) {
    return `@Image1锁定主体脸服场；只按秒轴改动作/口型/运镜。`;
  }
  const tags = Array.from({ length: n }, (_, i) => `@Image${i + 1}`).join("、");
  return `${tags}为参考图，严格保持各自脸服场；只按秒轴改动作/口型/运镜。`;
}

const CANVAS_ASSET_AT_MARK = "【画布资产@】";

/** 从画布资产节点 prompt 读出 @角色N / @场景N / @道具N */
export function parseManhuaCanvasAssetAtTag(
  prompt: string | null | undefined,
): string | null {
  const m = String(prompt || "").match(
    /【画布资产@】\s*(@(?:角色|场景|道具)\d+)/,
  );
  return m?.[1] || null;
}

export function stampManhuaCanvasAssetAtTag(
  prompt: string,
  tag: string,
  labelZh?: string,
): string {
  const tagClean = String(tag || "").trim();
  if (!/^@(?:角色|场景|道具)\d+$/.test(tagClean)) return String(prompt || "");
  const body = String(prompt || "")
    .replace(/【画布资产@】[^\n]*(?:\n|$)/g, "")
    .trim();
  const label = String(labelZh || "").trim().slice(0, 40);
  const line = label ? `${tagClean}=${label}` : tagClean;
  return `${CANVAS_ASSET_AT_MARK}${line}\n${body}`.trim();
}

function canvasAssetRoleFromBlockId(
  id: string,
): ManhuaCustomAssetRole | null {
  if (id.startsWith("charsheet-")) return "character";
  if (id.startsWith("sceneplate-")) return "scene";
  if (
    id.startsWith("propplate-") ||
    id.startsWith("propsheet-") ||
    id.startsWith("prop-")
  ) {
    return "prop";
  }
  return null;
}

function canvasAssetSeedId(blockId: string): string {
  return blockId
    .replace(/^charsheet-/, "")
    .replace(/^sceneplate-/, "")
    .replace(/^propplate-/, "")
    .replace(/^propsheet-/, "")
    .replace(/^prop-/, "");
}

/**
 * 给画布上的人物/场景/道具节点打上稳定 @编号（写入 prompt 首行），
 * 便于用户在静帧/成片里用 @ 锁定资产。优先对齐 registry 槽位。
 */
export function assignManhuaCanvasAssetAtTags<
  T extends { id: string; prompt: string },
>(
  blocks: T[],
  opts?: {
    registry?: ManhuaAssetLockRegistry | null;
    assetCanon?: ManhuaWriterAssetCanon | null;
    characterSheetUrlById?: Record<string, string> | null;
  },
): T[] {
  const reg = opts?.registry || null;
  let sheetSlots = reg?.sheetPropSlots || [];
  const counters: Record<ManhuaCustomAssetRole, number> = {
    character: 0,
    scene: 0,
    prop: 0,
  };
  const usedRegIds = new Set<string>();

  const assetBlocks = blocks
    .filter((b) => canvasAssetRoleFromBlockId(b.id))
    .sort((a, b) => {
      const ra = canvasAssetRoleFromBlockId(a.id)!;
      const rb = canvasAssetRoleFromBlockId(b.id)!;
      const order = { character: 0, prop: 1, scene: 2 } as const;
      if (order[ra] !== order[rb]) return order[ra] - order[rb];
      return a.id.localeCompare(b.id);
    });

  const stampById = new Map<string, { tag: string; labelZh: string }>();
  for (const b of assetBlocks) {
    const role = canvasAssetRoleFromBlockId(b.id)!;
    const seed = canvasAssetSeedId(b.id);
    const fromReg = reg?.byRole[role].find(
      (s) => !usedRegIds.has(s.id) && (s.id === seed || s.id === b.id || seed.includes(s.id)),
    );
    let tag: string;
    let labelZh: string;
    if (fromReg) {
      usedRegIds.add(fromReg.id);
      tag = fromReg.tag;
      labelZh = fromReg.labelZh;
    } else {
      counters[role] += 1;
      tag = `@${ROLE_TAG_PREFIX[role]}${counters[role]}`;
      const fromLine = String(b.prompt || "").match(/【画布资产@】@\S+=([^\n]+)/);
      labelZh = fromLine?.[1]?.trim() || seed || ROLE_TAG_PREFIX[role];
    }
    stampById.set(b.id, { tag, labelZh });
  }

  // 无 registry 时按角色内顺序重编号，保证 @角色1… 连续
  if (!reg) {
    const byRoleLists: Record<ManhuaCustomAssetRole, typeof assetBlocks> = {
      character: [],
      scene: [],
      prop: [],
    };
    for (const b of assetBlocks) {
      byRoleLists[canvasAssetRoleFromBlockId(b.id)!]!.push(b);
    }
    (["character", "prop", "scene"] as const).forEach((role) => {
      byRoleLists[role].forEach((b, i) => {
        const prev = stampById.get(b.id)!;
        stampById.set(b.id, {
          tag: `@${ROLE_TAG_PREFIX[role]}${i + 1}`,
          labelZh: prev.labelZh,
        });
      });
    });
  }

  // 定妆特写格：无 registry.sheetPropSlots 时用系列表自动编 @道具N + 子号
  if (!sheetSlots.length && opts?.assetCanon?.props?.length) {
    const built = buildManhuaAssetLockRegistry({
      assetCanon: opts.assetCanon,
      characterSheetUrlById: opts.characterSheetUrlById,
    });
    sheetSlots = built.sheetPropSlots;
  }
  if (sheetSlots.length) {
    const charsheets = assetBlocks.filter((b) => b.id.startsWith("charsheet-"));
    sheetSlots = sheetSlots.map((sp) => {
      const block =
        charsheets.find((b) => {
          const seed = canvasAssetSeedId(b.id);
          return (
            seed === sp.characterId ||
            b.id.includes(sp.characterId) ||
            sp.characterId.includes(seed)
          );
        }) || null;
      const parent = block ? stampById.get(block.id)?.tag : undefined;
      if (!parent || parent === sp.parentCharacterTag) return sp;
      return {
        ...sp,
        parentCharacterTag: parent,
        subTag: `${parent}·道具${sp.localIndex}`,
      };
    });
  }

  return blocks.map((b) => {
    const stamp = stampById.get(b.id);
    if (!stamp) return b;
    let prompt = stampManhuaCanvasAssetAtTag(b.prompt, stamp.tag, stamp.labelZh);
    // 定妆卡：盖章特写格 → @道具 子编号（跨集锁）
    if (b.id.startsWith("charsheet-") && sheetSlots.length) {
      prompt = stampManhuaSheetPropSubTagsOnPrompt(prompt, sheetSlots, stamp.tag);
    }
    return { ...b, prompt };
  });
}

/** 关键静帧是否具备像素级资产锁（Edit + 垫图），而非仅有成图 URL */
export function isManhuaKeyartPixelLocked(block: {
  id?: string;
  imageMode?: string | null;
  refImageUrl?: string | null;
  outputUrl?: string | null;
  outputUrls?: string[] | null;
}): boolean {
  if (!String(block.id || "").startsWith("keyart-")) return false;
  const hasOut = Boolean(
    String(block.outputUrl || "").trim() ||
      (Array.isArray(block.outputUrls) && block.outputUrls.some((u) => String(u || "").trim())),
  );
  if (!hasOut) return false;
  if (block.imageMode !== "edit") return false;
  return Boolean(String(block.refImageUrl || "").trim());
}

/** 本集关键静帧是否都已像素锁定（用于成片门禁） */
export function areManhuaKeyartsPixelLocked(
  blocks: Array<{
    id?: string;
    imageMode?: string | null;
    refImageUrl?: string | null;
    outputUrl?: string | null;
    outputUrls?: string[] | null;
  }> | null | undefined,
  opts?: { minCount?: number },
): boolean {
  const keyarts = (blocks || []).filter((b) => String(b.id || "").startsWith("keyart-"));
  const min = Math.max(1, opts?.minCount ?? 1);
  if (keyarts.length < min) return false;
  return keyarts.every((b) => isManhuaKeyartPixelLocked(b));
}

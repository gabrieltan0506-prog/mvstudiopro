/**
 * 漫剧资产锁编号（对齐 Skill：角色/场景/道具分离 + 路径编号思路）。
 * 给静帧 Edit 提示与 UI 角标用：@角色1 / @场景1 / @道具1。
 * 编号只对「可下载垫图/融图」资产计数；未落盘不进表。
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

export type ManhuaAssetLockSlot = {
  /** 如 @角色1 */
  tag: string;
  role: ManhuaCustomAssetRole;
  index: number;
  id: string;
  labelZh: string;
  path: string;
};

export type ManhuaAssetLockRegistry = {
  slots: ManhuaAssetLockSlot[];
  byRole: Record<ManhuaCustomAssetRole, ManhuaAssetLockSlot[]>;
  /** 写入静帧 prompt：编号对照表 */
  promptBlockZh: string;
};

const ROLE_TAG_PREFIX: Record<ManhuaCustomAssetRole, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

function uniqByPath(slots: ManhuaAssetLockSlot[]): ManhuaAssetLockSlot[] {
  const seen = new Set<string>();
  const out: ManhuaAssetLockSlot[] = [];
  for (const s of slots) {
    const path = String(s.path || "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(s);
  }
  return out;
}

/**
 * 按 角色 → 场景 → 道具 建编号表。
 * 人物：上传优先，再补库预览；场景/道具同理。
 */
export function buildManhuaAssetLockRegistry(opts?: {
  characterIds?: string[] | null;
  artStyleId?: string | null;
  sceneId?: string | null;
  propIds?: string[] | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
}): ManhuaAssetLockRegistry {
  const draft: ManhuaAssetLockSlot[] = [];

  const pushRole = (
    role: ManhuaCustomAssetRole,
    id: string,
    labelZh: string,
    path: string,
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

  const counters: Record<ManhuaCustomAssetRole, number> = {
    character: 0,
    scene: 0,
    prop: 0,
  };
  const slots = uniqByPath(draft).map((s) => {
    counters[s.role] += 1;
    const index = counters[s.role];
    return { ...s, index, tag: `@${ROLE_TAG_PREFIX[s.role]}${index}` };
  });

  const byRole: Record<ManhuaCustomAssetRole, ManhuaAssetLockSlot[]> = {
    character: slots.filter((s) => s.role === "character"),
    scene: slots.filter((s) => s.role === "scene"),
    prop: slots.filter((s) => s.role === "prop"),
  };

  const lines = slots.map(
    (s) => `${s.tag}=${s.labelZh}（${ROLE_TAG_PREFIX[s.role]}参考图）`,
  );
  const promptBlockZh = slots.length
    ? [
        "【资产锁·编号对照·必守】",
        "以下编号对应已挂载的垫图/融图参考（按序号吸收外形与场景，禁止另造新脸/新场/新道具）：",
        ...lines,
        "分镜动作须兑现上述编号资产；关系镜须同框画出已锁角色。",
      ].join("\n")
    : "";

  return { slots, byRole, promptBlockZh };
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
  opts?: { registry?: ManhuaAssetLockRegistry | null },
): T[] {
  const reg = opts?.registry || null;
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

  return blocks.map((b) => {
    const stamp = stampById.get(b.id);
    if (!stamp) return b;
    return {
      ...b,
      prompt: stampManhuaCanvasAssetAtTag(b.prompt, stamp.tag, stamp.labelZh),
    };
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

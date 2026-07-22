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

  const uploadChars = customRefsByRole(opts?.customRefs, "character").filter(
    (c) => c.source !== "generated",
  );
  for (const c of uploadChars) {
    pushRole("character", c.id, c.labelZh || "上传人物", c.url);
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

  const uploadScenes = customRefsByRole(opts?.customRefs, "scene").filter(
    (c) => c.source !== "generated",
  );
  for (const c of uploadScenes) {
    pushRole("scene", c.id, c.labelZh || "上传场景", c.url);
  }
  const sceneId = String(opts?.sceneId || "").trim();
  if (sceneId && !uploadScenes.length) {
    const demos = listManhuaDemoAssetsForSceneTemplate(sceneId);
    const sceneName = getManhuaSceneTemplate(sceneId)?.nameZh || sceneId;
    for (const demo of demos.slice(0, 2)) {
      const path = getManhuaDemoAssetPublicUrl(demo.id);
      if (path) pushRole("scene", demo.id, demo.nameZh || sceneName, path);
    }
  }

  const uploadProps = customRefsByRole(opts?.customRefs, "prop").filter(
    (c) => c.source !== "generated",
  );
  for (const c of uploadProps) {
    pushRole("prop", c.id, c.labelZh || "上传道具", c.url);
  }
  if (!uploadProps.length) {
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

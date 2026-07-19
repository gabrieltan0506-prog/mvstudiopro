/**
 * 关键静帧 · 用 GPT-Image-2 edit + 多图融图套场景/道具/角色示范图。
 * 有可抓取示范图 → imageMode=edit + image_urls；缺图 → 文案锚点并走文生图重做。
 */

import {
  getAncientArchetypePreviewUrl,
} from "./manhuaAncientDesignBoard.js";
import { getManhuaCharacterPreviewUrl } from "./manhuaCharacterAssetLibrary.js";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "./manhuaScenePropDemoCatalog.js";
export type ManhuaKeyartEditRef = {
  id: string;
  role: "character" | "ancient" | "scene" | "prop";
  labelZh: string;
  /** 站点相对路径，如 /manhua-props/xxx.jpg；运行时再转绝对 URL */
  path: string;
};

export type ManhuaKeyartEditPlan = {
  /** 是否具备至少一张底图，可走 edit/融图 */
  canEdit: boolean;
  /** 底图（优先角色/古风 sheet，其次场景空镜） */
  refImageUrl?: string;
  /** 融图参考（不含底图），最多 15 */
  editFusionUrls: string[];
  refs: ManhuaKeyartEditRef[];
  /** 点选了但未落盘的资产，须靠文生/文案补 */
  missingLabelsZh: string[];
  /** 写入静帧 prompt 的 edit 说明 */
  editPromptAddonZh: string;
};

function uniqPaths(items: ManhuaKeyartEditRef[]): ManhuaKeyartEditRef[] {
  const seen = new Set<string>();
  const out: ManhuaKeyartEditRef[] = [];
  for (const it of items) {
    const path = String(it.path || "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ ...it, path });
  }
  return out;
}

/**
 * 收集角色 / 古风 / 场景示范 / 道具示范的可融图 URL，并给出 edit 计划。
 */
export function planManhuaKeyartEditFusion(opts?: {
  characterIds?: string[] | null;
  ancientArchetypeIds?: string[] | null;
  artStyleId?: string | null;
  sceneId?: string | null;
  propIds?: string[] | null;
}): ManhuaKeyartEditPlan {
  const refs: ManhuaKeyartEditRef[] = [];
  const missingLabelsZh: string[] = [];

  for (const id of opts?.ancientArchetypeIds || []) {
    const key = String(id || "").trim();
    if (!key) continue;
    // 古风 sheet 尚未批量落盘：勿挂会 404 的路径毒死 image_urls，改文生补造型
    const path = getAncientArchetypePreviewUrl(key);
    void path;
    missingLabelsZh.push(`古风原型 ${key}（造型按文案重绘）`);
  }

  for (const id of opts?.characterIds || []) {
    const key = String(id || "").trim();
    if (!key) continue;
    const path = getManhuaCharacterPreviewUrl(key, { artStyleId: opts?.artStyleId });
    if (path) {
      refs.push({ id: key, role: "character", labelZh: `角色·${key}`, path });
    } else {
      missingLabelsZh.push(`角色 ${key}`);
    }
  }

  const sceneTemplateId = String(opts?.sceneId || "").trim();
  if (sceneTemplateId) {
    const demos = listManhuaDemoAssetsForSceneTemplate(sceneTemplateId);
    let gotScene = false;
    for (const demo of demos.slice(0, 2)) {
      const path = getManhuaDemoAssetPublicUrl(demo.id);
      if (path) {
        refs.push({ id: demo.id, role: "scene", labelZh: demo.nameZh, path });
        gotScene = true;
      }
    }
    if (!gotScene && demos.length) {
      missingLabelsZh.push(...demos.slice(0, 2).map((d) => `场景·${d.nameZh}`));
    } else if (!demos.length) {
      missingLabelsZh.push(`场景模板 ${sceneTemplateId}`);
    }
  }

  for (const id of opts?.propIds || []) {
    const key = String(id || "").trim();
    if (!key) continue;
    const asset = getManhuaDemoAsset(key);
    const path = getManhuaDemoAssetPublicUrl(key);
    if (path && asset) {
      refs.push({ id: key, role: "prop", labelZh: asset.nameZh, path });
    } else {
      missingLabelsZh.push(asset ? `道具·${asset.nameZh}` : `道具 ${key}`);
    }
  }

  const ready = uniqPaths(refs);
  const base =
    ready.find((r) => r.role === "ancient" || r.role === "character") ||
    ready.find((r) => r.role === "scene") ||
    ready[0];
  const fusion = ready.filter((r) => r.path !== base?.path).slice(0, 15);
  const canEdit = Boolean(base?.path);

  const editPromptAddonZh = [
    "【静帧·示范图融图】",
    canEdit
      ? "底图与参考图已挂载：请用改图/融图把角色放进场景，道具必须入画且与题材时代一致；保持人物身份与服装连续，禁止空棚抠贴、禁止错时代穿戴。"
      : "暂无可用示范底图：请按文案锚点完整文生一张关键静帧（人物+场景+道具同框）。",
    fusion.length
      ? `融图参考 ${fusion.length} 张：${fusion.map((r) => r.labelZh).join("、")}——按构图需要吸收其造型/环境/道具外观。`
      : "",
    missingLabelsZh.length
      ? `下列点选资产尚无示范图文件，须按文字锚点重新生成进画面：${missingLabelsZh.join("、")}。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    canEdit,
    refImageUrl: base?.path,
    editFusionUrls: fusion.map((r) => r.path),
    refs: ready,
    missingLabelsZh,
    editPromptAddonZh,
  };
}

/** 把相对站点路径转成 EvoLink 可抓取的绝对 URL（浏览器端用 location.origin） */
export function absolutizeManhuaAssetUrl(
  pathOrUrl: string | undefined | null,
  origin?: string | null,
): string {
  const u = String(pathOrUrl || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (!u.startsWith("/")) return "";
  const base = String(
    origin || (typeof globalThis !== "undefined" && "location" in globalThis
      ? (globalThis as { location?: { origin?: string } }).location?.origin
      : "") ||
      "",
  )
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}${u}`;
}

export function absolutizeManhuaAssetUrls(
  urls: Array<string | undefined | null>,
  origin?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const abs = absolutizeManhuaAssetUrl(u, origin);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

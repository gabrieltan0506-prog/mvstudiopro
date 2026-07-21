/**
 * 关键静帧 · 用官方 GPT-Image-2 edit（OpenAI images/edits → 失败回落 OpenRouter）多图融图。
 * 有可抓取示范图 → imageMode=edit + referenceImageUrls；缺图 → 文案锚点并走文生图重做。
 * CG 漫剧画风：禁止拿仿真人示范图做 edit 底图（会把成片锁成照片），改走文生 + 画风硬锁。
 * 不走 EvoLink。
 * 古风无 sheet：禁止挂 404；必须用服饰/发型硬锁 + 场景/道具示范图融进画。
 */

import {
  getAncientArchetypePreviewUrl,
} from "./manhuaAncientDesignBoard.js";
import { getAncientArchetypeById } from "./manhuaAncientArchetypeLibrary.js";
import {
  getManhuaCharacterPreviewUrl,
  normalizeManhuaArtStyleId,
} from "./manhuaCharacterAssetLibrary.js";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "./manhuaScenePropDemoCatalog.js";
import {
  customRefsByRole,
  taggedManhuaCustomAssetRefs,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";

export type ManhuaKeyartEditRef = {
  id: string;
  role: "character" | "ancient" | "scene" | "prop";
  labelZh: string;
  /** 站点相对路径或 HTTPS（用户上传）；运行时再转绝对 URL */
  path: string;
};

export type ManhuaKeyartEditPlan = {
  /** 是否具备至少一张底图，可走 edit/融图 */
  canEdit: boolean;
  /** 底图（都市：角色优先；古装：场景/道具优先，人物只进融图） */
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

/** 古风无定妆 sheet：把发型/服饰/气质写成硬锁，供 edit 与文生重做共用 */
export function buildManhuaKeyartAncientHardLockZh(ancientArchetypeIds?: string[] | null): string {
  const ids = (ancientArchetypeIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return "";
  const lines: string[] = [
    "【古装时代硬锁·必守】",
    "本集为古装/宫廷/江湖题材。画面人物必须古装：发髻或束发、袍服/甲胄/宫装层次齐全。",
    "禁止：西装、衬衫、T恤、运动背心、球衣、网球拍、球拍、运动鞋、连衣裙街拍、现代城市夜景、手机、汽车、霓虹、鸡汤字幕、网感竖屏封面字。",
    "有场景示范图时：宫殿/殿宇/客栈等环境层次必须保留可读；点选道具必须入画且时代正确。",
    "若参考图含现代人/运动装：只可借五官气质与体态比例，必须整身改绘为古装并置入古代场景，禁止保留球拍、运动服、街拍背景。",
    "古风定妆 sheet 未落盘：人物外形按下列原型从零绘制进场景，不得套用都市脸与现代衣着。",
  ];
  let n = 0;
  for (const id of ids) {
    const b = getAncientArchetypeById(id);
    if (!b) {
      lines.push(`- 原型 ${id}：按古装身份重绘（服饰发型与题材一致）。`);
      continue;
    }
    n += 1;
    lines.push(
      [
        `${n}. ${b.nameZh}（${b.id}）`,
        `五官气质：${b.faceTemperamentZh}`,
        `发型：${b.hairstyleZh}`,
        `服饰：${b.wardrobeLayers.join("、")}`,
        `随身：${b.props.slice(0, 4).join("、")}`,
        `配色：${b.palette.join("、")}`,
      ].join("；"),
    );
  }
  return lines.join("\n");
}

/**
 * 收集角色 / 古风 / 场景示范 / 道具示范 / 用户上传的可融图 URL，并给出 edit 计划。
 * 用户上传图优先：有对应角色的自传图时，不再强制并入库内同类路径。
 */
export function planManhuaKeyartEditFusion(opts?: {
  characterIds?: string[] | null;
  ancientArchetypeIds?: string[] | null;
  artStyleId?: string | null;
  sceneId?: string | null;
  propIds?: string[] | null;
  /** 用户上传并勾选角色的参考图（HTTPS） */
  customRefs?: ManhuaCustomAssetRef[] | null;
}): ManhuaKeyartEditPlan {
  const refs: ManhuaKeyartEditRef[] = [];
  const missingLabelsZh: string[] = [];
  const customTagged = taggedManhuaCustomAssetRefs(opts?.customRefs);
  const customChars = customRefsByRole(opts?.customRefs, "character");
  const customScenes = customRefsByRole(opts?.customRefs, "scene");
  const customProps = customRefsByRole(opts?.customRefs, "prop");
  const preferCustomCast = customChars.length > 0;
  const preferCustomScene = customScenes.length > 0;
  const preferCustomProp = customProps.length > 0;
  /** 古装轨始终保留原型硬锁；有自传人物时只跳过库内都市 sheet，不得清空硬锁 */
  const ancientIds = (opts?.ancientArchetypeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const isAncientLane = ancientIds.length > 0;
  /** CG 漫剧：库内示范/宫殿空镜多为仿真人质感，edit 会压过画风硬锁 */
  const isCgDrama = normalizeManhuaArtStyleId(opts?.artStyleId) === "cg_drama";
  const hardLockZh = buildManhuaKeyartAncientHardLockZh(ancientIds);

  for (const c of customTagged) {
    const roleLabel =
      c.role === "character" ? "人物" : c.role === "scene" ? "场景" : "服装道具";
    refs.push({
      id: c.id,
      role: c.role,
      labelZh: c.labelZh || `自传·${roleLabel}`,
      path: c.url,
    });
  }

  for (const id of ancientIds) {
    // 古风 sheet 目录为空：勿挂 404 毒死 edits；造型走硬锁文案
    void getAncientArchetypePreviewUrl(id);
    const board = getAncientArchetypeById(id);
    missingLabelsZh.push(
      board ? `古风·${board.nameZh}（无定妆图，按硬锁重绘）` : `古风原型 ${id}（无定妆图，按硬锁重绘）`,
    );
  }

  // 已挂古风时不再挂都市角色 sheet；有自传人物时也不挂库角色
  if (!isAncientLane && !preferCustomCast) {
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
  }

  const sceneTemplateId = String(opts?.sceneId || "").trim();
  if (sceneTemplateId && !preferCustomScene) {
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

  if (!preferCustomProp) {
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
  }

  const ready = uniqPaths(refs);
  const characterRefCount = ready.filter((r) => r.role === "character").length;
  const multiCastHint =
    ancientIds.length >= 2 || characterRefCount >= 2 || /两人|双人|对视|对峙/.test(hardLockZh);
  // 多角色时优先用场景作底，避免单人定妆 sheet 把成图锁成单人肖像
  const sceneBase = ready.find((r) => r.role === "scene");
  const propBase = ready.find((r) => r.role === "prop");
  const castBase = ready.find((r) => r.role === "ancient" || r.role === "character");
  /**
   * 古装轨：底图必须是场景/道具（时代正确的环境），人物自传图只进融图。
   * 若只有现代人物参考、没有环境底图 → 改走文生+硬锁，避免把网球街拍当 edit 底图锁死成片。
   */
  const base = isAncientLane
    ? sceneBase || propBase || undefined
    : (multiCastHint && sceneBase) || castBase || sceneBase || ready[0];
  const fusion = ready.filter((r) => r.path !== base?.path).slice(0, 15);
  /** CG：不走 edit（示范图仿真人质感会盖住分镜与画风）；仿真人仍可用场景/角色 edit */
  const canEdit = !isCgDrama && Boolean(base?.path);
  const baseIsEnvOnly = Boolean(base && (base.role === "scene" || base.role === "prop"));
  const castCountLock =
    ancientIds.length >= 2 || characterRefCount >= 2
      ? `人数硬锁：本集已锁定 ${Math.max(ancientIds.length, characterRefCount)} 名主角定妆/原型；关系镜、对峙镜、递接镜必须同框画出全部已锁定主角，禁止只保留单人半身定妆像。`
      : "人数硬锁：分镜若写两人/对视/对峙/递接，必须同框出现至少两名可读人物，禁止只画单人肖像。";

  const customHint = customTagged.length
    ? isAncientLane && preferCustomCast
      ? `用户上传参考 ${customTagged.length} 张：场景/道具可直接吸收环境层次；人物参考只借五官气质与体态，必须按古装硬锁整身改绘，禁止保留运动装/街拍/现代背景。`
      : `用户上传参考 ${customTagged.length} 张（已按人物/场景/服装道具勾选）：请优先吸收其外形、环境与道具，勿被库内示范图带跑。`
    : "";

  const cgStyleLockZh = isCgDrama
    ? "【画风执行·CG 漫剧】本集已选手绘 CG：必须半写实二次元/国乙厚涂，禁止仿真人皮肤、纪实摄影、真人剧照；构图与场面以【分镜·静帧】动作为准，示范图只作文案空间参考、不得当照片底图套用。"
    : "";

  const refLabelsZh = ready.map((r) => r.labelZh).filter(Boolean);
  const editPromptAddonZh = [
    customTagged.length ? "【静帧·用户参考融图】" : "【静帧·示范图融图】",
    hardLockZh,
    cgStyleLockZh,
    castCountLock,
    customHint,
    canEdit
      ? baseIsEnvOnly && (ancientIds.length || characterRefCount)
        ? "底图是场景/道具参考：请把硬锁与角色锚点中的人物全部绘入该环境（多角色须同框），道具入画；禁止在宫景里画现代人，禁止改成都市街拍，禁止只贴一张单人定妆脸。"
        : "底图与参考图已挂载：请用改图/融图把角色放进场景；多角色场面须同框；道具必须入画且与题材时代一致；保持人物身份与服装连续，禁止空棚抠贴、禁止错时代穿戴、禁止单人肖像偷懒。"
      : isCgDrama
        ? `CG 漫剧文生路径：按【分镜·静帧】动作/运镜/人数优先完整文生；${
            refLabelsZh.length
              ? `空间与道具文案参考：${refLabelsZh.join("、")}（只借布局与物件，不借照片皮肤）。`
              : "结合场景与角色文案锚点。"
          }`
        : isAncientLane
          ? "暂无可用古代场景底图：请按硬锁与文案锚点完整文生一张关键静帧（人物必须古装+宫殿/江湖环境同框；禁止以现代人物参考图为底做改图）。"
          : "暂无可用参考底图：请按硬锁与文案锚点完整文生一张关键静帧（人物+场景+道具同框；关系镜须双人以上）。",
    canEdit && fusion.length
      ? `融图参考 ${fusion.length} 张：${fusion.map((r) => r.labelZh).join("、")}——吸收其外形/环境/道具；多角色时每位主角都要入画。`
      : "",
    missingLabelsZh.length
      ? `下列点选资产尚无示范图文件，须按文字/硬锁重新生成进画面：${missingLabelsZh.join("、")}。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    canEdit,
    refImageUrl: canEdit ? base?.path : undefined,
    editFusionUrls: canEdit ? fusion.map((r) => r.path) : [],
    refs: ready,
    missingLabelsZh,
    editPromptAddonZh,
  };
}

/** 把相对站点路径转成 HTTPS 绝对 URL（OpenAI/OpenRouter edits 服务端需可下载） */
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

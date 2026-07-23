/**
 * 关键静帧 · 官方 GPT-Image-2 edit（OpenAI images/edits）。
 * 身份锚点：人物库预览图（或用户上传，非 generated）→ 服务端垫图 → edits。
 * 禁止：用本集生成定妆图当身份；禁止缺底图时静默纯文生（易漂成无关主体）。
 * CG：仍用人库/自传垫图 + 画风硬锁改绘，不挂生成设定卡。
 * 不走 EvoLink。
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
import { buildManhuaAssetLockRegistry } from "./manhuaAssetLockRegistry.js";
import type { ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon.js";

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
  /** 底图（都市：角色库优先；古装：场景/道具优先，人物只进融图） */
  refImageUrl?: string;
  /** 融图参考（不含底图），最多 15 */
  editFusionUrls: string[];
  refs: ManhuaKeyartEditRef[];
  /** 点选了但未落盘的资产，须靠文生/文案补 */
  missingLabelsZh: string[];
  /** 写入静帧 prompt 的 edit 说明 */
  editPromptAddonZh: string;
  /**
   * 已锁定人物库/可用垫图时为 true：运行时必须 edit，禁止纯文生回退。
   */
  requireLibraryEdit?: boolean;
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

/** 古风无定妆 sheet：把发型/服饰/气质写成硬锁，供 edit 共用 */
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
 * 收集角色库 / 场景示范 / 道具示范 / 用户上传（非 generated）可融图 URL，并给出 edit 计划。
 * 人物身份优先人物库预览；本集生成定妆 / generated 自传不进身份垫图。
 */
export function planManhuaKeyartEditFusion(opts?: {
  characterIds?: string[] | null;
  ancientArchetypeIds?: string[] | null;
  artStyleId?: string | null;
  sceneId?: string | null;
  propIds?: string[] | null;
  /** 用户上传并勾选角色的参考图（HTTPS）；generated 不进人物身份 */
  customRefs?: ManhuaCustomAssetRef[] | null;
  /** 系列人物/道具表：定妆特写格进 @道具N 子编号（跨集锁） */
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** wa_char_* → 定妆卡 HTTPS */
  characterSheetUrlById?: Record<string, string> | null;
  /**
   * @deprecated 关键静帧不再用本集生成设定卡做身份锁；保留参数以免旧调用炸掉。
   */
  identityImageUrls?: string[] | null;
}): ManhuaKeyartEditPlan {
  const refs: ManhuaKeyartEditRef[] = [];
  const missingLabelsZh: string[] = [];
  // 生成定妆不进人物身份垫图（易漂）；只认上传或库预览
  const customTagged = taggedManhuaCustomAssetRefs(opts?.customRefs).filter(
    (c) => !(c.role === "character" && c.source === "generated"),
  );
  const customChars = customRefsByRole(opts?.customRefs, "character").filter(
    (c) => c.source !== "generated",
  );
  const customScenes = customRefsByRole(opts?.customRefs, "scene").filter(
    (c) => c.source !== "generated",
  );
  const customProps = customRefsByRole(opts?.customRefs, "prop").filter(
    (c) => c.source !== "generated",
  );
  const preferCustomScene = customScenes.length > 0;
  const preferCustomProp = customProps.length > 0;
  const ancientIds = (opts?.ancientArchetypeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const isAncientLane = ancientIds.length > 0;
  const isCgDrama = normalizeManhuaArtStyleId(opts?.artStyleId) === "cg_drama";
  const hardLockZh = buildManhuaKeyartAncientHardLockZh(ancientIds);
  void opts?.identityImageUrls;

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
    void getAncientArchetypePreviewUrl(id);
    const board = getAncientArchetypeById(id);
    missingLabelsZh.push(
      board ? `古风·${board.nameZh}（无定妆图，按硬锁重绘）` : `古风原型 ${id}（无定妆图，按硬锁重绘）`,
    );
  }

  // 都市/CG：始终挂人物库预览作垫图身份（不因自传而跳过库）
  const libraryCastPaths: string[] = [];
  if (!isAncientLane) {
    for (const id of opts?.characterIds || []) {
      const key = String(id || "").trim();
      if (!key) continue;
      const path = getManhuaCharacterPreviewUrl(key, { artStyleId: opts?.artStyleId });
      if (path) {
        refs.push({ id: key, role: "character", labelZh: `角色库·${key}`, path });
        libraryCastPaths.push(path);
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
  const sceneBase = ready.find((r) => r.role === "scene");
  const propBase = ready.find((r) => r.role === "prop");
  // 人物库路径优先于自传人物，避免生成定妆/漂移图抢底
  const libraryCastBase = ready.find(
    (r) => r.role === "character" && libraryCastPaths.includes(r.path),
  );
  const uploadCastBase = ready.find(
    (r) => r.role === "character" && !libraryCastPaths.includes(r.path),
  );
  const castBase = libraryCastBase || uploadCastBase;
  /**
   * 古装轨：底图必须是场景/道具（时代正确的环境），人物自传/库只进融图。
   * 都市/CG：人物库垫图优先；多角色时用场景作底、人物融图。
   */
  const base = isAncientLane
    ? sceneBase || propBase || undefined
    : (multiCastHint && sceneBase) || castBase || sceneBase || ready[0];
  const fusion = ready.filter((r) => r.path !== base?.path).slice(0, 15);

  const canEdit = Boolean(base?.path);
  const requireLibraryEdit =
    canEdit &&
    (libraryCastPaths.length > 0 || customChars.length > 0 || Boolean(sceneBase || propBase));
  const baseIsEnvOnly = Boolean(base && (base.role === "scene" || base.role === "prop"));
  const castCountLock =
    ancientIds.length >= 2 || characterRefCount >= 2
      ? `人数硬锁：本集已锁定 ${Math.max(ancientIds.length, characterRefCount)} 名主角；关系镜、对峙镜、递接镜必须同框画出全部已锁定主角，禁止只保留单人半身定妆像。`
      : "人数硬锁：分镜若写两人/对视/对峙/递接，必须同框出现至少两名可读人物，禁止只画单人肖像。";

  const customHint = customTagged.length
    ? isAncientLane && customChars.length
      ? `用户上传参考 ${customTagged.length} 张：场景/道具可直接吸收环境层次；人物参考只借五官气质与体态，必须按古装硬锁整身改绘，禁止保留运动装/街拍/现代背景。`
      : `用户上传参考 ${customTagged.length} 张（已按人物/场景/服装道具勾选）：与人物库垫图一并融图；勿被无关主体带跑。`
    : "";

  const cgStyleLockZh = isCgDrama
    ? "【画风执行·CG 漫剧】本集已选手绘 CG：必须半写实二次元/国乙厚涂，禁止仿真人皮肤、纪实摄影、真人剧照；构图与场面以【分镜·静帧】动作为准。垫图只借五官轮廓与服化色块，必须整身 CG 改绘。"
    : "";

  const libraryPadHintZh = libraryCastPaths.length
    ? "【静帧·人物库垫图·改图】底图来自人物库预览（已服务端垫进竖版画幅）：请在垫图上改绘分镜动作与场面，保持身份连续；禁止抛开垫图纯文生无关主体。"
    : customChars.length
      ? "【静帧·用户垫图·改图】底图来自用户上传人物参考：请在垫图上改绘分镜动作与场面，保持身份连续；禁止抛开垫图纯文生无关主体。"
      : "";

  const assetLock = buildManhuaAssetLockRegistry({
    characterIds: opts?.characterIds,
    artStyleId: opts?.artStyleId,
    sceneId: opts?.sceneId,
    propIds: opts?.propIds,
    customRefs: opts?.customRefs,
    assetCanon: opts?.assetCanon,
    characterSheetUrlById: opts?.characterSheetUrlById,
  });

  const refLabelsZh = ready.map((r) => r.labelZh).filter(Boolean);
  const editPromptAddonZh = [
    libraryPadHintZh
      ? libraryPadHintZh
      : customTagged.length
        ? "【静帧·用户参考融图】"
        : "【静帧·示范图融图】",
    assetLock.promptBlockZh,
    hardLockZh,
    cgStyleLockZh,
    castCountLock,
    customHint,
    canEdit
      ? baseIsEnvOnly && (ancientIds.length || characterRefCount)
        ? "底图是场景/道具参考：请把硬锁与角色锚点中的人物全部绘入该环境（多角色须同框），道具入画；禁止在宫景里画现代人，禁止改成都市街拍，禁止只贴一张单人定妆脸。"
        : "底图与参考图已挂载（垫图+改图）：请按【资产锁·编号对照】把角色放进场景；多角色场面须同框；道具必须入画且与题材时代一致；保持人物身份与服装连续，禁止空棚抠贴、禁止错时代穿戴、禁止单人肖像偷懒，禁止抛开垫图另画无关主体。"
      : isAncientLane
        ? "暂无可用古代场景底图：请先锁定场景/道具示范或上传场景参考后再出静帧（禁止以现代人物参考图为底做改图，也禁止无垫图纯文生）。"
        : "暂无可用人物库/场景垫图：请先从人物库锁定角色（或上传人物参考）后再出静帧；禁止无垫图纯文生。",
    canEdit && fusion.length
      ? `融图参考 ${fusion.length} 张：${fusion.map((r) => r.labelZh).join("、")}——吸收其外形/环境/道具；多角色时每位主角都要入画。`
      : "",
    !canEdit && refLabelsZh.length
      ? `已点选但未形成垫图：${refLabelsZh.join("、")}。`
      : "",
    missingLabelsZh.length
      ? `下列点选资产尚无示范图文件，须在有垫图的 edit 中按文字/硬锁补进画面：${missingLabelsZh.join("、")}。`
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
    requireLibraryEdit,
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

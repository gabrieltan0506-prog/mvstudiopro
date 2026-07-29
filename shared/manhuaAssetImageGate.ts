/**
 * 漫剧资产门禁：剧本确认后，须锁定角色+场景，且本集设定卡/场景图齐，才解禁分镜。
 * 优先编剧表真源（wa_*）；其次库 ID；或用户上传勾选人物+场景。
 */

import {
  buildManhuaCharacterSheetGenPrompt,
  getManhuaArtStylePreset,
  getManhuaCharacterById,
  type ManhuaArtStyleId,
} from "./manhuaCharacterAssetLibrary.js";
import { getAncientArchetypeById } from "./manhuaAncientArchetypeLibrary.js";
import { buildAncientArchetypePrompt } from "./manhuaAncientDesignBoard.js";
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import {
  buildManhuaPropPlateGenPrompt,
  buildManhuaScenePlateGenPrompt,
} from "./manhuaScriptVisualBrief.js";
import { findManhuaAssetCoverageGaps } from "./manhuaAssetScriptSync.js";
import {
  customRefsByRole,
  hasCustomCastAndScene,
  inferManhuaCustomAssetRole,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";
import {
  resolveEpisodeMainScene,
  type ManhuaWriterAssetAnchor,
  type ManhuaWriterAssetCanon,
} from "./manhuaWriterAssetCanon.js";
import { composeManhuaWriterCanonSheetPrompt } from "./manhuaDirectorDistill.js";
import {
  composeManhuaHeroFaceCloseupPrompt,
  composeManhuaHeroFullBodyLookPrompt,
  isManhuaHeroCharacterAnchor,
  pickPropsForCharacterSheet,
  resolveManhuaLeadCharacterIds,
  resolveManhuaScenePlatePrompt,
  type ManhuaEpisodeBodyRef,
} from "./manhuaMultiViewAssetSheets.js";

/** 库原型文案里的「男主/女主」只作气质参考，出图前抹掉性别硬锁词 */
function stripArchetypeGenderLockZh(text: string): string {
  return String(text || "")
    .replace(/复仇男主|权谋男主|东方神话女帝|宫廷至尊|权柄女性/g, "")
    .replace(/男主|女主|男配|女配/g, "")
    .replace(/[；;]\s*[；;]/g, "；")
    .replace(/^[\s；;]+|[\s；;]+$/g, "")
    .trim();
}

export type ManhuaAssetImageGateInput = {
  characterIds?: string[];
  ancientArchetypeIds?: string[];
  sceneId?: string | null;
  artStyleId?: ManhuaArtStyleId | string | null;
  topic?: string;
  /** 用户上传并勾选角色的参考图 */
  customRefs?: ManhuaCustomAssetRef[] | null;
  /** 编剧表资产真源（方案 A） */
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** 当前集号：决定主场景 */
  episodeIndex?: number;
  /** 全系列分集体：用于判定场景是否跨集（≥2 集 → 四视角拼板） */
  episodes?: ManhuaEpisodeBodyRef[] | null;
  /**
   * C：显式男女主（canon 角色 id）。设了则这些为主角（脸+全身两张）；
   * 未设则按跨集提及次数取前二为主角，其余配角出单张全身。
   */
  leadCharacterIds?: Array<string | null | undefined> | null;
  /** 画布上已有的角色设定卡 / 场景设定图节点 */
  assetBlocks?: Array<{
    id: string;
    outputUrl?: string | null;
    outputUrls?: string[] | null;
  }>;
};

export type ManhuaAssetImageGateResult = {
  castLocked: boolean;
  sceneLocked: boolean;
  castImagesReady: boolean;
  sceneImageReady: boolean;
  /** 走用户上传勾选路径（不强制库内角色/场景） */
  viaCustomUpload: boolean;
  /** 走编剧表真源锁定 */
  viaWriterCanon: boolean;
  /** 角色+场景已锁定且本集设定图齐 → 可进分镜 */
  ready: boolean;
  missingCastIds: string[];
  missingScene: boolean;
  hintZh: string | null;
};

function blockHasMedia(b?: { outputUrl?: string | null; outputUrls?: string[] | null }): boolean {
  return Boolean(b?.outputUrl || b?.outputUrls?.[0]);
}

function findAssetBlock(
  blocks: ManhuaAssetImageGateInput["assetBlocks"],
  prefix: string,
  token: string,
) {
  const needle = `${prefix}${token}`;
  return (blocks || []).find((b) => b.id.includes(needle) || b.id.endsWith(token));
}

/** 收集本集已出角色设定卡图 URL（供 CG 身份锁） */
export function collectManhuaIdentityImageUrls(
  input: Pick<
    ManhuaAssetImageGateInput,
    "characterIds" | "ancientArchetypeIds" | "customRefs" | "assetBlocks" | "assetCanon"
  >,
): string[] {
  const urls: string[] = [];
  for (const c of customRefsByRole(input.customRefs, "character")) {
    const u = String(c.url || "").trim();
    if (u && /^https?:\/\//i.test(u)) urls.push(u);
  }
  const castIds = [
    ...(input.assetCanon?.characters.map((c) => c.id) || []),
    ...(input.characterIds || []),
    ...(input.ancientArchetypeIds || []),
  ]
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  for (const id of castIds) {
    const sheet = findAssetBlock(input.assetBlocks, "charsheet-", id);
    const u = String(sheet?.outputUrl || sheet?.outputUrls?.[0] || "").trim();
    if (u && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
  }
  return urls.slice(0, 6);
}

export function evaluateManhuaAssetImageGate(
  input: ManhuaAssetImageGateInput,
): ManhuaAssetImageGateResult {
  const canonForGate = input.assetCanon;
  const hasCanon = Boolean(canonForGate?.characters?.length);
  const customReady = hasCustomCastAndScene(input.customRefs);
  /**
   * 有剧本表时不能因为「上传过人物+场景」就直接放行：扩写和导入外部剧本都会
   * 加人加景，得按名字逐个点名，否则新角色一路裸奔到成片才发现没锁脸。
   */
  if (customReady && !hasCanon) {
    return {
      castLocked: true,
      sceneLocked: true,
      castImagesReady: true,
      sceneImageReady: true,
      viaCustomUpload: true,
      viaWriterCanon: false,
      ready: true,
      missingCastIds: [],
      missingScene: false,
      hintZh: null,
    };
  }

  const canon = input.assetCanon;
  const viaWriterCanon = Boolean(canon?.characters.length && canon.locations.length);
  const ep = Math.max(1, Math.floor(input.episodeIndex || 1));
  const mainScene = resolveEpisodeMainScene(canon, ep);
  const writerSceneId = mainScene?.id || String(input.sceneId || "").trim();

  const characterIds = (input.characterIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const ancientIds = (input.ancientArchetypeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const sceneId = writerSceneId || String(input.sceneId || "").trim();
  const blocks = input.assetBlocks || [];
  const customChars = customRefsByRole(input.customRefs, "character");
  const customScenes = customRefsByRole(input.customRefs, "scene");

  const writerCastIds = (canon?.characters || []).map((c) => c.id);
  const castIdsForGate = writerCastIds.length
    ? writerCastIds
    : [...characterIds, ...ancientIds];

  const castLocked =
    castIdsForGate.length > 0 || customChars.length > 0;
  const sceneLocked =
    Boolean(mainScene) ||
    Boolean(sceneId && getManhuaSceneTemplate(sceneId)) ||
    customScenes.length > 0;

  const charSheetsWithMediaEarly = blocks.filter(
    (blk) => blk.id.startsWith("charsheet-") && blockHasMedia(blk),
  );
  /**
   * 老项目的定妆节点 id 跟人物表对不上（charsheet-ep1-a 之类），按名字点名会
   * 全判成缺图、逼着重出一遍已经付过钱的设定图。只有当画布上一张都对不上时
   * 才认定是老命名，退回按张数算；只要有一张对得上，就是新命名，逐个点名。
   */
  const legacySheetNaming =
    hasCanon &&
    charSheetsWithMediaEarly.length > 0 &&
    !charSheetsWithMediaEarly.some((blk) =>
      (canonForGate?.characters || []).some((c) => blk.id.includes(c.id)),
    );
  const coverageGaps = hasCanon && !legacySheetNaming
    ? findManhuaAssetCoverageGaps({
        assetCanon: canonForGate,
        customRefs: input.customRefs,
        assetBlocks: blocks.map((blk) => ({ id: blk.id, hasMedia: blockHasMedia(blk) })),
      })
    : [];
  const castGaps = coverageGaps.filter((g) => g.role === "character");
  const sceneGaps = coverageGaps.filter((g) => g.role === "scene");

  const missingCastIds: string[] = [];
  if (hasCanon && !legacySheetNaming) {
    missingCastIds.push(...castGaps.map((g) => g.id));
  } else if (!customChars.length) {
    for (const id of castIdsForGate) {
      const sheet = findAssetBlock(blocks, "charsheet-", id);
      if (!blockHasMedia(sheet)) missingCastIds.push(id);
    }
  }
  const charSheetsWithMedia = blocks.filter(
    (b) => b.id.startsWith("charsheet-") && blockHasMedia(b),
  );
  const sceneSheetsWithMedia = blocks.filter(
    (b) => b.id.startsWith("sceneplate-") && blockHasMedia(b),
  );
  // 画布上定妆张数已够（即便节点 id 与人物表 id 细差）→ 视为角色图已齐
  const canvasSheetsCoverCast =
    castLocked &&
    castIdsForGate.length > 0 &&
    missingCastIds.length > 0 &&
    charSheetsWithMedia.length >= castIdsForGate.length;
  const castImagesReady = hasCanon && !legacySheetNaming
    ? castGaps.length === 0
    : (castLocked && missingCastIds.length === 0) ||
      customChars.length > 0 ||
      canvasSheetsCoverCast;

  const scenePlate = sceneId ? findAssetBlock(blocks, "sceneplate-", sceneId) : undefined;
  const sceneImageReady = hasCanon && !legacySheetNaming
    ? sceneGaps.length === 0
    : customScenes.length > 0 ||
      blockHasMedia(scenePlate) ||
      (sceneLocked && sceneSheetsWithMedia.length > 0);
  const missingScene =
    (Boolean(mainScene) || Boolean(sceneId && getManhuaSceneTemplate(sceneId))) &&
    !customScenes.length &&
    !sceneImageReady;

  const ready = castLocked && sceneLocked && castImagesReady && sceneImageReady;

  let hintZh: string | null = null;
  if (!castLocked && !sceneLocked) {
    hintZh = viaWriterCanon
      ? "请先确认剧本表中的人物与场景，并生成本集设定图"
      : "请上传并勾选人物与场景，或从库内选择角色与场景后再出设定图";
  } else if (!castLocked) {
    hintZh = "请勾选至少一张人物参考，或保证人物表可解析";
  } else if (!sceneLocked) {
    hintZh = "请保证场景表可解析，或勾选场景参考";
  } else if (!castImagesReady && castGaps.length) {
    const names = castGaps.map((g) => g.nameZh).filter(Boolean).slice(0, 4).join("、");
    hintZh = `还有 ${castGaps.length} 位人物没有定妆图${names ? `（${names}）` : ""}，请生成或上传参考`;
  } else if (!sceneImageReady && sceneGaps.length) {
    const names = sceneGaps.map((g) => g.nameZh).filter(Boolean).slice(0, 4).join("、");
    hintZh = `还有 ${sceneGaps.length} 个场景没有设定图${names ? `（${names}）` : ""}，请生成或上传参考`;
  } else if (!castImagesReady) {
    hintZh =
      "打开工作流「资产设定」，点右上角「生成本集角色/场景设定图」（或下方分区上传参考）";
  } else if (!sceneImageReady) {
    hintZh =
      "打开工作流「资产设定」，点右上角「生成本集角色/场景设定图」补主场景空镜（或上传场景参考）";
  }

  return {
    castLocked,
    sceneLocked,
    castImagesReady,
    sceneImageReady,
    viaCustomUpload: false,
    viaWriterCanon,
    ready,
    missingCastIds,
    missingScene,
    hintZh,
  };
}

export type ManhuaAssetImageSpawnPlan = {
  id: string;
  kind: "charsheet" | "sceneplate" | "propsheet";
  prompt: string;
  labelZh: string;
  /**
   * single=旧单张；grid2x2=跨集场景四视角；
   * heroFace=主角大头照（锁脸）；heroLook=主角全身妆造（锁服化）。
   * 主角拆两张是因为官方把人脸与全身拼在一张列为 ID 漂移头号根因。
   */
  layout?: "single" | "grid2x2" | "heroFace" | "heroLook";
};

/** 主角大头照节点 id：仍以 charsheet- 开头，让既有分栏/同步逻辑照旧命中 */
export function manhuaHeroFaceSheetId(seedId: string): string {
  return `charsheet-face-${seedId}`;
}

/** 从设定图节点 id 还原库资产 id（大头照与全身照同源） */
export function seedIdFromManhuaSheetBlockId(blockId: string): string {
  return String(blockId || "")
    .replace(/^charsheet-face-/, "")
    .replace(/^charsheet-/, "")
    .replace(/^sceneplate-/, "")
    .replace(/^propsheet-/, "");
}

/**
 * 一个系列最多出几张单件道具图。
 *
 * 道具表能列十几件（一碗面、一封信都算），全出等于白烧钱；段内绑图本来也只收前 3 件。
 * 留 6 张的余量：够覆盖跨集反复出现的那几件信物，又不至于把额度铺满。
 */
export const MANHUA_PROP_SHEET_MAX = 6;

/**
 * 值得单独出图的道具：得有名字、有可画的外形句。
 * 「一封信」这种没外形描述的出来就是通用素材，锁了反而误导。
 *
 * 导出给左栏共用：占位格与出图计划必须同一把尺，否则会列出点了没反应的死卡。
 */
export function shouldSpawnManhuaPropPlate(prop: ManhuaWriterAssetAnchor): boolean {
  const name = String(prop.nameZh || "").trim();
  if (name.length < 2) return false;
  // lookZh 是道具的生图主锚；一句都没有时画出来就是通用素材，锁了反而误导
  if (String(prop.lookZh || "").trim().length >= 3) return true;
  return String(prop.promptZh || "").trim().length >= 6;
}

/** 缺图时铺设定卡/场景设定图节点（仅预填；是否扣费运行由调用方决定） */
export function planManhuaAssetImageSpawns(
  input: ManhuaAssetImageGateInput,
  opts?: {
    /**
     * 本集设定图墙仍空时强制按剧本/库 ID 出卡。
     * 避免「我的角色/场景」垫图已齐 → gate.ready，却永远 plan=[]、按钮变成「进入分镜」。
     */
    forceEpisodeSheets?: boolean;
  },
): ManhuaAssetImageSpawnPlan[] {
  const gate = evaluateManhuaAssetImageGate(input);
  const forceEpisodeSheets = Boolean(opts?.forceEpisodeSheets);
  if (!forceEpisodeSheets && (gate.viaCustomUpload || gate.ready)) return [];

  const artStyle = getManhuaArtStylePreset(input.artStyleId);
  const topic = String(input.topic || "").trim();
  const plans: ManhuaAssetImageSpawnPlan[] = [];
  const blocks = input.assetBlocks || [];
  const canon = input.assetCanon;
  const ep = Math.max(1, Math.floor(input.episodeIndex || 1));

  // C：主角（男女主级）→ 脸+全身两张；配角 → 单张全身
  const leadIds = resolveManhuaLeadCharacterIds(canon?.characters, input.episodes, {
    explicitLeadIds: input.leadCharacterIds,
  });
  const leadNames = new Set(
    (canon?.characters || [])
      .filter((c) => leadIds.has(c.id))
      .map((c) => c.nameZh),
  );
  const writerCastIds = (canon?.characters || []).map((c) => c.id);
  const castIdsForSheets = writerCastIds.length
    ? writerCastIds
    : [
        ...(input.characterIds || []),
        ...(input.ancientArchetypeIds || []),
      ]
        .map((id) => String(id || "").trim())
        .filter(Boolean);
  const missingCastIds = forceEpisodeSheets
    ? castIdsForSheets.filter((id) => !blockHasMedia(findAssetBlock(blocks, "charsheet-", id)))
    : gate.missingCastIds;

  for (const id of missingCastIds) {
    const existing = findAssetBlock(blocks, "charsheet-", id);
    const fromCanon = canon?.characters.find((c) => c.id === id);
    if (fromCanon) {
      // 编剧误把地点写进人物表时：改出场景空镜，避免「皇宫大殿」进我的角色
      if (
        inferManhuaCustomAssetRole({
          role: "character",
          seedLibraryId: id,
          labelZh: fromCanon.nameZh,
        }) === "scene"
      ) {
        const sceneExisting = findAssetBlock(blocks, "sceneplate-", id);
        if (!blockHasMedia(sceneExisting)) {
          const resolved = resolveManhuaScenePlatePrompt({
            sceneNameZh: fromCanon.nameZh,
            scenePromptZh: fromCanon.lookZh || fromCanon.promptZh || fromCanon.nameZh,
            topic,
            artStyleLabelZh: artStyle.labelZh,
            artStylePromptZh: artStyle.promptZh,
            location: fromCanon,
            episodes: input.episodes,
            buildSingle: buildManhuaScenePlateGenPrompt,
          });
          plans.push({
            id: sceneExisting?.id || `sceneplate-${id}`,
            kind: "sceneplate",
            prompt: resolved.prompt,
            labelZh: fromCanon.nameZh,
            layout: resolved.layout,
          });
        }
        continue;
      }
      const hero = isManhuaHeroCharacterAnchor(fromCanon);
      if (hero) {
        // C：仅主角（男女主级）出脸特写；配角只出单张全身
        if (leadIds.has(id)) {
          // 大头照排在全身照之前：锁脸最吃紧，官方也要求重要素材前置
          plans.push({
            id: manhuaHeroFaceSheetId(id),
            kind: "charsheet",
            prompt: composeManhuaHeroFaceCloseupPrompt({
              nameZh: fromCanon.nameZh,
              aliasZh: fromCanon.aliasZh,
              lookZh: fromCanon.lookZh,
              artStyleLabelZh: artStyle.labelZh,
              artStylePromptZh: artStyle.promptZh,
            }),
            labelZh: fromCanon.nameZh,
            layout: "heroFace",
          });
        }
        plans.push({
          id: existing?.id || `charsheet-${id}`,
          kind: "charsheet",
          prompt: composeManhuaHeroFullBodyLookPrompt({
            nameZh: fromCanon.nameZh,
            aliasZh: fromCanon.aliasZh,
            lookZh: fromCanon.lookZh,
            motiveZh: fromCanon.motiveZh,
            noteZh: fromCanon.noteZh,
            basePromptZh: fromCanon.promptZh,
            artStyleLabelZh: artStyle.labelZh,
            artStylePromptZh: artStyle.promptZh,
            topic,
            props: pickPropsForCharacterSheet(fromCanon, canon?.props),
          }),
          labelZh: fromCanon.nameZh,
          layout: "heroLook",
        });
        continue;
      }
      plans.push({
        id: existing?.id || `charsheet-${id}`,
        kind: "charsheet",
        prompt: composeManhuaWriterCanonSheetPrompt({
          nameZh: fromCanon.nameZh,
          aliasZh: fromCanon.aliasZh,
          lookZh: fromCanon.lookZh,
          motiveZh: fromCanon.motiveZh,
          noteZh: fromCanon.noteZh,
          basePromptZh: fromCanon.promptZh,
          artStyleLabelZh: artStyle.labelZh,
          artStylePromptZh: artStyle.promptZh,
          topic,
        }),
        labelZh: fromCanon.nameZh,
        layout: "single",
      });
      continue;
    }
    const arch = getAncientArchetypeById(id);
    if (arch) {
      const lookZh = stripArchetypeGenderLockZh(
        [
          arch.faceTemperamentZh,
          arch.hairstyleZh,
          arch.wardrobeLayers.join("、"),
          arch.props.join("、"),
        ]
          .filter(Boolean)
          .join("；"),
      );
      const basePromptZh = stripArchetypeGenderLockZh(
        String(arch.promptZh || buildAncientArchetypePrompt(arch))
          .replace(/设定卡/g, "定妆肖像")
          .replace(/姓名条|标题大字|书法题跋/g, ""),
      );
      // 优先本集编剧人物表里与该原型同名/同气质的条目，性别外形跟剧本，不跟库刻板
      const scriptMatch = (canon?.characters || []).find(
        (c) =>
          c.nameZh === arch.nameZh ||
          c.aliasZh === arch.nameZh ||
          String(c.noteZh || "").includes(arch.id) ||
          String(c.lookZh || "").includes(arch.nameZh),
      );
      const sheetName = scriptMatch?.nameZh || arch.nameZh;
      const sheetLook = scriptMatch?.lookZh || lookZh;
      const sheetMotive = scriptMatch?.motiveZh;
      const sheetNote = [
        scriptMatch?.noteZh,
        arch.atmosphereZh,
        "性别与年龄以本集剧本人物表为准；库原型只借服化道与气质，勿因刀客/将军/女帝等名锁定生理性别。",
      ]
        .filter(Boolean)
        .join("；");
      const hero = isManhuaHeroCharacterAnchor({
        nameZh: sheetName,
        lookZh: sheetLook,
        motiveZh: sheetMotive,
        noteZh: sheetNote,
      });
      if (hero) {
        // C：主角（男女主级）才出脸特写；配角单张全身。
        // 无编剧 canon（纯库/原型流）时无主配信号 → 保持旧行为（都出两张）。
        const archIsLead =
          leadIds.size === 0
            ? true
            : (scriptMatch?.id && leadIds.has(scriptMatch.id)) || leadNames.has(sheetName);
        if (archIsLead) {
          plans.push({
            id: manhuaHeroFaceSheetId(id),
            kind: "charsheet",
            prompt: composeManhuaHeroFaceCloseupPrompt({
              nameZh: sheetName,
              aliasZh: scriptMatch?.aliasZh,
              lookZh: sheetLook,
              artStyleLabelZh: artStyle.labelZh,
              artStylePromptZh: artStyle.promptZh,
            }),
            labelZh: sheetName,
            layout: "heroFace",
          });
        }
        plans.push({
          id: existing?.id || `charsheet-${id}`,
          kind: "charsheet",
          prompt: composeManhuaHeroFullBodyLookPrompt({
            nameZh: sheetName,
            aliasZh: scriptMatch?.aliasZh,
            lookZh: sheetLook,
            motiveZh: sheetMotive,
            noteZh: sheetNote,
            basePromptZh: scriptMatch?.promptZh || basePromptZh,
            artStyleLabelZh: artStyle.labelZh,
            artStylePromptZh: artStyle.promptZh,
            topic,
            props: pickPropsForCharacterSheet(
              { nameZh: sheetName, aliasZh: scriptMatch?.aliasZh, lookZh: sheetLook },
              canon?.props,
            ),
          }),
          labelZh: sheetName,
          layout: "heroLook",
        });
        continue;
      }
      plans.push({
        id: existing?.id || `charsheet-${id}`,
        kind: "charsheet",
        prompt: composeManhuaWriterCanonSheetPrompt({
          nameZh: sheetName,
          aliasZh: scriptMatch?.aliasZh,
          lookZh: sheetLook,
          motiveZh: sheetMotive,
          noteZh: sheetNote,
          basePromptZh: scriptMatch?.promptZh || basePromptZh,
          artStyleLabelZh: artStyle.labelZh,
          artStylePromptZh: artStyle.promptZh,
          topic,
        }),
        labelZh: sheetName,
        layout: "single",
      });
      continue;
    }
    const char = getManhuaCharacterById(id);
    const gender = char?.gender === "male" ? "male" : "female";
    const prompt = buildManhuaCharacterSheetGenPrompt({
      characterId: id,
      gender,
      artStyleId: input.artStyleId,
      userHint: topic ? `本集题材：${topic.slice(0, 80)}` : undefined,
    });
    plans.push({
      id: existing?.id || `charsheet-${id}`,
      kind: "charsheet",
      prompt,
      // 禁止把 arch_/char_ 英文 id 直接露给用户
      labelZh: char?.nameZh || "角色定妆",
    });
  }

  const mainForForce = resolveEpisodeMainScene(canon, ep);
  const sceneIdForForce = mainForForce?.id || String(input.sceneId || "").trim();
  const missingScene = forceEpisodeSheets
    ? Boolean(mainForForce || (sceneIdForForce && getManhuaSceneTemplate(sceneIdForForce))) &&
      !blockHasMedia(
        findAssetBlock(blocks, "sceneplate-", mainForForce?.id || sceneIdForForce),
      )
    : gate.missingScene;

  if (missingScene) {
    const main = mainForForce;
    const sceneId = sceneIdForForce;
    if (main) {
      const existing = findAssetBlock(blocks, "sceneplate-", main.id);
      const resolved = resolveManhuaScenePlatePrompt({
        sceneNameZh: main.nameZh,
        scenePromptZh: main.promptZh,
        topic,
        artStyleLabelZh: artStyle.labelZh,
        artStylePromptZh: artStyle.promptZh,
        location: main,
        episodes: input.episodes,
        buildSingle: buildManhuaScenePlateGenPrompt,
      });
      plans.push({
        id: existing?.id || `sceneplate-${main.id}`,
        kind: "sceneplate",
        prompt: resolved.prompt,
        labelZh: main.nameZh,
        layout: resolved.layout,
      });
    } else {
      const scene = getManhuaSceneTemplate(sceneId);
      if (scene) {
        const existing = findAssetBlock(blocks, "sceneplate-", sceneId);
        plans.push({
          id: existing?.id || `sceneplate-${sceneId}`,
          kind: "sceneplate",
          prompt: buildManhuaScenePlateGenPrompt({
            sceneNameZh: scene.nameZh,
            scenePromptZh: scene.promptZh,
            topic,
            artStyleLabelZh: artStyle.labelZh,
            artStylePromptZh: artStyle.promptZh,
          }),
          labelZh: scene.nameZh,
          layout: "single",
        });
      }
    }
  }

  // 跨集场景（非本集主场景）也补四视角参考卡，供视频换角度锁空间
  if (forceEpisodeSheets && canon?.locations?.length && input.episodes?.length) {
    for (const loc of canon.locations) {
      if (plans.some((p) => p.kind === "sceneplate" && p.id.includes(loc.id))) continue;
      const resolved = resolveManhuaScenePlatePrompt({
        sceneNameZh: loc.nameZh,
        scenePromptZh: loc.promptZh,
        topic,
        artStyleLabelZh: artStyle.labelZh,
        artStylePromptZh: artStyle.promptZh,
        location: loc,
        episodes: input.episodes,
        buildSingle: buildManhuaScenePlateGenPrompt,
      });
      if (resolved.layout !== "grid2x2") continue;
      const existing = findAssetBlock(blocks, "sceneplate-", loc.id);
      if (blockHasMedia(existing)) continue;
      plans.push({
        id: existing?.id || `sceneplate-${loc.id}`,
        kind: "sceneplate",
        prompt: resolved.prompt,
        labelZh: loc.nameZh,
        layout: "grid2x2",
      });
    }
  }

  /**
   * 关键道具单件图。
   *
   * 从前道具只并进角色定妆卡的特写格，段内绑图时它没有自己的 URL：要么拿到那张
   * 角色卡（等于和脸共用一张，把锁脸的权重摊薄），要么是 logical:// 占位被过滤，
   * 于是「道具锁定」一直只是文字点名。出独立图才能真进 @Image 对照。
   *
   * 只在补齐设定图这条路上出（forceEpisodeSheets）：道具不进 ready 门禁，
   * 别让缺一件信物卡住整条出片线。
   */
  if (forceEpisodeSheets && canon?.props?.length) {
    const ownerNameById = new Map<string, string>();
    for (const ch of canon.characters || []) {
      for (const p of pickPropsForCharacterSheet(ch, canon.props)) {
        if (!ownerNameById.has(p.id)) ownerNameById.set(p.id, ch.nameZh);
      }
    }
    let spawned = 0;
    for (const prop of canon.props) {
      if (spawned >= MANHUA_PROP_SHEET_MAX) break;
      if (!shouldSpawnManhuaPropPlate(prop)) continue;
      const existing = findAssetBlock(blocks, "propsheet-", prop.id);
      if (blockHasMedia(existing)) continue;
      // 用户自己上传/生成过同名道具时不重复烧
      if (
        customRefsByRole(input.customRefs, "prop").some(
          (r) =>
            String(r.seedLibraryId || "") === prop.id ||
            String(r.labelZh || "").trim() === String(prop.nameZh || "").trim(),
        )
      ) {
        continue;
      }
      spawned += 1;
      plans.push({
        id: existing?.id || `propsheet-${prop.id}`,
        kind: "propsheet",
        prompt: buildManhuaPropPlateGenPrompt({
          propNameZh: prop.nameZh,
          propPromptZh: prop.promptZh || prop.lookZh,
          ownerNameZh: ownerNameById.get(prop.id),
          topic,
          artStyleLabelZh: artStyle.labelZh,
          artStylePromptZh: artStyle.promptZh,
        }),
        labelZh: prop.nameZh,
        layout: "single",
      });
    }
  }

  // 定妆最吃紧排前，场景次之，道具垫后：官方也要求重要素材前置
  const kindRank = { charsheet: 0, sceneplate: 1, propsheet: 2 } as const;
  return plans.sort((a, b) => {
    if (a.kind === b.kind) return a.id.localeCompare(b.id);
    return kindRank[a.kind] - kindRank[b.kind];
  });
}

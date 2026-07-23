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
import { buildManhuaScenePlateGenPrompt } from "./manhuaScriptVisualBrief.js";
import {
  customRefsByRole,
  hasCustomCastAndScene,
  inferManhuaCustomAssetRole,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";
import {
  resolveEpisodeMainScene,
  type ManhuaWriterAssetCanon,
} from "./manhuaWriterAssetCanon.js";
import { composeManhuaWriterCanonSheetPrompt } from "./manhuaDirectorDistill.js";
import {
  composeManhuaHeroCharacterSheetPrompt,
  isManhuaHeroCharacterAnchor,
  pickPropsForCharacterSheet,
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
  const customReady = hasCustomCastAndScene(input.customRefs);
  if (customReady) {
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

  const missingCastIds: string[] = [];
  if (!customChars.length) {
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
  const castImagesReady =
    (castLocked && missingCastIds.length === 0) ||
    customChars.length > 0 ||
    canvasSheetsCoverCast;

  const scenePlate = sceneId ? findAssetBlock(blocks, "sceneplate-", sceneId) : undefined;
  const sceneImageReady =
    customScenes.length > 0 ||
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
  kind: "charsheet" | "sceneplate";
  prompt: string;
  labelZh: string;
  /** single=旧单张；grid2x2=跨集场景四视角；heroSheet=主角设定板 */
  layout?: "single" | "grid2x2" | "heroSheet";
};

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
      const prompt = hero
        ? composeManhuaHeroCharacterSheetPrompt({
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
          })
        : composeManhuaWriterCanonSheetPrompt({
            nameZh: fromCanon.nameZh,
            aliasZh: fromCanon.aliasZh,
            lookZh: fromCanon.lookZh,
            motiveZh: fromCanon.motiveZh,
            noteZh: fromCanon.noteZh,
            basePromptZh: fromCanon.promptZh,
            artStyleLabelZh: artStyle.labelZh,
            artStylePromptZh: artStyle.promptZh,
            topic,
          });
      plans.push({
        id: existing?.id || `charsheet-${id}`,
        kind: "charsheet",
        prompt,
        labelZh: fromCanon.nameZh,
        layout: hero ? "heroSheet" : "single",
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
      const prompt = hero
        ? composeManhuaHeroCharacterSheetPrompt({
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
          })
        : composeManhuaWriterCanonSheetPrompt({
            nameZh: sheetName,
            aliasZh: scriptMatch?.aliasZh,
            lookZh: sheetLook,
            motiveZh: sheetMotive,
            noteZh: sheetNote,
            basePromptZh: scriptMatch?.promptZh || basePromptZh,
            artStyleLabelZh: artStyle.labelZh,
            artStylePromptZh: artStyle.promptZh,
            topic,
          });
      plans.push({
        id: existing?.id || `charsheet-${id}`,
        kind: "charsheet",
        prompt,
        labelZh: sheetName,
        layout: hero ? "heroSheet" : "single",
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

  return plans.sort((a, b) => {
    if (a.kind === b.kind) return a.id.localeCompare(b.id);
    return a.kind === "charsheet" ? -1 : 1;
  });
}

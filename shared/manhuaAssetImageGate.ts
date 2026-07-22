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
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import { buildManhuaScenePlateGenPrompt } from "./manhuaScriptVisualBrief.js";
import {
  customRefsByRole,
  hasCustomCastAndScene,
  type ManhuaCustomAssetRef,
} from "./manhuaCustomAssetRefs.js";
import {
  resolveEpisodeMainScene,
  type ManhuaWriterAssetCanon,
} from "./manhuaWriterAssetCanon.js";
import { composeManhuaWriterCanonSheetPrompt } from "./manhuaDirectorDistill.js";

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
  const castImagesReady =
    (castLocked && missingCastIds.length === 0) || customChars.length > 0;

  const scenePlate = sceneId ? findAssetBlock(blocks, "sceneplate-", sceneId) : undefined;
  const sceneImageReady = customScenes.length > 0 || blockHasMedia(scenePlate);
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
    hintZh = "请先生成本集角色设定卡（以剧本人物表为准；可自传勾选替代）";
  } else if (!sceneImageReady) {
    hintZh = "请先生成本集主场景设定图（系列场景池·本集主场景；可自传勾选替代）";
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
};

/** 缺图时铺设定卡/场景设定图节点（仅预填；是否扣费运行由调用方决定） */
export function planManhuaAssetImageSpawns(
  input: ManhuaAssetImageGateInput,
): ManhuaAssetImageSpawnPlan[] {
  const gate = evaluateManhuaAssetImageGate(input);
  if (gate.viaCustomUpload || gate.ready) return [];

  const artStyle = getManhuaArtStylePreset(input.artStyleId);
  const topic = String(input.topic || "").trim();
  const plans: ManhuaAssetImageSpawnPlan[] = [];
  const blocks = input.assetBlocks || [];
  const canon = input.assetCanon;
  const ep = Math.max(1, Math.floor(input.episodeIndex || 1));

  for (const id of gate.missingCastIds) {
    const existing = findAssetBlock(blocks, "charsheet-", id);
    const fromCanon = canon?.characters.find((c) => c.id === id);
    if (fromCanon) {
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
      labelZh: char?.nameZh || id,
    });
  }

  if (gate.missingScene) {
    const main = resolveEpisodeMainScene(canon, ep);
    const sceneId = main?.id || String(input.sceneId || "").trim();
    if (main) {
      const existing = findAssetBlock(blocks, "sceneplate-", main.id);
      plans.push({
        id: existing?.id || `sceneplate-${main.id}`,
        kind: "sceneplate",
        prompt: buildManhuaScenePlateGenPrompt({
          sceneNameZh: main.nameZh,
          scenePromptZh: main.promptZh,
          topic,
          artStyleLabelZh: artStyle.labelZh,
          artStylePromptZh: artStyle.promptZh,
        }),
        labelZh: main.nameZh,
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
        });
      }
    }
  }

  return plans.sort((a, b) => {
    if (a.kind === b.kind) return a.id.localeCompare(b.id);
    return a.kind === "charsheet" ? -1 : 1;
  });
}

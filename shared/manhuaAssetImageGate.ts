/**
 * 漫剧资产门禁：剧本确认后，须锁定角色+场景，且角色图/场景图齐，才解禁分镜。
 * 库内示意封面可算「有图」；缺封面时须先生成 sceneplate / charsheet 节点。
 */

import { getAncientArchetypePreviewUrl } from "./manhuaAncientDesignBoard.js";
import {
  buildManhuaCharacterSheetGenPrompt,
  getManhuaArtStylePreset,
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  type ManhuaArtStyleId,
} from "./manhuaCharacterAssetLibrary.js";
import {
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "./manhuaScenePropDemoCatalog.js";
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import { buildManhuaScenePlateGenPrompt } from "./manhuaScriptVisualBrief.js";

export type ManhuaAssetImageGateInput = {
  characterIds?: string[];
  ancientArchetypeIds?: string[];
  sceneId?: string | null;
  artStyleId?: ManhuaArtStyleId | string | null;
  topic?: string;
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
  /** 角色+场景已锁定且图齐 → 可进分镜 */
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

export function evaluateManhuaAssetImageGate(
  input: ManhuaAssetImageGateInput,
): ManhuaAssetImageGateResult {
  const characterIds = (input.characterIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const ancientIds = (input.ancientArchetypeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const sceneId = String(input.sceneId || "").trim();
  const artStyleId = input.artStyleId;
  const blocks = input.assetBlocks || [];

  const castLocked = characterIds.length > 0 || ancientIds.length > 0;
  const sceneLocked = Boolean(sceneId && getManhuaSceneTemplate(sceneId));

  const missingCastIds: string[] = [];
  for (const id of characterIds) {
    const preview = getManhuaCharacterPreviewUrl(id, { artStyleId });
    const sheet = findAssetBlock(blocks, "charsheet-", id);
    if (!preview && !blockHasMedia(sheet)) missingCastIds.push(id);
  }
  for (const id of ancientIds) {
    const preview = getAncientArchetypePreviewUrl(id);
    const sheet = findAssetBlock(blocks, "charsheet-", id);
    if (!preview && !blockHasMedia(sheet)) missingCastIds.push(id);
  }
  const castImagesReady = castLocked && missingCastIds.length === 0;

  const demos = listManhuaDemoAssetsForSceneTemplate(sceneId);
  const demoReady = demos.some((d) => Boolean(getManhuaDemoAssetPublicUrl(d.id)));
  const scenePlate = findAssetBlock(blocks, "sceneplate-", sceneId);
  const sceneImageReady = sceneLocked && (demoReady || blockHasMedia(scenePlate));
  const missingScene = sceneLocked && !sceneImageReady;

  const ready = castLocked && sceneLocked && castImagesReady && sceneImageReady;

  let hintZh: string | null = null;
  if (!castLocked && !sceneLocked) hintZh = "请先锁定角色与场景";
  else if (!castLocked) hintZh = "请先锁定角色";
  else if (!sceneLocked) hintZh = "请先锁定场景";
  else if (!castImagesReady) hintZh = "请先出齐角色图（库内示意或设定卡）";
  else if (!sceneImageReady) hintZh = "请先出齐场景图（示意封面或场景设定图）";

  return {
    castLocked,
    sceneLocked,
    castImagesReady,
    sceneImageReady,
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
  const artStyle = getManhuaArtStylePreset(input.artStyleId);
  const topic = String(input.topic || "").trim();
  const plans: ManhuaAssetImageSpawnPlan[] = [];
  const blocks = input.assetBlocks || [];

  for (const id of gate.missingCastIds) {
    const char = getManhuaCharacterById(id);
    const gender = char?.gender === "male" ? "male" : "female";
    const existing = findAssetBlock(blocks, "charsheet-", id);
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
    const sceneId = String(input.sceneId || "").trim();
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

  // 角色图优先，再场景图
  return plans.sort((a, b) => {
    if (a.kind === b.kind) return a.id.localeCompare(b.id);
    return a.kind === "charsheet" ? -1 : 1;
  });
}

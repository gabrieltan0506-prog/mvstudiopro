/**
 * 漫剧工厂：一键铺节点 + 顺序自动跑（故事→角色→节拍→反推→静帧→Seedance）
 * 目标：阿硕级「脚本进、成片出」半自动→全自动闭环（本文件为编排核）。
 */

import {
  collectDocumentAssets,
  collectUpstreamTexts,
  collectVisionImages,
  defaultCanvasBlock,
  makeCanvasBlockId,
  resolveNearestUpstreamImageUrl,
  type CanvasBlock,
  type CanvasEdge,
} from "./canvasTypes";
import { loadCanvasDocumentTexts } from "./canvasDocumentText";
import { reviewManhuaClipQuality } from "./manhuaClipQuality";
import {
  isManhuaClipQualityInfraFailure,
  isManhuaClipQualityKeyartTextFailure,
} from "@shared/manhuaClipQuality";
import { runCanvasBlock, type CanvasRunDeps } from "./canvasRunBlock";
import { mapWithConcurrency } from "./canvasUpload";
import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "@shared/videoReversePrompt";
import {
  buildManhuaStagePromptWithGenre,
  composeGenreTemplatePromptBlock,
  getScreenwriterGenreTemplate,
  recommendManhuaSceneIdFromTopic,
  resolveManhuaGenreId,
} from "@shared/screenwriterGenreTemplates";
import {
  composeManhuaScenePromptBlock,
  getManhuaSceneTemplate,
} from "@shared/manhuaSceneAssetLibrary";
import {
  composeManhuaSceneDemoAnchorBlock,
  composeManhuaSelectedPropAnchorBlock,
} from "@shared/manhuaScenePropDemoCatalog";
import { CANVAS_DIRECTOR_CRAFT_PROMPT_BLOCK } from "@shared/manhuaWriterRoom";
import {
  buildManhuaCharacterPromptBlock,
  getManhuaArtStylePreset,
  type ManhuaArtStyleId,
} from "@shared/manhuaCharacterAssetLibrary";
import { buildAncientArchetypePromptBlock } from "@shared/manhuaAncientArchetypeLibrary";
import { buildMotionPromptInjectBlock } from "@shared/motionPromptBank";
import { buildCraftShotInjectBlock, recommendCraftShotFromTopic } from "@shared/craftShotBank";
import {
  buildPathCameraInjectBlock,
  recommendPathCameraFromTopic,
} from "@shared/manhuaPathCameraRecipeBank";
import { buildNarrativeLightingInjectBlock } from "@shared/manhuaNarrativeLightingBank";
import { buildMaleHairstyleInjectBlock } from "@shared/manhuaMaleHairstylePresetBank";
import { buildMaleMicroExpressionInjectBlock } from "@shared/manhuaMaleMicroExpressionBank";
import {
  buildPromoCoverInjectBlock,
  buildPromoCoverPrompt,
  getPromoCoverLayoutById,
} from "@shared/manhuaPromoCoverLayouts";
import {
  buildActionCameraInjectBlock,
  recommendActionCameraFromTopic,
} from "@shared/manhuaActionCameraRecipeBank";
import { formatCineVocabInjectBlock } from "@shared/manhuaCineVocabBank";
import {
  buildManhuaCameraMoveInjectBlock,
  MANHUA_CAMERA_MOVE_ORDER,
} from "@shared/manhuaCameraMoveBank";
import { composeManhuaNarrativeEngineBlock } from "@shared/manhuaNarrativeEnginePrompt";
import { buildWardrobePropContinuityInjectBlock } from "@shared/manhuaWardrobePropContinuity";
import {
  buildManhuaPreviouslyOnRecap,
  buildManhuaRecapCardImagePrompt,
  shouldAttachManhuaPreviouslyOn,
} from "@shared/manhuaEpisodeRecap";
import {
  formatWorkbenchClipInjectBlock,
  formatWorkbenchShotInjectBlock,
  MANHUA_KEYART_NO_TEXT_LOCK,
  MANHUA_SHOT_KEYART_MAX,
  parseWorkbenchShotsFromText,
  resolveKeyartShotIndex,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";
import { applyShotAnglesFromText } from "@shared/manhuaShotAnglePersist";
import {
  planManhuaKeyartEditFusion,
  type ManhuaKeyartEditPlan,
} from "@shared/manhuaKeyartEditFusion";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

function applyKeyartEditPlanToBlock(
  block: CanvasBlock,
  plan: ManhuaKeyartEditPlan,
): CanvasBlock {
  let prompt = stripMarkedSection(block.prompt, "【静帧·示范图融图】");
  prompt = stripMarkedSection(prompt, "【静帧·用户参考融图】");
  prompt = [prompt, plan.editPromptAddonZh].filter(Boolean).join("\n\n");
  if (plan.canEdit && plan.refImageUrl) {
    return {
      ...block,
      prompt,
      imageModel: "gpt-image-2",
      imageMode: "edit",
      refImageUrl: plan.refImageUrl,
      editFusionUrls: plan.editFusionUrls,
    };
  }
  return {
    ...block,
    prompt,
    imageMode: "generate",
    refImageUrl: undefined,
    editFusionUrls: [],
  };
}

export type DramaStudioSpawn = {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  /** 实际套用的剧种（含题材自动推断） */
  resolvedGenreId?: string;
  genreInferred?: boolean;
  /** 实际套用的单一推荐场景（手选优先） */
  resolvedSceneId?: string;
  /** 手选角色库 id（女主/男主） */
  characterIds?: string[];
  /** 手选古风原型 arch_* */
  ancientArchetypeIds?: string[];
};

/** 漫剧工厂固定阶段顺序（与 spawn id 前缀对齐；recap_card 仅第3集起存在） */
export const MANHUA_FACTORY_STAGE_ORDER = [
  "recap_card",
  "story",
  "bible",
  "beats",
  "reverse",
  "keyart",
  "clip",
  "omni_edit",
] as const;

export type ManhuaFactoryStageKey = (typeof MANHUA_FACTORY_STAGE_ORDER)[number];

export const MANHUA_FACTORY_STAGE_LABEL_ZH: Record<ManhuaFactoryStageKey, string> = {
  recap_card: "前情提要片头",
  story: "故事大纲",
  bible: "角色卡",
  beats: "镜头节拍",
  reverse: "编导分镜/反推",
  keyart: "关键静帧",
  clip: "微动成片",
  omni_edit: "视频改写",
};

/** 批量静帧并发：过大易打爆上游；过小体感仍串行 */
export const MANHUA_KEYART_PARALLEL_CONCURRENCY = 3;

/** 批量并行时不能硬吃上一镜底图，用软一致性提示代替镜间接力 */
const MANHUA_KEYART_BATCH_SOFT_CONTINUITY_ZH =
  "【同集静帧一致性】与同集其他分镜保持人物身份、服装、场景材质与光色一致，只改本镜动作与构图差异。";

export type SpawnManhuaDramaStudioOpts = {
  originX?: number;
  originY?: number;
  /** 用户题材一句，会写入故事节点 prompt */
  topic?: string;
  /** 编剧剧种：仙侠/古风/都市/校园/末日/科幻/悬疑 */
  genreId?: string;
  /** 单选场景资产 id：scene_01…scene_20（可选，优先于剧种默认场景包） */
  sceneId?: string;
  /** 资产墙点选的道具示范 id（注入圣经/节拍/静帧） */
  propIds?: string[];
  /** 角色库 id：char_f_* / char_m_*（可多选，注入角色卡） */
  characterIds?: string[];
  /** 古风原型 arch_*（与都市槽并行注入） */
  ancientArchetypeIds?: string[];
  /** 用户上传/基于库参考生成的参考图（勾选角色后进静帧融图） */
  customRefs?: ManhuaCustomAssetRef[];
  /** 剧本跟随身份锁（时代/族裔/服饰；来自 CastBundle） */
  identityLockZh?: string;
  /** 角色/场景统一画风：仿真人 / CG 漫剧 */
  artStyleId?: ManhuaArtStyleId | string;
  /** 包装动效库 id：注入微动成片 / 视频改写节点 */
  motionPromptIds?: string[];
  /** 拍摄手法条目 id：注入节拍 / 反推 / 静帧 */
  craftShotIds?: string[];
  /** 路径运镜配方 id：注入节拍/反推/成片，并写入 clip.pathCameraRecipeId */
  pathCameraRecipeIds?: string[];
  /** 静帧路径标注 JSON：写入 clip.pathAnnotationJson，I2V 优先 */
  pathAnnotationJson?: unknown;
  /** 叙事灯光 id：注入节拍 / 反推 / 静帧 */
  narrativeLightingIds?: string[];
  /** 男发预设 id：注入角色圣经 */
  maleHairstyleIds?: string[];
  /** 男生微表情 id：注入节拍 / 静帧 */
  maleMicroExpressionIds?: string[];
  /** 宣发封面构图 id：额外铺 promo_cover 图片节点 */
  promoCoverLayoutIds?: string[];
  /** 动作运镜配方（FPV / 打斗轨迹 / 双轨） */
  actionCameraRecipeIds?: string[];
  /** 电影级可拍词表 id */
  cineVocabIds?: string[];
  /** 服装道具连续性卡片 id */
  wardrobePropContinuityIds?: string[];
  /** 编导反推输出档 */
  videoReverseOutputMode?: "zh" | "en" | "compact";
  /** 编剧室已确认上下文（人物/道具/场景/本集+钩子） */
  writerContext?: string;
  /** 进入编导后为节拍/反推/静帧注入手法约束 */
  includeDirectorCraft?: boolean;
  /** 连载集号；有值时 id 带 eXX，并写入 block.episodeIndex */
  episodeIndex?: number;
  /** 本集标题 */
  episodeTitle?: string;
  /** 上集片尾钩子（写入本集 story） */
  previousEndingHook?: string;
  /** 本集片尾钩子（写入 story 顶部注释） */
  endingHook?: string;
  /**
   * 前情提要全文（方案 B：第3集起）。
   * 写入 story 片头，并额外铺 `recap_card` 静帧节点。
   */
  previouslyOnRecap?: string;
  /** 系列标题（前情提要静帧卡用） */
  seriesTitle?: string;
};

/** 同屏最多铺几条六段链（避积分爆） */
export const MANHUA_SERIES_SPAWN_MAX = 4;

export type ManhuaSeriesEpisodeInput = {
  index: number;
  title: string;
  endHook: string;
  body?: string;
};

export type SpawnManhuaDramaStudioSeriesOpts = Omit<
  SpawnManhuaDramaStudioOpts,
  | "episodeIndex"
  | "episodeTitle"
  | "previousEndingHook"
  | "endingHook"
  | "writerContext"
  | "previouslyOnRecap"
> & {
  episodes: ManhuaSeriesEpisodeInput[];
  /** 默认 MANHUA_SERIES_SPAWN_MAX */
  maxEpisodes?: number;
  /** 行间距，默认 420 */
  rowGap?: number;
  /** 按集生成编剧上下文（不含上集钩子；钩子由 spawn 追加） */
  writerContextForEpisode?: (episode: ManhuaSeriesEpisodeInput) => string;
};

/** 从 id 解析集号：story-e02-… → 2 */
export function parseEpisodeIndexFromBlockId(blockId: string): number | null {
  const m = String(blockId || "").match(/^[a-z_]+-e(\d{2})-/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function getBlockEpisodeIndex(block: Pick<CanvasBlock, "id" | "episodeIndex">): number | null {
  if (typeof block.episodeIndex === "number" && block.episodeIndex >= 1) {
    return Math.floor(block.episodeIndex);
  }
  return parseEpisodeIndexFromBlockId(block.id);
}

export function filterBlocksByEpisode(blocks: CanvasBlock[], episodeIndex: number): CanvasBlock[] {
  return blocks.filter((b) => {
    const ep = getBlockEpisodeIndex(b);
    if (ep == null) return episodeIndex === 1;
    return ep === episodeIndex;
  });
}

/** 某集是否已有故事→角色→节拍三段（工厂链就绪判定） */
export function manhuaEpisodeHasFactoryChain(blocks: CanvasBlock[], episodeIndex: number): boolean {
  const scoped = filterBlocksByEpisode(blocks, episodeIndex);
  return ["story", "bible", "beats"].every((s) => scoped.some((b) => b.id.startsWith(`${s}-`)));
}

/** 工厂阶段节点是否属于某集（无集号戳的旧链视为第 1 集） */
export function blockBelongsToManhuaEpisode(block: CanvasBlock, episodeIndex: number): boolean {
  const ep = getBlockEpisodeIndex(block);
  if (ep != null) return ep === episodeIndex;
  return episodeIndex === 1 && Boolean(stageKeyFromBlockId(block.id));
}

/**
 * 单集铺板/确认进编导用：从上集取钩子，第 3 集起拼前情提要（与 series spawn 同口径）。
 */
export function resolveManhuaEpisodeSpawnContinuity(
  episodes: ManhuaSeriesEpisodeInput[],
  episodeIndex: number,
): {
  episodeIndex: number;
  episodeTitle?: string;
  endingHook?: string;
  previousEndingHook?: string;
  previouslyOnRecap?: string;
} {
  const sorted = [...(episodes || [])]
    .filter((e) => e && Number.isFinite(e.index) && e.index >= 1)
    .sort((a, b) => a.index - b.index);
  const target = Math.max(1, Math.floor(episodeIndex));
  const ep = sorted.find((e) => e.index === target) || sorted[0];
  if (!ep) {
    return { episodeIndex: target };
  }
  const idx = sorted.findIndex((e) => e.index === ep.index);
  const prev = idx > 0 ? sorted[idx - 1] : undefined;
  const priorForRecap = sorted.slice(0, Math.max(0, idx)).map((e) => ({
    index: e.index,
    title: e.title,
    body: String(e.body || "").trim(),
    endHook: String(e.endHook || "").trim(),
  }));
  const previouslyOnRecap =
    shouldAttachManhuaPreviouslyOn(ep.index) && priorForRecap.length
      ? buildManhuaPreviouslyOnRecap(priorForRecap)
      : undefined;
  return {
    episodeIndex: ep.index,
    episodeTitle: ep.title,
    endingHook: String(ep.endHook || "").trim() || undefined,
    previousEndingHook: String(prev?.endHook || "").trim() || undefined,
    previouslyOnRecap: previouslyOnRecap || undefined,
  };
}

/** 只替换指定集的工厂链，保留画布上其他集的节点与边 */
export function replaceManhuaEpisodeChain(
  existingBlocks: CanvasBlock[],
  existingEdges: CanvasEdge[],
  spawned: DramaStudioSpawn,
  episodeIndex: number,
): DramaStudioSpawn {
  const ep = Math.max(1, Math.floor(episodeIndex));
  const removedIds = new Set(
    existingBlocks.filter((b) => blockBelongsToManhuaEpisode(b, ep)).map((b) => b.id),
  );
  const keepBlocks = existingBlocks.filter((b) => !removedIds.has(b.id));
  const keepEdges = existingEdges.filter((e) => !removedIds.has(e.fromId) && !removedIds.has(e.toId));
  return {
    blocks: [...keepBlocks, ...spawned.blocks],
    edges: [...keepEdges, ...spawned.edges],
    resolvedGenreId: spawned.resolvedGenreId,
    genreInferred: spawned.genreInferred,
    resolvedSceneId: spawned.resolvedSceneId,
    characterIds: spawned.characterIds,
  };
}

function makeFactoryStageId(stage: string, episodeIndex?: number): string {
  if (typeof episodeIndex === "number" && episodeIndex >= 1) {
    const ep = String(Math.floor(episodeIndex)).padStart(2, "0");
    return makeCanvasBlockId(`${stage}-e${ep}`);
  }
  return makeCanvasBlockId(stage);
}

function stampEpisodeMeta(
  block: CanvasBlock,
  episodeIndex?: number,
  episodeTitle?: string,
): CanvasBlock {
  if (typeof episodeIndex !== "number" || episodeIndex < 1) return block;
  return {
    ...block,
    episodeIndex: Math.floor(episodeIndex),
    episodeTitle: episodeTitle?.trim() ? episodeTitle.trim().slice(0, 120) : undefined,
  };
}

function withTopic(basePrompt: string, topic?: string): string {
  const t = String(topic || "").trim();
  if (!t) return basePrompt;
  return `${basePrompt}\n\n【用户题材硬约束】${t.slice(0, 800)}\n必须围绕该题材展开，禁止跑题。`;
}

export function spawnManhuaDramaStudio(opts: SpawnManhuaDramaStudioOpts = {}): DramaStudioSpawn {
  const originX = opts.originX ?? 80;
  const originY = opts.originY ?? 80;
  const gapX = 460;
  const resolved = resolveManhuaGenreId({ genreId: opts.genreId, topic: opts.topic });
  const genreId = resolved.genreId;
  const sceneId =
    String(opts.sceneId || "").trim() ||
    recommendManhuaSceneIdFromTopic({ genreId, topic: opts.topic }).sceneId ||
    undefined;
  const writerContext = String(opts.writerContext || "").trim();
  const ancientArchetypeIds = (opts.ancientArchetypeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, 2);
  // 已挂古风原型时丢弃都市 char_*，防止西装定妆污染 keyart
  const characterIds = ancientArchetypeIds.length
    ? []
    : (opts.characterIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const identityLockZh = String(opts.identityLockZh || "").trim() || undefined;
  const characterBlock = buildManhuaCharacterPromptBlock(characterIds, {
    artStyleId: opts.artStyleId,
    identityLockZh,
  });
  const ancientBlock = buildAncientArchetypePromptBlock(ancientArchetypeIds, { identityLockZh });
  const propIds = (opts.propIds || []).map((id) => String(id || "").trim()).filter(Boolean).slice(0, 4);
  const propAnchorBlock = composeManhuaSelectedPropAnchorBlock(propIds);
  const motionPromptIds = (opts.motionPromptIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const motionBlock = buildMotionPromptInjectBlock(motionPromptIds);
  let craftShotIds = (opts.craftShotIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!craftShotIds.length) {
    const autoCraft = recommendCraftShotFromTopic(opts.topic).craftShotId;
    if (autoCraft) craftShotIds = [autoCraft];
  }
  const craftShotBlock = buildCraftShotInjectBlock(craftShotIds);
  const craftTopicBlob = [opts.topic, opts.writerContext].filter(Boolean).join("\n");
  let pathCameraRecipeIds = (opts.pathCameraRecipeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (!pathCameraRecipeIds.length) {
    const autoPath = recommendPathCameraFromTopic(craftTopicBlob).recipeId;
    if (autoPath) pathCameraRecipeIds = [autoPath];
  }
  const pathCameraBlock = buildPathCameraInjectBlock(pathCameraRecipeIds);
  const narrativeLightingBlock = buildNarrativeLightingInjectBlock(
    (opts.narrativeLightingIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  const maleHairstyleBlock = buildMaleHairstyleInjectBlock(
    (opts.maleHairstyleIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  const maleMicroBlock = buildMaleMicroExpressionInjectBlock(
    (opts.maleMicroExpressionIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  const promoCoverIds = (opts.promoCoverLayoutIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const promoCoverBlock = buildPromoCoverInjectBlock(promoCoverIds);
  let actionCameraRecipeIds = (opts.actionCameraRecipeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (!actionCameraRecipeIds.length) {
    const autoAction = recommendActionCameraFromTopic(craftTopicBlob).recipeId;
    if (autoAction) actionCameraRecipeIds = [autoAction];
  }
  const actionCameraBlock = buildActionCameraInjectBlock(actionCameraRecipeIds);
  const cineVocabBlock = formatCineVocabInjectBlock(
    (opts.cineVocabIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  /** 节拍/反推默认注入高频运镜样本（过肩/特写/细节/跟随/手持/低角），避免空运镜 */
  const cameraMoveSampleBlock = buildManhuaCameraMoveInjectBlock(
    [
      "cam_09_ots",
      "cam_13_closeup",
      "cam_14_detail",
      "cam_07_follow",
      "cam_04_handheld",
      "cam_01_low_angle",
    ].filter((id) => MANHUA_CAMERA_MOVE_ORDER.includes(id as (typeof MANHUA_CAMERA_MOVE_ORDER)[number])),
    { limit: 6, title: "【运镜词库·选用】" },
  );
  const narrativeEngineBlock = composeManhuaNarrativeEngineBlock({
    includeClipPreflight: false,
  });
  const clipPreflightBlock = composeManhuaNarrativeEngineBlock({
    includePlotEngine: false,
    includeHook3s: true,
    includeInfoIncrement: false,
    includeSceneFields: false,
    includeVisibleAction: true,
    includeShortArc: false,
    includeClipPreflight: true,
  });
  const wardrobeBlock = buildWardrobePropContinuityInjectBlock(
    (opts.wardrobePropContinuityIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  const includeDirectorCraft = Boolean(opts.includeDirectorCraft || writerContext);
  const episodeIndex =
    typeof opts.episodeIndex === "number" && opts.episodeIndex >= 1
      ? Math.floor(opts.episodeIndex)
      : undefined;
  const episodeTitle = String(opts.episodeTitle || "").trim().slice(0, 120) || undefined;
  const previousEndingHook = String(opts.previousEndingHook || "").trim();
  const endingHook = String(opts.endingHook || "").trim();
  const previouslyOnRecap = String(opts.previouslyOnRecap || "").trim();
  const seriesTitle = String(opts.seriesTitle || "").trim().slice(0, 80);
  const stageOpts = {
    genreId,
    sceneId,
    topic: opts.topic,
    writerContext: writerContext || undefined,
    includeDirectorCraft,
    directorCraftBlock: includeDirectorCraft ? CANVAS_DIRECTOR_CRAFT_PROMPT_BLOCK : undefined,
  };
  const usePack = Boolean(
    genreId || sceneId || writerContext || characterBlock || ancientBlock || craftShotBlock,
  );
  const artStyle = getManhuaArtStylePreset(opts.artStyleId);
  const artStyleBlock = `【画风硬锁】${artStyle.labelZh}\n${artStyle.promptZh}`;
  const hasRecapCard = Boolean(previouslyOnRecap);
  const col0 = hasRecapCard ? 1 : 0;

  let recapCard: CanvasBlock | null = null;
  if (hasRecapCard && episodeIndex != null) {
    recapCard = defaultCanvasBlock("image", originX, originY);
    recapCard.id = makeFactoryStageId("recap_card", episodeIndex);
    recapCard.prompt = buildManhuaRecapCardImagePrompt({
      episodeIndex,
      seriesTitle: seriesTitle || opts.topic,
      recapText: previouslyOnRecap,
      artStyleBlock,
    });
    recapCard.width = 360;
    recapCard.height = 320;
    recapCard.imageModel = "gpt-image-2";
    recapCard.aspectRatio = "9:16";
  }

  const story = defaultCanvasBlock("text", originX + gapX * col0, originY);
  story.id = makeFactoryStageId("story", episodeIndex);
  let storyPrompt = usePack
    ? buildManhuaStagePromptWithGenre("story_brief", stageOpts)
    : withTopic(MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief, opts.topic);
  const episodeHeader = [
    episodeIndex != null
      ? `【第${episodeIndex}集${episodeTitle ? `·${episodeTitle}` : ""}】`
      : "",
    previouslyOnRecap || "",
    endingHook ? `片尾钩子（本集）：${endingHook}` : "",
    previousEndingHook ? `【上集钩子】${previousEndingHook}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (episodeHeader) {
    storyPrompt = `${episodeHeader}\n\n${storyPrompt}`;
  }
  story.prompt = [storyPrompt, narrativeEngineBlock].filter(Boolean).join("\n\n");
  story.width = 400;
  story.height = 320;
  story.textModel = "gpt-5.6-sol";
  // 故意不把 story.parentId / edge 接到 recap_card：提要文案已写入 story prompt，
  // 若挂上游会污染 text vision 与 keyart 的最近参考图。

  const bible = defaultCanvasBlock("text", originX + gapX * (col0 + 1), originY);
  bible.id = makeFactoryStageId("bible", episodeIndex);
  const bibleBase = usePack
    ? buildManhuaStagePromptWithGenre("character_bible", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.character_bible;
  bible.prompt = [
    bibleBase,
    characterBlock,
    ancientBlock,
    maleHairstyleBlock,
    wardrobeBlock,
    propAnchorBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  bible.parentId = story.id;
  bible.textModel = "gpt-5.6-sol";

  const beats = defaultCanvasBlock("text", originX + gapX * (col0 + 2), originY);
  beats.id = makeFactoryStageId("beats", episodeIndex);
  const beatsBase = usePack
    ? buildManhuaStagePromptWithGenre("episode_beats", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats;
  beats.prompt = [
    beatsBase,
    narrativeEngineBlock,
    cameraMoveSampleBlock,
    craftShotBlock,
    pathCameraBlock,
    actionCameraBlock,
    cineVocabBlock,
    narrativeLightingBlock,
    maleMicroBlock,
    propAnchorBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  beats.parentId = bible.id;
  beats.textModel = "gpt-5.6-sol";

  const reverse = defaultCanvasBlock("video_reverse", originX + gapX * (col0 + 3), originY);
  reverse.id = makeFactoryStageId("reverse", episodeIndex);
  const reverseBase = usePack
    ? buildManhuaStagePromptWithGenre("video_reverse", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.video_reverse;
  reverse.prompt = [
    reverseBase,
    narrativeEngineBlock,
    cameraMoveSampleBlock,
    craftShotBlock,
    pathCameraBlock,
    actionCameraBlock,
    cineVocabBlock,
    narrativeLightingBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  reverse.parentId = beats.id;
  reverse.height = 380;
  reverse.videoReverseOutputMode =
    opts.videoReverseOutputMode === "en" || opts.videoReverseOutputMode === "compact"
      ? opts.videoReverseOutputMode
      : "zh";

  const keyArt = defaultCanvasBlock("image", originX + gapX * (col0 + 4), originY);
  keyArt.id = makeFactoryStageId("keyart", episodeIndex);
  const keyArtBase = usePack
    ? buildManhuaStagePromptWithGenre("key_art", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.key_art;
  const sceneDemoAtSpawn = composeManhuaSceneDemoAnchorBlock(sceneId);
  // 静帧必须确定性带上角色/服装/道具/场景示范，不能只靠 bible 跑完再 enrich
  keyArt.prompt = [
    keyArtBase,
    characterBlock,
    ancientBlock,
    wardrobeBlock,
    craftShotBlock,
    narrativeLightingBlock,
    maleMicroBlock,
    artStyleBlock,
    sceneDemoAtSpawn,
    propAnchorBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  keyArt.parentId = reverse.id;
  /** 成片底图默认 Image-2；有示范图则 edit/融图套场景道具 */
  keyArt.imageModel = "gpt-image-2";
  keyArt.aspectRatio = "9:16";
  const keyartEditPlan = planManhuaKeyartEditFusion({
    characterIds,
    ancientArchetypeIds,
    artStyleId: opts.artStyleId,
    sceneId,
    propIds,
    customRefs: opts.customRefs,
  });
  Object.assign(keyArt, applyKeyartEditPlanToBlock(keyArt, keyartEditPlan));

  const clip = defaultCanvasBlock("video", originX + gapX * (col0 + 5), originY);
  clip.id = makeFactoryStageId("clip", episodeIndex);
  clip.prompt = [
    MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip,
    clipPreflightBlock,
    cameraMoveSampleBlock,
    pathCameraBlock,
    actionCameraBlock,
    motionBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  clip.parentId = keyArt.id;
  /** 工厂主成片走 Gemini Omni（静帧 I2V）；omni_edit 为可选自然语言改写 */
  clip.videoModel = "gemini-omni-flash";
  clip.aspectRatio = "9:16";
  if (pathCameraRecipeIds[0]) clip.pathCameraRecipeId = pathCameraRecipeIds[0];
  if (opts.pathAnnotationJson != null) clip.pathAnnotationJson = opts.pathAnnotationJson;

  /** Gemini Omni · 自然语言视频改写（GEMINI_API_KEY；可续 previous_interaction_id） */
  const omniEdit = defaultCanvasBlock("video", originX + gapX * (col0 + 6), originY);
  omniEdit.id = makeFactoryStageId("omni_edit", episodeIndex);
  const omniBase =
    "在保留角色身份与主构图的前提下，按自然语言改写上一镜视频：加强微表情与运镜层次，不要重拍成无关场景。";
  omniEdit.prompt = [omniBase, pathCameraBlock, actionCameraBlock, motionBlock]
    .filter(Boolean)
    .join("\n\n");
  omniEdit.parentId = clip.id;
  omniEdit.videoModel = "gemini-omni-flash";
  omniEdit.aspectRatio = "9:16";

  let promoCover: CanvasBlock | null = null;
  const promoLayout = promoCoverIds[0] ? getPromoCoverLayoutById(promoCoverIds[0]) : null;
  if (promoLayout) {
    promoCover = defaultCanvasBlock("image", originX + gapX * (col0 + 7), originY);
    promoCover.id = makeFactoryStageId("promo_cover", episodeIndex);
    promoCover.prompt = [
      buildPromoCoverPrompt(promoLayout, {
        subjectZh: opts.topic || "主角",
        sceneZh: getManhuaSceneTemplate(sceneId)?.nameZh,
      }),
      promoCoverBlock,
      artStyleBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
    promoCover.parentId = keyArt.id;
    promoCover.imageModel = "gpt-image-2";
    promoCover.aspectRatio = "9:16";
  }

  const rawBlocks = [
    recapCard,
    story,
    bible,
    beats,
    reverse,
    keyArt,
    clip,
    omniEdit,
    promoCover,
  ].filter(Boolean) as CanvasBlock[];
  const blocks = rawBlocks.map((b) => stampEpisodeMeta(b, episodeIndex, episodeTitle));
  const edges: CanvasEdge[] = [
    { fromId: story.id, toId: bible.id },
    { fromId: bible.id, toId: beats.id },
    { fromId: beats.id, toId: reverse.id },
    { fromId: reverse.id, toId: keyArt.id },
    { fromId: keyArt.id, toId: clip.id },
    { fromId: clip.id, toId: omniEdit.id },
  ];
  if (promoCover) edges.push({ fromId: keyArt.id, toId: promoCover.id });

  return {
    blocks,
    edges,
    resolvedGenreId: genreId,
    genreInferred: resolved.inferred,
    resolvedSceneId: sceneId,
    characterIds,
    ancientArchetypeIds,
  };
}

/**
 * 按集铺多条链（纵向错开）。默认最多 4 集；
 * 第 2+ 集 story 注入上集钩子；第 3+ 集附加前情提要片头（文案 + recap_card 静帧）。
 */
export function spawnManhuaDramaStudioSeries(opts: SpawnManhuaDramaStudioSeriesOpts): DramaStudioSpawn & {
  episodeCount: number;
  episodeIndexes: number[];
} {
  const maxEpisodes = Math.max(
    1,
    Math.min(MANHUA_SERIES_SPAWN_MAX, Math.floor(opts.maxEpisodes ?? MANHUA_SERIES_SPAWN_MAX)),
  );
  const rowGap = Math.max(280, Math.floor(opts.rowGap ?? 420));
  const originX = opts.originX ?? 80;
  const originY = opts.originY ?? 80;
  const episodes = [...(opts.episodes || [])]
    .filter((e) => e && Number.isFinite(e.index) && e.index >= 1)
    .sort((a, b) => a.index - b.index)
    .slice(0, maxEpisodes);

  const blocks: CanvasBlock[] = [];
  const edges: CanvasEdge[] = [];
  const episodeIndexes: number[] = [];
  let resolvedGenreId: string | undefined;
  let genreInferred = false;
  let resolvedSceneId: string | undefined;
  let characterIds: string[] | undefined;

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!;
    const writerContext = String(opts.writerContextForEpisode?.(ep) || "").trim();
    const continuity = resolveManhuaEpisodeSpawnContinuity(episodes, ep.index);
    const spawned = spawnManhuaDramaStudio({
      ...opts,
      originX,
      originY: originY + i * rowGap,
      episodeIndex: continuity.episodeIndex,
      episodeTitle: continuity.episodeTitle,
      endingHook: continuity.endingHook,
      previousEndingHook: continuity.previousEndingHook,
      previouslyOnRecap: continuity.previouslyOnRecap,
      seriesTitle: opts.seriesTitle || opts.topic,
      writerContext: writerContext || undefined,
      includeDirectorCraft: opts.includeDirectorCraft ?? Boolean(writerContext),
    });
    blocks.push(...spawned.blocks);
    edges.push(...spawned.edges);
    episodeIndexes.push(ep.index);
    if (!resolvedGenreId && spawned.resolvedGenreId) resolvedGenreId = spawned.resolvedGenreId;
    if (spawned.genreInferred) genreInferred = true;
    if (!resolvedSceneId && spawned.resolvedSceneId) resolvedSceneId = spawned.resolvedSceneId;
    if (!characterIds && spawned.characterIds?.length) characterIds = spawned.characterIds;
  }

  return {
    blocks,
    edges,
    episodeCount: episodes.length,
    episodeIndexes,
    resolvedGenreId,
    genreInferred,
    resolvedSceneId,
    characterIds,
  };
}

/** 把用户题材注入已存在的故事节点（幂等） */
export function applyTopicToFactoryStory(blocks: CanvasBlock[], topic: string): CanvasBlock[] {
  const t = String(topic || "").trim();
  if (!t) return blocks;
  return blocks.map((b) => {
    if (!b.id.startsWith("story-")) return b;
    if (b.prompt.includes("【用户题材硬约束】")) {
      return {
        ...b,
        prompt: b.prompt.replace(/【用户题材硬约束】[\s\S]*?(?=\n【|$)/, `【用户题材硬约束】${t.slice(0, 800)}\n`),
      };
    }
    return { ...b, prompt: withTopic(b.prompt, t) };
  });
}

function stripInjectBlock(prompt: string, marker: string): string {
  const p = String(prompt || "");
  const idx = p.indexOf(marker);
  if (idx < 0) return p.trim();
  return p.slice(0, idx).trim();
}

/** 去掉 marker 起至下一「【」段（或文末），保留后续注入块 */
function stripMarkedSection(prompt: string, marker: string): string {
  const p = String(prompt || "");
  const idx = p.indexOf(marker);
  if (idx < 0) return p.trim();
  const after = p.slice(idx);
  const nextRel = after.slice(marker.length).search(/\n【/);
  if (nextRel < 0) return p.slice(0, idx).trim();
  const cutEnd = idx + marker.length + nextRel;
  return `${p.slice(0, idx).trimEnd()}\n\n${p.slice(cutEnd).trimStart()}`.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 把当前工厂选择的手法 / 动效 / 场景 / 反推档应用到已铺好的节点（不必整板重铺）。
 */
export function applyFactoryPrefsToBlocks(
  blocks: CanvasBlock[],
  opts: {
    craftShotIds?: string[];
    motionPromptIds?: string[];
    pathCameraRecipeIds?: string[];
    pathAnnotationJson?: unknown;
    narrativeLightingIds?: string[];
    maleHairstyleIds?: string[];
    maleMicroExpressionIds?: string[];
    promoCoverLayoutIds?: string[];
    actionCameraRecipeIds?: string[];
    cineVocabIds?: string[];
    wardrobePropContinuityIds?: string[];
    sceneId?: string;
    propIds?: string[];
    genreId?: string;
    characterIds?: string[];
    ancientArchetypeIds?: string[];
    identityLockZh?: string;
    artStyleId?: ManhuaArtStyleId | string;
    videoReverseOutputMode?: "zh" | "en" | "compact";
    customRefs?: ManhuaCustomAssetRef[];
  },
): CanvasBlock[] {
  const craftBlock = buildCraftShotInjectBlock(opts.craftShotIds || []);
  const motionBlock = buildMotionPromptInjectBlock(opts.motionPromptIds || []);
  const pathCameraBlock = buildPathCameraInjectBlock(opts.pathCameraRecipeIds || []);
  const narrativeLightingBlock = buildNarrativeLightingInjectBlock(opts.narrativeLightingIds || []);
  const maleHairstyleBlock = buildMaleHairstyleInjectBlock(opts.maleHairstyleIds || []);
  const maleMicroBlock = buildMaleMicroExpressionInjectBlock(opts.maleMicroExpressionIds || []);
  const promoCoverBlock = buildPromoCoverInjectBlock(opts.promoCoverLayoutIds || []);
  const actionCameraBlock = buildActionCameraInjectBlock(opts.actionCameraRecipeIds || []);
  const cineVocabBlock = formatCineVocabInjectBlock(opts.cineVocabIds || []);
  const wardrobeBlock = buildWardrobePropContinuityInjectBlock(opts.wardrobePropContinuityIds || []);
  const pathRecipeId = (opts.pathCameraRecipeIds || []).map(String).filter(Boolean)[0];
  const identityLockZh = String(opts.identityLockZh || "").trim() || undefined;
  const prefsAncientIds = (opts.ancientArchetypeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, 2);
  const prefsCharacterIds = prefsAncientIds.length
    ? []
    : (opts.characterIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const characterBlock = buildManhuaCharacterPromptBlock(prefsCharacterIds, {
    artStyleId: opts.artStyleId,
    identityLockZh,
  });
  const ancientBlock = buildAncientArchetypePromptBlock(prefsAncientIds, {
    identityLockZh,
  });
  const artStyle = getManhuaArtStylePreset(opts.artStyleId);
  const artStyleBlock = `【画风硬锁】${artStyle.labelZh}\n${artStyle.promptZh}`;
  const scene = getManhuaSceneTemplate(opts.sceneId);
  const sceneBlock = scene ? composeManhuaScenePromptBlock([scene]) : "";
  const sceneDemoBlock = composeManhuaSceneDemoAnchorBlock(opts.sceneId);
  const propAnchorBlock = composeManhuaSelectedPropAnchorBlock(opts.propIds);
  const genreBlock = composeGenreTemplatePromptBlock(getScreenwriterGenreTemplate(opts.genreId));
  const reverseMode =
    opts.videoReverseOutputMode === "en" || opts.videoReverseOutputMode === "compact"
      ? opts.videoReverseOutputMode
      : "zh";

  return blocks.map((b) => {
    const syncScene =
      b.id.startsWith("story-") ||
      b.id.startsWith("beats-") ||
      b.id.startsWith("reverse-") ||
      b.id.startsWith("keyart-");
    const syncGenre =
      b.id.startsWith("story-") ||
      b.id.startsWith("bible-") ||
      b.id.startsWith("beats-") ||
      b.id.startsWith("keyart-");

    if (b.id.startsWith("beats-") || b.id.startsWith("reverse-") || b.id.startsWith("keyart-")) {
      let base = stripInjectBlock(b.prompt, "【手法条目库·原子镜头】");
      base = stripMarkedSection(base, "【路径运镜配方】");
      base = stripMarkedSection(base, "【动作运镜配方】");
      base = stripMarkedSection(base, "【电影级可拍词表】");
      base = stripMarkedSection(base, "【叙事灯光动机库】");
      base = stripMarkedSection(base, "【男生微表情库】");
      if (syncGenre) base = stripMarkedSection(base, "【编剧剧种模板");
      if (syncScene) {
        base = stripMarkedSection(base, "【漫剧场景资产库");
        base = stripMarkedSection(base, "【场景示范图锚点】");
        if (b.id.startsWith("keyart-")) {
          base = stripMarkedSection(base, "【本集主场景优先】");
          base = stripMarkedSection(base, "【画风硬锁】");
          base = stripMarkedSection(base, "【角色库锚点】");
          base = stripMarkedSection(base, "【古风原型锚点】");
          base = stripMarkedSection(base, "【服装道具连续性】");
          base = stripMarkedSection(base, "【静帧·示范图融图】");
        }
      }
      base = stripMarkedSection(base, "【点选道具锚点】");
      const parts = [
        base,
        genreBlock && syncGenre ? genreBlock : "",
        sceneBlock && syncScene ? sceneBlock : "",
        sceneDemoBlock && syncScene ? sceneDemoBlock : "",
        b.id.startsWith("keyart-") && scene
          ? `【本集主场景优先】${scene.nameZh}\n直接吸收其生图提示词与核心元素，角色必须融入场景：\n${scene.promptZh}`
          : "",
        b.id.startsWith("keyart-") && characterBlock ? characterBlock : "",
        b.id.startsWith("keyart-") && ancientBlock ? ancientBlock : "",
        b.id.startsWith("keyart-") && wardrobeBlock ? wardrobeBlock : "",
        craftBlock,
        !b.id.startsWith("keyart-") ? pathCameraBlock : "",
        !b.id.startsWith("keyart-") ? actionCameraBlock : "",
        !b.id.startsWith("keyart-") ? cineVocabBlock : "",
        narrativeLightingBlock,
        (b.id.startsWith("beats-") || b.id.startsWith("keyart-")) && maleMicroBlock
          ? maleMicroBlock
          : "",
        b.id.startsWith("keyart-") ? artStyleBlock : "",
        (b.id.startsWith("beats-") || b.id.startsWith("keyart-")) && propAnchorBlock
          ? propAnchorBlock
          : "",
      ].filter(Boolean);
      const merged: CanvasBlock = {
        ...b,
        prompt: parts.join("\n\n"),
        ...(b.id.startsWith("reverse-") ? { videoReverseOutputMode: reverseMode } : {}),
      };
      if (b.id.startsWith("keyart-")) {
        const editPlan = planManhuaKeyartEditFusion({
          characterIds: prefsCharacterIds,
          ancientArchetypeIds: prefsAncientIds,
          artStyleId: opts.artStyleId,
          sceneId: opts.sceneId,
          propIds: opts.propIds,
          customRefs: opts.customRefs,
        });
        return applyKeyartEditPlanToBlock(merged, editPlan);
      }
      return merged;
    }
    if (b.id.startsWith("story-") || b.id.startsWith("bible-")) {
      let base = b.prompt;
      if (syncGenre) base = stripMarkedSection(base, "【编剧剧种模板");
      if (b.id.startsWith("story-")) {
        base = stripMarkedSection(base, "【漫剧场景资产库");
        base = stripMarkedSection(base, "【场景示范图锚点】");
      }
      if (b.id.startsWith("bible-")) {
        base = stripMarkedSection(base, "【角色库锚点】");
        base = stripMarkedSection(base, "【古风原型锚点】");
        base = stripMarkedSection(base, "【点选道具锚点】");
        base = stripMarkedSection(base, "【男发预设库】");
        base = stripMarkedSection(base, "【服装道具连续性】");
      }
      const parts = [
        base,
        genreBlock && syncGenre ? genreBlock : "",
        b.id.startsWith("story-") && sceneBlock ? sceneBlock : "",
        b.id.startsWith("story-") && sceneDemoBlock ? sceneDemoBlock : "",
        b.id.startsWith("bible-") && characterBlock ? characterBlock : "",
        b.id.startsWith("bible-") && ancientBlock ? ancientBlock : "",
        b.id.startsWith("bible-") && maleHairstyleBlock ? maleHairstyleBlock : "",
        b.id.startsWith("bible-") && wardrobeBlock ? wardrobeBlock : "",
        b.id.startsWith("bible-") && propAnchorBlock ? propAnchorBlock : "",
      ].filter(Boolean);
      return { ...b, prompt: parts.join("\n\n") };
    }
    if (b.id.startsWith("promo_cover-")) {
      let base = stripMarkedSection(b.prompt, "【漫剧宣发封面构图】");
      base = stripMarkedSection(base, "【画风硬锁】");
      const layoutId = (opts.promoCoverLayoutIds || [])[0];
      const layout = layoutId ? getPromoCoverLayoutById(layoutId) : null;
      const coverPrompt = layout
        ? buildPromoCoverPrompt(layout, {
            subjectZh: "主角",
            sceneZh: scene?.nameZh,
          })
        : base;
      return {
        ...b,
        prompt: [coverPrompt, promoCoverBlock, artStyleBlock].filter(Boolean).join("\n\n"),
      };
    }
    if (b.id.startsWith("clip-") || b.id.startsWith("omni_edit-")) {
      let base = stripInjectBlock(b.prompt, "【包装动效手法】");
      base = stripMarkedSection(base, "【路径运镜配方】");
      base = stripMarkedSection(base, "【动作运镜配方】");
      return {
        ...b,
        prompt: [base, pathCameraBlock, actionCameraBlock, motionBlock]
          .filter(Boolean)
          .join("\n\n"),
        ...(b.id.startsWith("clip-")
          ? {
              videoModel: "gemini-omni-flash" as const,
              pathCameraRecipeId: pathRecipeId || undefined,
              pathAnnotationJson: opts.pathAnnotationJson,
            }
          : { videoModel: "gemini-omni-flash" as const }),
      };
    }
    if (b.id.startsWith("recap_card-")) {
      const base = stripMarkedSection(b.prompt, "【画风硬锁】");
      return { ...b, prompt: artStyleBlock ? `${base}\n\n${artStyleBlock}` : base };
    }
    return b;
  });
}

/** 清除误挂到前情提要卡的 story 父链（旧画布兼容） */
export function sanitizeManhuaRecapUpstreamLinks(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  const nextBlocks = blocks.map((b) => {
    if (b.id.startsWith("story-") && b.parentId?.startsWith("recap_card-")) {
      return { ...b, parentId: undefined };
    }
    return b;
  });
  const nextEdges = edges.filter(
    (e) => !(e.fromId.startsWith("recap_card-") || e.toId.startsWith("recap_card-")),
  );
  return { blocks: nextBlocks, edges: nextEdges };
}

function sortKeyartBlocks(a: CanvasBlock, b: CanvasBlock): number {
  const sa = resolveKeyartShotIndex(a.id, a.prompt);
  const sb = resolveKeyartShotIndex(b.id, b.prompt);
  if (sa !== sb) return sa - sb;
  return a.id.localeCompare(b.id);
}

export function resolveManhuaFactoryOrderedIds(
  blocks: CanvasBlock[],
  untilStage: ManhuaFactoryStageKey = "clip",
  episodeIndex?: number | null,
): string[] {
  const storyNodes = blocks.filter((b) => b.id.startsWith("story-"));
  let scoped = blocks;
  if (typeof episodeIndex === "number" && episodeIndex >= 1) {
    scoped = filterBlocksByEpisode(blocks, episodeIndex);
  } else if (storyNodes.length > 1) {
    const firstEp = getBlockEpisodeIndex(storyNodes[0]!) ?? 1;
    scoped = filterBlocksByEpisode(blocks, firstEp);
  }
  const untilIdx = MANHUA_FACTORY_STAGE_ORDER.indexOf(untilStage);
  const ids: string[] = [];
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    if (MANHUA_FACTORY_STAGE_ORDER.indexOf(stage) > untilIdx) break;
    if (stage === "keyart") {
      const keyarts = scoped.filter((b) => b.id.startsWith("keyart-")).sort(sortKeyartBlocks);
      for (const k of keyarts) {
        if (!ids.includes(k.id)) ids.push(k.id);
      }
      continue;
    }
    if (stage === "clip") {
      const clips = scoped.filter((b) => b.id.startsWith("clip-")).sort(sortKeyartBlocks);
      for (const c of clips) {
        if (!ids.includes(c.id)) ids.push(c.id);
      }
      continue;
    }
    const byToken = scoped.find((b) => b.id.startsWith(`${stage}-`));
    if (byToken && !ids.includes(byToken.id)) ids.push(byToken.id);
  }
  if (ids.length < 2 && scoped.length) {
    const byParent: string[] = [];
    const roots = scoped.filter((b) => !b.parentId || !scoped.some((x) => x.id === b.parentId));
    let curId = roots[0]?.id ?? "";
    const seen = new Set<string>();
    while (curId && !seen.has(curId)) {
      seen.add(curId);
      byParent.push(curId);
      curId = scoped.find((b) => b.parentId === curId)?.id ?? "";
    }
    return byParent;
  }
  return ids;
}

export function filterManhuaFactoryTargetIds(
  orderedIds: string[],
  targetBlockIds?: string[],
): string[] {
  if (!targetBlockIds?.length) return orderedIds;
  const targets = new Set(targetBlockIds);
  return orderedIds.filter((id) => targets.has(id));
}

/**
 * 解析「生成片段」目标：必须先有该镜静帧节点；缺图则先跑该镜 keyart 再 clip。
 * 禁止无对应静帧时只跑 clip（会误挂第 1 镜导致成片雷同）。
 * 须在 expand / ensureManhuaFragmentClips 之后调用。
 */
export function resolveManhuaFragmentRunTargets(
  blocks: CanvasBlock[],
  episodeIndex: number,
  shotIndex: number,
): {
  targetBlockIds: string[];
  forceFromStage: ManhuaFactoryStageKey;
  keyartId?: string;
  clipId?: string;
} {
  const ep = Math.max(1, Math.floor(episodeIndex));
  const shot = Math.max(1, Math.floor(shotIndex));
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === ep;
  const keyart =
    blocks
      .filter((b) => b.id.startsWith("keyart-") && sameEpisode(b))
      .sort(sortKeyartBlocks)
      .find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot) ||
    undefined;
  const clip =
    blocks
      .filter((b) => b.id.startsWith("clip-") && sameEpisode(b))
      .sort(sortKeyartBlocks)
      .find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot) ||
    undefined;
  if (!keyart) {
    return { targetBlockIds: [], forceFromStage: "keyart" };
  }
  if (!clip) {
    return {
      targetBlockIds: [keyart.id],
      forceFromStage: "keyart",
      keyartId: keyart.id,
    };
  }
  const keyReady = Boolean(mediaUrlOf(keyart));
  if (keyReady) {
    return {
      targetBlockIds: [clip.id],
      forceFromStage: "clip",
      keyartId: keyart.id,
      clipId: clip.id,
    };
  }
  return {
    targetBlockIds: [keyart.id, clip.id],
    forceFromStage: "keyart",
    keyartId: keyart.id,
    clipId: clip.id,
  };
}

function stripShotInjectSection(prompt: string): string {
  return stripMarkedSection(String(prompt || ""), "【分镜");
}

function resolveShotsForEpisodeKeyarts(
  blocks: CanvasBlock[],
  episodeIndex: number | null | undefined,
): ManhuaWorkbenchShot[] {
  const sameEpisode = (b: CanvasBlock) => {
    if (episodeIndex == null) return true;
    const be = getBlockEpisodeIndex(b);
    return be == null ? episodeIndex === 1 : be === episodeIndex;
  };
  const reverse = blocks.find((b) => b.id.startsWith("reverse-") && sameEpisode(b));
  const beats = blocks.find((b) => b.id.startsWith("beats-") && sameEpisode(b));
  const reverseText = reverse?.outputText || reverse?.prompt || "";
  const beatsText = beats?.outputText || beats?.prompt || "";
  const fromReverse = parseWorkbenchShotsFromText(reverseText);
  const fromBeats = parseWorkbenchShotsFromText(beatsText);
  const shots = fromReverse.length >= 2 ? fromReverse : fromBeats.length >= 2 ? fromBeats : fromReverse;
  const withAngles = applyShotAnglesFromText(shots, `${reverseText}\n${beatsText}`);
  return withAngles.slice(0, MANHUA_SHOT_KEYART_MAX);
}

function makeShotBlockId(
  stage: "keyart" | "clip",
  episodeIndex: number | null | undefined,
  shotIndex: number,
): string {
  const pad = String(Math.max(1, shotIndex)).padStart(2, "0");
  if (typeof episodeIndex === "number" && episodeIndex >= 1) {
    return makeCanvasBlockId(`${stage}-e${String(episodeIndex).padStart(2, "0")}-s${pad}`);
  }
  return makeCanvasBlockId(`${stage}-s${pad}`);
}

/**
 * 按分镜为每镜铺/对齐片段成片节点（clip-eXX-sNN），parent 只绑「同镜号」静帧。
 * 禁止回落到 keyarts[0]（否则多镜成片同源、画面雷同）。
 * 保留无镜号后缀的旧整集 clip 作兼容，但工作台主路径读镜级 clip。
 */
export function ensureManhuaFragmentClips(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  episodeIndex?: number | null,
): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  const ep =
    typeof episodeIndex === "number" && episodeIndex >= 1
      ? episodeIndex
      : getBlockEpisodeIndex(blocks.find((b) => b.id.startsWith("reverse-")) || blocks[0]!) ?? 1;
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === ep;
  const shots = resolveShotsForEpisodeKeyarts(blocks, ep);
  const shotList =
    shots.length >= 1
      ? shots
      : [{ index: 1, durationSec: 2.5, cameraZh: "", actionZh: "" } as ManhuaWorkbenchShot];

  const keyarts = blocks.filter((b) => b.id.startsWith("keyart-") && sameEpisode(b)).sort(sortKeyartBlocks);
  if (!keyarts.length) return { blocks, edges };

  const keyartByShot = new Map<number, CanvasBlock>();
  for (const keyart of keyarts) {
    const shotIdx = resolveKeyartShotIndex(keyart.id, keyart.prompt);
    if (!keyartByShot.has(shotIdx)) keyartByShot.set(shotIdx, keyart);
  }

  const legacyClip = blocks.find(
    (b) => b.id.startsWith("clip-") && sameEpisode(b) && !/-s\d{2}(?:-|$)/.test(b.id),
  );
  const existingShotClips = blocks.filter(
    (b) => b.id.startsWith("clip-") && sameEpisode(b) && /-s\d{2}(?:-|$)/.test(b.id),
  );
  const clipByShot = new Map<number, CanvasBlock>();
  for (const clip of existingShotClips) {
    const shotIdx = resolveKeyartShotIndex(clip.id, clip.prompt);
    if (!clipByShot.has(shotIdx)) clipByShot.set(shotIdx, clip);
  }
  // 旧整集 clip 视为第 1 镜片段成片（仅当确有第 1 镜静帧）
  if (legacyClip && !clipByShot.has(1) && keyartByShot.has(1)) {
    clipByShot.set(1, legacyClip);
  }

  const template = legacyClip || existingShotClips[0] || keyarts[0]!;
  const nextExtras: CanvasBlock[] = [];
  const keepShotClipIds = new Set<string>();

  for (const shot of shotList) {
    const keyart = keyartByShot.get(shot.index);
    if (!keyart) continue; // 无对应静帧节点 → 不造 clip，避免挂错镜
    const existing = clipByShot.get(shot.index);
    if (existing) {
      keepShotClipIds.add(existing.id);
      continue;
    }
    const clone: CanvasBlock = {
      ...template,
      kind: "video",
      id: makeShotBlockId("clip", ep, shot.index),
      x: keyart.x + 220,
      y: keyart.y,
      parentId: keyart.id,
      prompt: [
        MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip,
        formatWorkbenchClipInjectBlock(shot),
      ]
        .filter(Boolean)
        .join("\n\n"),
      status: "idle",
      outputUrl: undefined,
      outputUrls: [],
      outputText: undefined,
      error: undefined,
      manhuaClipQuality: undefined,
      refImageUrl: mediaUrlOf(keyart) || keyart.refImageUrl,
      videoModel: "gemini-omni-flash",
      aspectRatio: template.aspectRatio || "9:16",
      episodeIndex: ep,
      episodeTitle: keyart.episodeTitle || template.episodeTitle,
    };
    nextExtras.push(clone);
    keepShotClipIds.add(clone.id);
    clipByShot.set(shot.index, clone);
  }

  // 删掉本集多余镜级 clip（旧反推遗留）；以及曾误挂到非同镜静帧的孤儿
  const staleClipIds = new Set(
    existingShotClips.filter((c) => !keepShotClipIds.has(c.id)).map((c) => c.id),
  );

  let nextBlocks = [
    ...blocks.filter((b) => !staleClipIds.has(b.id)),
    ...nextExtras,
  ].map((b) => {
    if (!b.id.startsWith("clip-") || !sameEpisode(b) || !keepShotClipIds.has(b.id)) return b;
    const shotIdx = resolveKeyartShotIndex(b.id, b.prompt);
    const keyart = keyartByShot.get(shotIdx);
    if (!keyart) return b;
    const keyUrl = mediaUrlOf(keyart);
    if (b.parentId === keyart.id && (!keyUrl || b.refImageUrl === keyUrl)) return b;
    return {
      ...b,
      parentId: keyart.id,
      refImageUrl: keyUrl || b.refImageUrl,
    };
  });

  const episodeClipIds = new Set(
    [...blocks, ...nextExtras]
      .filter((b) => b.id.startsWith("clip-") && sameEpisode(b))
      .map((b) => b.id),
  );
  let nextEdges = edges.filter(
    (e) =>
      !staleClipIds.has(e.fromId) &&
      !staleClipIds.has(e.toId) &&
      !episodeClipIds.has(e.toId),
  );
  // 重挂：每镜 keyart → 同镜号 clip（绝不串镜）
  for (const shot of shotList) {
    const keyart = keyartByShot.get(shot.index);
    const clip = clipByShot.get(shot.index);
    if (!keyart || !clip) continue;
    nextEdges.push({ fromId: keyart.id, toId: clip.id });
  }

  const laid = layoutManhuaEpisodeReadableChain(nextBlocks, ep);
  return { blocks: laid, edges: nextEdges };
}

/**
 * 画布可读铺板（左→右）：故事→设定→节拍→反推 → 竖排静帧 → 右侧同镜成片。
 * 对齐竞品「一眼看懂文→图→视频」流水线，不改节点语义。
 */
export function layoutManhuaEpisodeReadableChain(
  blocks: CanvasBlock[],
  episodeIndex?: number | null,
  opts?: { originX?: number; originY?: number; colGap?: number; rowGap?: number },
): CanvasBlock[] {
  const ep =
    typeof episodeIndex === "number" && episodeIndex >= 1
      ? Math.floor(episodeIndex)
      : getBlockEpisodeIndex(blocks.find((b) => b.id.startsWith("reverse-") || b.id.startsWith("story-")) || blocks[0]!) ??
        1;
  const originX = opts?.originX ?? 80;
  const originY = opts?.originY ?? 80;
  const gapX = opts?.colGap ?? 340;
  const gapY = opts?.rowGap ?? 220;
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === ep;

  const pick = (prefix: string) =>
    blocks.filter((b) => b.id.startsWith(`${prefix}-`) && sameEpisode(b));

  const textCols = [
    pick("story")[0],
    pick("bible")[0],
    pick("beats")[0],
    pick("reverse")[0],
  ].filter(Boolean) as CanvasBlock[];
  const keyarts = pick("keyart").sort(sortKeyartBlocks);
  const clips = pick("clip").sort(sortKeyartBlocks);
  if (!textCols.length && !keyarts.length) return blocks;

  const pos = new Map<string, { x: number; y: number }>();
  textCols.forEach((b, i) => {
    pos.set(b.id, { x: originX + gapX * i, y: originY });
  });
  const keyCol = textCols.length;
  const clipCol = keyCol + 1;
  keyarts.forEach((k, i) => {
    pos.set(k.id, { x: originX + gapX * keyCol, y: originY + i * gapY });
  });
  for (const c of clips) {
    const shot = resolveKeyartShotIndex(c.id, c.prompt);
    const row = keyarts.findIndex((k) => resolveKeyartShotIndex(k.id, k.prompt) === shot);
    pos.set(c.id, {
      x: originX + gapX * clipCol,
      y: originY + Math.max(0, row) * gapY,
    });
  }

  return blocks.map((b) => {
    const p = pos.get(b.id);
    return p ? { ...b, x: p.x, y: p.y } : b;
  });
}

function mediaUrlOf(b?: CanvasBlock): string | undefined {
  if (!b) return undefined;
  return b.outputUrl || b.outputUrls?.[0] || undefined;
}

/**
 * 反推完成后：按分镜展开多张关键静帧，并为每镜铺片段成片节点。
 */
export function expandManhuaShotKeyartsAfterReverse(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  reverseId: string,
): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  const reverse = blocks.find((b) => b.id === reverseId);
  if (!reverse) return { blocks, edges };
  const ep = getBlockEpisodeIndex(reverse);
  const sameEpisode = (b: CanvasBlock) => {
    if (ep == null) return true;
    const be = getBlockEpisodeIndex(b);
    return be == null ? ep === 1 : be === ep;
  };
  const shots = resolveShotsForEpisodeKeyarts(blocks, ep);
  if (shots.length < 2) {
    return ensureManhuaFragmentClips(blocks, edges, ep ?? 1);
  }

  const existingKeyarts = blocks.filter((b) => b.id.startsWith("keyart-") && sameEpisode(b)).sort(sortKeyartBlocks);
  const primary = existingKeyarts[0];
  if (!primary) return { blocks, edges };

  const existingByShot = new Map<number, CanvasBlock>();
  for (const keyart of existingKeyarts) {
    const shotIndex = resolveKeyartShotIndex(keyart.id, keyart.prompt);
    if (!existingByShot.has(shotIndex)) existingByShot.set(shotIndex, keyart);
  }

  // 已有每镜静帧时同步到当前反推：补齐注入，并删除旧反推遗留的多余/重复静帧。
  if (shots.every((shot) => existingByShot.has(shot.index))) {
    const keepIds = new Set(shots.map((shot) => existingByShot.get(shot.index)!.id));
    const removedIds = new Set(existingKeyarts.filter((b) => !keepIds.has(b.id)).map((b) => b.id));
    const nextBlocks = blocks.filter((b) => !removedIds.has(b.id)).map((b) => {
      if (!b.id.startsWith("keyart-") || !sameEpisode(b)) return b;
      const shotIdx = resolveKeyartShotIndex(b.id, b.prompt);
      const shot = shots.find((s) => s.index === shotIdx);
      if (!shot) return b;
      const base = stripShotInjectSection(b.prompt);
      return { ...b, prompt: [base, formatWorkbenchShotInjectBlock(shot)].filter(Boolean).join("\n\n") };
    });
    const nextEdges = edges.filter((edge) => !removedIds.has(edge.fromId) && !removedIds.has(edge.toId));
    return ensureManhuaFragmentClips(nextBlocks, nextEdges, ep ?? 1);
  }

  const basePrompt = stripShotInjectSection(primary.prompt);
  const shot1 = shots[0]!;
  const primaryPad = String(shot1.index).padStart(2, "0");
  // 主静帧补上 -s01 镜号，避免与后续镜错位、UI 误绑
  const primaryId =
    /-s\d{2}(?:-|$)/.test(primary.id)
      ? primary.id
      : makeCanvasBlockId(
          ep != null
            ? `keyart-e${String(ep).padStart(2, "0")}-s${primaryPad}`
            : `keyart-s${primaryPad}`,
        );
  const primaryUpdated: CanvasBlock = {
    ...primary,
    id: primaryId,
    prompt: [basePrompt, formatWorkbenchShotInjectBlock(shot1)].filter(Boolean).join("\n\n"),
  };

  const extras: CanvasBlock[] = [];
  for (let i = 1; i < shots.length; i++) {
    const shot = shots[i]!;
    const pad = String(shot.index).padStart(2, "0");
    const clone: CanvasBlock = {
      ...primary,
      id: makeCanvasBlockId(ep != null ? `keyart-e${String(ep).padStart(2, "0")}-s${pad}` : `keyart-s${pad}`),
      x: primary.x + Math.min(i, 3) * 28,
      y: primary.y + i * 36,
      parentId: reverse.id,
      prompt: [basePrompt, formatWorkbenchShotInjectBlock(shot)].filter(Boolean).join("\n\n"),
      status: "idle",
      outputUrl: undefined,
      outputUrls: [],
      outputText: undefined,
      error: undefined,
      episodeIndex: primary.episodeIndex ?? ep ?? undefined,
      episodeTitle: primary.episodeTitle,
    };
    extras.push(clone);
  }

  const nextBlocks = [
    ...blocks
      .filter((b) => b.id !== primary.id)
      .map((b) => (b.parentId === primary.id ? { ...b, parentId: primaryId } : b)),
    primaryUpdated,
    ...extras,
  ];

  // reverse → 各镜静帧；顺带改写指向旧 primary id 的边
  let nextEdges = edges
    .filter((e) => !(e.fromId === reverse.id && e.toId.startsWith("keyart-")))
    .map((e) => ({
      ...e,
      fromId: e.fromId === primary.id ? primaryId : e.fromId,
      toId: e.toId === primary.id ? primaryId : e.toId,
    }));
  nextEdges = [
    ...nextEdges,
    { fromId: reverse.id, toId: primaryId },
    ...extras.map((k) => ({ fromId: reverse.id, toId: k.id })),
  ];

  return ensureManhuaFragmentClips(nextBlocks, nextEdges, ep ?? 1);
}

export function stageKeyFromBlockId(blockId: string): ManhuaFactoryStageKey | null {
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    if (blockId.startsWith(`${stage}-`)) return stage;
  }
  return null;
}

function blockLooksDone(block: CanvasBlock): boolean {
  if (block.status === "done") {
    if (block.kind === "image" || block.kind === "video") {
      return Boolean(block.outputUrl || (block.outputUrls && block.outputUrls.length));
    }
    return Boolean(block.outputText?.trim());
  }
  return false;
}

/** 从反推 Markdown 抽可给静帧/成片用的短提示 */
export function extractFactoryMotionHints(reverseMarkdown: string): {
  keyArtHint: string;
  seedanceHint: string;
} {
  const text = String(reverseMarkdown || "").trim();
  if (!text) {
    return { keyArtHint: "", seedanceHint: "" };
  }
  const seedanceMatch =
    text.match(/##\s*可复制总提示[^\n]*\n+([\s\S]*?)(?=\n##|\n*$)/i) ||
    text.match(/##\s*Seedance[^\n]*\n+([\s\S]*?)(?=\n##|\n*$)/i);
  const seedanceHint = String(seedanceMatch?.[1] || "")
    .trim()
    .replace(/^[-*]\s*/gm, "")
    .slice(0, 600);
  const summaryMatch = text.match(/##\s*一句话摘要\n+([^\n]+)/);
  const summary = String(summaryMatch?.[1] || "").trim();
  const boardMatch = text.match(/##\s*分镜表\n+([\s\S]*?)(?=\n##|\n*$)/i);
  const boardSnippet = String(boardMatch?.[1] || "")
    .trim()
    .split("\n")
    .filter((line) => line.trim() && !/^\|?\s*-{2,}/.test(line))
    .slice(0, 6)
    .join("\n")
    .slice(0, 500);
  const lockMatch = text.match(/##\s*角色与场景锁定\n+([\s\S]*?)(?=\n##|\n*$)/i);
  const lockSnippet = String(lockMatch?.[1] || "")
    .trim()
    .slice(0, 280);
  const keyArtHint = [
    summary ? `题材摘要：${summary}` : "",
    lockSnippet ? `角色/场景锁定：\n${lockSnippet}` : "",
    boardSnippet ? `分镜要点：\n${boardSnippet}` : "",
    "竖屏电影感关键静帧：按分镜人数同框入画；关系镜须双人以上；角色外形锁定。",
    MANHUA_KEYART_NO_TEXT_LOCK,
  ]
    .filter(Boolean)
    .join("\n");
  return { keyArtHint, seedanceHint };
}

/** 网关超时 / 瞬时 5xx / abort 等可重试 */
export function isTransientFactoryError(message: string): boolean {
  const m = String(message || "");
  return /abort|timeout|超时|ROUTER_EXTERNAL|ECONNRESET|ETIMEDOUT|502|503|504|网关|稍后重试|算力紧张|rate.?limit|429|Failed to fetch|fetch failed|NetworkError|Load failed|network error/i.test(
    m,
  );
}

/**
 * 续跑起点：优先第一个 error；否则第一个未完成（非 done 有产出）。
 * keyart/clip 按多镜扫描，避免「第 1 镜 done」误判整阶段完成。
 * 全完成则返回 null。
 */
export function resolveFactoryResumeStage(
  blocks: CanvasBlock[],
  episodeIndex?: number | null,
): ManhuaFactoryStageKey | null {
  const storyNodes = blocks.filter((b) => b.id.startsWith("story-"));
  let scoped = blocks;
  if (typeof episodeIndex === "number" && episodeIndex >= 1) {
    scoped = filterBlocksByEpisode(blocks, episodeIndex);
  } else if (storyNodes.length > 1) {
    const firstEp = getBlockEpisodeIndex(storyNodes[0]!) ?? 1;
    scoped = filterBlocksByEpisode(blocks, firstEp);
  }
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    if (stage === "keyart" || stage === "clip") {
      const nodes = scoped
        .filter((x) => x.id.startsWith(`${stage}-`))
        .sort(sortKeyartBlocks);
      if (!nodes.length) continue;
      if (nodes.some((b) => b.status === "error")) return stage;
      if (nodes.some((b) => !blockLooksDone(b))) return stage;
      continue;
    }
    const b = scoped.find((x) => x.id.startsWith(`${stage}-`));
    // 可选阶段（如第1–2集无 recap_card）：跳过而非当成「未完成」
    if (!b) continue;
    if (b.status === "error") return stage;
    if (!blockLooksDone(b)) return stage;
  }
  return null;
}

/** 去掉上次续跑灌入的反推/角色卡段，保留剧种与场景资产库原文 */
function stripFactoryEnrichSections(prompt: string): string {
  return String(prompt || "")
    .replace(/\n*\n【来自编导反推】[\s\S]*?(?=\n\n【|\n*$)/g, "")
    .replace(/\n*\n【角色卡锚点】[\s\S]*?(?=\n\n【|\n*$)/g, "")
    .replace(/\n*\n【微动优先】[\s\S]*?(?=\n\n【|\n*$)/g, "")
    .replace(/\n*\n【分镜\s*\d+·片段成片】[\s\S]*?(?=\n\n【|\n*$)/g, "")
    .trim();
}

function extractShotInjectSection(prompt: string): string {
  const m = String(prompt || "").match(/【分镜\s*\d+[·・].*?】[\s\S]*?(?=\n\n【|\n*$)/);
  return String(m?.[0] || "").trim().slice(0, 1200);
}

function buildFragmentQualityExpectedContext(opts: {
  shot?: ManhuaWorkbenchShot;
  keyartPrompt?: string;
  clipPrompt?: string;
}): string {
  const shot = opts.shot;
  const shotBlock = shot
    ? [
        formatWorkbenchShotInjectBlock(shot),
        formatWorkbenchClipInjectBlock(shot),
      ].join("\n\n")
    : extractShotInjectSection(opts.keyartPrompt || "") ||
      extractShotInjectSection(opts.clipPrompt || "");
  return [
    shotBlock,
    "质检范围：仅本镜。只要首镜人物/场景连贯，且成片出现本镜关键事件或道具交互即可通过剧情项。",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
}

function enrichDownstreamPrompts(working: CanvasBlock[], justFinishedId: string): CanvasBlock[] {
  const stage = stageKeyFromBlockId(justFinishedId);
  if (stage !== "reverse") return working;
  const reverse = working.find((b) => b.id === justFinishedId);
  if (!reverse) return working;
  const ep = getBlockEpisodeIndex(reverse);
  const sameEpisode = (b: CanvasBlock) => {
    if (ep == null) return true;
    const be = getBlockEpisodeIndex(b);
    return be == null ? ep === 1 : be === ep;
  };
  const md = reverse.outputText || "";
  const { keyArtHint, seedanceHint } = extractFactoryMotionHints(md);
  const bibleText = String(
    working.find((b) => b.id.startsWith("bible-") && sameEpisode(b))?.outputText || "",
  )
    .trim()
    .slice(0, 700);
  const shots = resolveShotsForEpisodeKeyarts(working, ep ?? 1);
  if (!keyArtHint && !seedanceHint && !bibleText && !shots.length) return working;
  return working.map((b) => {
    if (!sameEpisode(b)) return b;
    if (b.id.startsWith("keyart-") && (keyArtHint || bibleText)) {
      // 保留铺节点时写入的场景资产库 / 剧种块，只追加反推与角色卡
      const kept = stripFactoryEnrichSections(b.prompt) || MANHUA_DRAMA_DEFAULT_PROMPTS.key_art;
      const parts = [
        kept,
        keyArtHint ? `【来自编导反推】\n${keyArtHint}` : "",
        // 角色锚点只取外形句，避免整段设定卡诱导多格文字排版
        bibleText
          ? `【角色外形锚点·禁字】\n${bibleText.slice(0, 400)}\n${MANHUA_KEYART_NO_TEXT_LOCK}`
          : "",
      ].filter(Boolean);
      return { ...b, prompt: parts.join("\n\n") };
    }
    if (b.id.startsWith("clip-")) {
      const shotIdx = resolveKeyartShotIndex(b.id, b.prompt);
      const shot =
        shots.find((s) => s.index === shotIdx) ||
        ({
          index: shotIdx,
          durationSec: 2.5,
          cameraZh: "",
          actionZh: "",
        } as ManhuaWorkbenchShot);
      const kept = stripFactoryEnrichSections(b.prompt) || MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip;
      return {
        ...b,
        prompt: [
          kept,
          formatWorkbenchClipInjectBlock(shot),
          seedanceHint ? `【微动优先】\n${seedanceHint}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
    return b;
  });
}

export type ManhuaFactoryPipelineResult = {
  blocks: CanvasBlock[];
  completedIds: string[];
  skippedIds: string[];
  errors: Array<{ id: string; message: string }>;
};

/**
 * 顺序自动跑漫剧工厂：每步用最新 working snapshot 收集上游。
 * skipDone=true 时跳过已完成节点，便于中断后续跑。
 */
export async function runManhuaDramaFactoryPipeline(opts: {
  deps: CanvasRunDeps;
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  untilStage?: ManhuaFactoryStageKey;
  /** 只跑该集工厂链（多集铺板时必传焦点集，避免串到第 1 集） */
  episodeIndex?: number | null;
  /** 从该阶段开始强制重跑（含）；之前的 done 仍跳过 */
  forceFromStage?: ManhuaFactoryStageKey;
  /** 仅执行这些已铺好的节点；用于工作台单镜重出，不重跑同集其他静帧。 */
  targetBlockIds?: string[];
  /** 工作台「生成片段」：展开后按镜号解析 target（优先于传入的 targetBlockIds）。 */
  fragmentShotIndex?: number;
  skipDone?: boolean;
  stopOnError?: boolean;
  /** 单阶段瞬时失败重试次数（不含首次），默认 2 */
  maxRetries?: number;
  onBlocksChange?: (blocks: CanvasBlock[]) => void;
  onStageStart?: (blockId: string, index: number, total: number, label: string) => void;
  onStageDone?: (blockId: string, index: number, total: number, label: string) => void;
  onStageSkip?: (blockId: string, label: string) => void;
  onStageRetry?: (blockId: string, label: string, attempt: number, message: string) => void;
  signal?: AbortSignal;
  /** 同集镜间接力 A/B；默认双开 */
  shotContinuity?: {
    keyartFromPrevStill?: boolean;
    clipFromPrevTail?: boolean;
  };
}): Promise<ManhuaFactoryPipelineResult> {
  // 默认不因单镜失败停整链（多镜一次出齐）；仅显式 stopOnError:true 才断
  const stopOnError = opts.stopOnError === true;
  const skipDone = opts.skipDone !== false;
  const defaultMaxRetries = Math.max(0, Math.min(4, opts.maxRetries ?? 2));
  const hadPoisonedRecapLink = opts.blocks.some(
    (b) => b.id.startsWith("story-") && Boolean(b.parentId?.startsWith("recap_card-")),
  );
  const sanitized = sanitizeManhuaRecapUpstreamLinks(
    opts.blocks.map((b) => ({ ...b })),
    opts.edges,
  );
  let working = sanitized.blocks;
  let edges = sanitized.edges;
  if (hadPoisonedRecapLink) {
    // 旧画布误挂 recap→story 时，写回清理后的 parentId，避免手点节点仍吃到提要图
    opts.onBlocksChange?.(working);
  }
  // 若反推已完成，先按镜展开静帧，避免只跑一张
  const reverseReady = working.find(
    (b) =>
      b.id.startsWith("reverse-") &&
      (opts.episodeIndex == null ||
        opts.episodeIndex < 1 ||
        (getBlockEpisodeIndex(b) ?? 1) === opts.episodeIndex) &&
      Boolean(b.outputText?.trim()),
  );
  if (reverseReady) {
    const expanded = expandManhuaShotKeyartsAfterReverse(working, edges, reverseReady.id);
    working = expanded.blocks;
    edges = expanded.edges;
    opts.onBlocksChange?.(working);
  } else if (
    typeof opts.episodeIndex === "number" &&
    opts.episodeIndex >= 1 &&
    (opts.fragmentShotIndex != null || (opts.untilStage ?? "clip") === "clip")
  ) {
    const ensured = ensureManhuaFragmentClips(working, edges, opts.episodeIndex);
    working = ensured.blocks;
    edges = ensured.edges;
    opts.onBlocksChange?.(working);
  }

  let resolvedTargetIds = opts.targetBlockIds;
  let resolvedForceFromStage = opts.forceFromStage;
  if (
    typeof opts.fragmentShotIndex === "number" &&
    opts.fragmentShotIndex >= 1 &&
    typeof opts.episodeIndex === "number" &&
    opts.episodeIndex >= 1
  ) {
    const fragment = resolveManhuaFragmentRunTargets(
      working,
      opts.episodeIndex,
      opts.fragmentShotIndex,
    );
    if (fragment.targetBlockIds.length) {
      resolvedTargetIds = fragment.targetBlockIds;
      resolvedForceFromStage = fragment.forceFromStage;
    } else {
      // 禁止回落成「整集跑」：缺本镜静帧节点时直接报错退出
      const shotTag = String(opts.fragmentShotIndex).padStart(2, "0");
      return {
        blocks: working,
        completedIds: [],
        skippedIds: [],
        errors: [
          {
            id: `keyart-e${String(opts.episodeIndex).padStart(2, "0")}-s${shotTag}`,
            message: `第 ${shotTag} 镜静帧节点未就绪，请先确认简报并生成分镜画面（只补本镜，勿整集重跑）`,
          },
        ],
      };
    }
  }

  let orderedIds = resolveManhuaFactoryOrderedIds(
    working,
    opts.untilStage ?? "clip",
    opts.episodeIndex,
  );
  orderedIds = filterManhuaFactoryTargetIds(orderedIds, resolvedTargetIds);
  const forceIdx = resolvedForceFromStage
    ? MANHUA_FACTORY_STAGE_ORDER.indexOf(resolvedForceFromStage)
    : -1;
  const completedIds: string[] = [];
  const skippedIds: string[] = [];
  const errors: Array<{ id: string; message: string }> = [];

  const publish = (next: CanvasBlock[]) => {
    working = next;
    opts.onBlocksChange?.(next);
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new Error("已取消"));
        return;
      }
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("已取消"));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
    });

  for (let i = 0; i < orderedIds.length; ) {
    if (opts.signal?.aborted) {
      errors.push({ id: orderedIds[i]!, message: "已取消" });
      break;
    }
    const blockId = orderedIds[i]!;
    let block = working.find((b) => b.id === blockId);
    if (!block) {
      i += 1;
      continue;
    }
    // 旧画布 clip 曾误挂 Seedance：工厂主成片一律 Gemini Omni
    if (block.id.startsWith("clip-") && block.videoModel !== "gemini-omni-flash") {
      block = { ...block, videoModel: "gemini-omni-flash" };
      working = working.map((b) => (b.id === blockId ? block! : b));
      opts.onBlocksChange?.(working);
    }
    const stage = stageKeyFromBlockId(blockId);
    const label = stage ? MANHUA_FACTORY_STAGE_LABEL_ZH[stage] : blockId;
    const stageIdx = stage ? MANHUA_FACTORY_STAGE_ORDER.indexOf(stage) : i;
    const mustRerun = forceIdx >= 0 && stageIdx >= forceIdx;

    /**
     * 关键静帧：连续多镜批量并行（出一张 publish 一张），不再串等上一镜 edit 底图。
     * 单镜重出仍走硬镜间接力（若用户开了 keyartFromPrevStill）。
     */
    if (stage === "keyart") {
      type KeyartJob = { index: number; id: string };
      const jobs: KeyartJob[] = [];
      let j = i;
      const keyartForce =
        forceIdx >= 0 && MANHUA_FACTORY_STAGE_ORDER.indexOf("keyart") >= forceIdx;
      while (j < orderedIds.length && orderedIds[j]!.startsWith("keyart-")) {
        const kid = orderedIds[j]!;
        const kb = working.find((b) => b.id === kid);
        if (!kb) {
          j += 1;
          continue;
        }
        if (skipDone && !keyartForce && blockLooksDone(kb)) {
          skippedIds.push(kid);
          opts.onStageSkip?.(kid, MANHUA_FACTORY_STAGE_LABEL_ZH.keyart);
          j += 1;
          continue;
        }
        jobs.push({ index: j, id: kid });
        j += 1;
      }
      if (!jobs.length) {
        i = j;
        continue;
      }

      const batchParallel = jobs.length >= 2;
      const concurrency = batchParallel ? MANHUA_KEYART_PARALLEL_CONCURRENCY : 1;
      const {
        normalizeManhuaShotContinuityPrefs,
        resolvePreviousShotKeyartUrl,
        MANHUA_SHOT_KEYART_CONTINUITY_HINT_ZH,
      } = await import("@shared/manhuaShotContinuity");
      const shotCont = normalizeManhuaShotContinuityPrefs(opts.shotContinuity);

      publish(
        working.map((b) =>
          jobs.some((job) => job.id === b.id)
            ? { ...b, status: "running" as const, error: undefined }
            : b,
        ),
      );
      for (const job of jobs) {
        opts.onStageStart?.(
          job.id,
          job.index,
          orderedIds.length,
          MANHUA_FACTORY_STAGE_LABEL_ZH.keyart,
        );
      }

      await mapWithConcurrency(jobs, concurrency, async (job) => {
        const kid = job.id;
        const kLabel = MANHUA_FACTORY_STAGE_LABEL_ZH.keyart;
        let lastMessage = "生成失败";
        let succeeded = false;
        for (let attempt = 0; attempt <= defaultMaxRetries; attempt++) {
          if (opts.signal?.aborted) {
            lastMessage = "已取消";
            break;
          }
          try {
            const current = working.find((b) => b.id === kid);
            if (!current) throw new Error("静帧节点不存在");
            const visionImages = collectVisionImages(kid, working, edges);
            const nearestRef =
              current.refImageUrl || resolveNearestUpstreamImageUrl(kid, working, edges);
            let runBlockPayload =
              nearestRef && nearestRef !== current.refImageUrl
                ? { ...current, refImageUrl: nearestRef }
                : current;
            const epForShot = getBlockEpisodeIndex(runBlockPayload) ?? opts.episodeIndex ?? 1;
            const shotForCont = resolveKeyartShotIndex(runBlockPayload.id, runBlockPayload.prompt);

            if (!batchParallel && shotCont.keyartFromPrevStill && shotForCont >= 2) {
              const prevStill = resolvePreviousShotKeyartUrl(working, epForShot, shotForCont);
              if (prevStill) {
                const basePrompt = String(runBlockPayload.prompt || "");
                runBlockPayload = {
                  ...runBlockPayload,
                  refImageUrl: prevStill,
                  imageMode: "edit",
                  prompt: basePrompt.includes("镜间静帧接力")
                    ? basePrompt
                    : `${basePrompt}\n\n${MANHUA_SHOT_KEYART_CONTINUITY_HINT_ZH}`,
                };
              }
            } else if (batchParallel && shotCont.keyartFromPrevStill) {
              const basePrompt = String(runBlockPayload.prompt || "");
              if (
                !basePrompt.includes("同集静帧一致性") &&
                !basePrompt.includes("镜间静帧接力")
              ) {
                runBlockPayload = {
                  ...runBlockPayload,
                  prompt: `${basePrompt}\n\n${MANHUA_KEYART_BATCH_SOFT_CONTINUITY_ZH}`,
                };
              }
            }

            const texts = collectUpstreamTexts(kid, working, edges);
            const out = await runCanvasBlock(opts.deps, runBlockPayload, {
              visionImages,
              texts,
            });
            let next = working.map((b) =>
              b.id === kid
                ? {
                    ...b,
                    status: "done" as const,
                    outputText: out.outputText,
                    outputUrl: out.outputUrl,
                    outputUrls:
                      out.outputUrls ?? (out.outputUrl ? [out.outputUrl] : b.outputUrls),
                    error: undefined,
                  }
                : b,
            );
            next = enrichDownstreamPrompts(next, kid);
            publish(next);
            completedIds.push(kid);
            opts.onStageDone?.(kid, job.index, orderedIds.length, kLabel);
            succeeded = true;
            break;
          } catch (e: unknown) {
            lastMessage = e instanceof Error ? e.message : "生成失败";
            if (lastMessage === "已取消" || opts.signal?.aborted) break;
            if (attempt < defaultMaxRetries && isTransientFactoryError(lastMessage)) {
              opts.onStageRetry?.(kid, kLabel, attempt + 1, lastMessage);
              publish(
                working.map((b) =>
                  b.id === kid
                    ? {
                        ...b,
                        status: "running" as const,
                        error: `重试 ${attempt + 1}/${defaultMaxRetries}：${lastMessage}`,
                      }
                    : b,
                ),
              );
              await sleep(1200 * (attempt + 1));
              continue;
            }
            break;
          }
        }
        if (!succeeded) {
          publish(
            working.map((b) =>
              b.id === kid ? { ...b, status: "error" as const, error: lastMessage } : b,
            ),
          );
          if (!errors.some((e) => e.id === kid)) {
            errors.push({ id: kid, message: lastMessage });
          }
        }
      });

      if (opts.signal?.aborted) break;
      if (stopOnError && errors.some((e) => jobs.some((job) => job.id === e.id))) break;
      i = j;
      continue;
    }

    if (skipDone && !mustRerun && blockLooksDone(block)) {
      skippedIds.push(blockId);
      opts.onStageSkip?.(blockId, label);
      i += 1;
      continue;
    }

    opts.onStageStart?.(blockId, i, orderedIds.length, label);
    publish(
      working.map((b) =>
        b.id === blockId ? { ...b, status: "running" as const, error: undefined } : b,
      ),
    );

    // 角色卡 / 故事大纲易遇网关抖动（含浏览器 Failed to fetch）：多给两次退避
    const maxRetries =
      stage === "bible" || stage === "story"
        ? Math.min(5, defaultMaxRetries + 2)
        : defaultMaxRetries;
    let lastMessage = "生成失败";
    let succeeded = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.signal?.aborted) {
        lastMessage = "已取消";
        break;
      }
      try {
        const current = working.find((b) => b.id === blockId) || block;
        const visionImages = collectVisionImages(blockId, working, edges);
        const nearestRef =
          current.kind === "image" || current.kind === "video"
            ? current.refImageUrl || resolveNearestUpstreamImageUrl(blockId, working, edges)
            : current.refImageUrl;
        let runBlockPayload =
          nearestRef && nearestRef !== current.refImageUrl
            ? { ...current, refImageUrl: nearestRef }
            : current;
        const {
          normalizeManhuaShotContinuityPrefs,
          resolvePreviousShotKeyartUrl,
          resolvePreviousShotClipUrl,
          MANHUA_SHOT_KEYART_CONTINUITY_HINT_ZH,
          MANHUA_SHOT_CLIP_CONTINUITY_HINT_ZH,
        } = await import("@shared/manhuaShotContinuity");
        const shotCont = normalizeManhuaShotContinuityPrefs(opts.shotContinuity);
        const epForShot = getBlockEpisodeIndex(runBlockPayload) ?? opts.episodeIndex ?? 1;
        const shotForCont = resolveKeyartShotIndex(runBlockPayload.id, runBlockPayload.prompt);

        // A：下一镜静帧 ← 上一镜静帧（edit 底图）
        if (stage === "keyart" && shotCont.keyartFromPrevStill && shotForCont >= 2) {
          const prevStill = resolvePreviousShotKeyartUrl(working, epForShot, shotForCont);
          if (prevStill) {
            const basePrompt = String(runBlockPayload.prompt || "");
            runBlockPayload = {
              ...runBlockPayload,
              refImageUrl: prevStill,
              imageMode: "edit",
              prompt: basePrompt.includes("镜间静帧接力")
                ? basePrompt
                : `${basePrompt}\n\n${MANHUA_SHOT_KEYART_CONTINUITY_HINT_ZH}`,
            };
          }
        }

        // B：下一镜成片 ← 上一镜成片（末帧/视频参考）；无同集上镜时再退回跨集
        if (stage === "clip") {
          let prevClipUrl: string | undefined;
          if (shotCont.clipFromPrevTail && shotForCont >= 2) {
            prevClipUrl = resolvePreviousShotClipUrl(working, epForShot, shotForCont);
          }
          if (!prevClipUrl && !runBlockPayload.refVideoUrl) {
            const ep = getBlockEpisodeIndex(runBlockPayload);
            if (ep != null && ep >= 2) {
              const { resolvePreviousEpisodeClipUrl } = await import("@shared/manhuaClipContinuity");
              prevClipUrl = resolvePreviousEpisodeClipUrl(working, ep);
            }
          }
          if (prevClipUrl) {
            const basePrompt = String(runBlockPayload.prompt || "");
            runBlockPayload = {
              ...runBlockPayload,
              refVideoUrl: prevClipUrl,
              prompt:
                shotCont.clipFromPrevTail && !basePrompt.includes("镜间成片接力")
                  ? `${basePrompt}\n\n${MANHUA_SHOT_CLIP_CONTINUITY_HINT_ZH}`
                  : basePrompt,
            };
          }
        }

        const docTexts =
          current.kind === "text" || current.kind === "copy_organize"
            ? await loadCanvasDocumentTexts(collectDocumentAssets(blockId, working, edges))
            : [];
        const texts = [...collectUpstreamTexts(blockId, working, edges), ...docTexts];
        let out = await runCanvasBlock(opts.deps, runBlockPayload, { visionImages, texts });
        let clipQuality: CanvasBlock["manhuaClipQuality"];
        if (stage === "clip" && out.outputUrl) {
          const episodeIndex = getBlockEpisodeIndex(current) ?? 1;
          const clipShot = resolveKeyartShotIndex(current.id, current.prompt);
          const keyartCandidates = working
            .filter(
              (candidate) =>
                candidate.id.startsWith("keyart-") &&
                (getBlockEpisodeIndex(candidate) ?? 1) === episodeIndex &&
                candidate.status === "done" &&
                Boolean(candidate.outputUrl || candidate.outputUrls?.[0]),
            )
            .sort(
              (a, b) =>
                resolveKeyartShotIndex(a.id, a.prompt) - resolveKeyartShotIndex(b.id, b.prompt),
            )
            .map((candidate) => ({
              id: candidate.id,
              url: candidate.outputUrl || candidate.outputUrls?.[0] || "",
              prompt: candidate.prompt,
              shotIndex: resolveKeyartShotIndex(candidate.id, candidate.prompt),
            }))
            .filter((candidate) => Boolean(candidate.url));
          const sameShotCandidates = keyartCandidates.filter((c) => c.shotIndex === clipShot);
          const initialRef = String(
            runBlockPayload.refImageUrl || visionImages.find((item) => item.url)?.url || "",
          ).trim();
          // 质检主参考优先同镜；无同镜时才用当前 I2V 底图，重试绝不跨镜烧算力
          const firstCandidate =
            sameShotCandidates.find((candidate) => candidate.url === initialRef) ||
            sameShotCandidates[0] ||
            keyartCandidates.find((candidate) => candidate.url === initialRef) ||
            keyartCandidates[0];
          if (!firstCandidate) throw new Error("缺少可供成片质检的关键静帧");

          const episodeForShot = getBlockEpisodeIndex(runBlockPayload) ?? opts.episodeIndex ?? 1;
          const shotIdx = resolveKeyartShotIndex(blockId, runBlockPayload.prompt);
          const shotMeta = resolveShotsForEpisodeKeyarts(working, episodeForShot).find(
            (s) => s.index === shotIdx,
          );
          const expectedDurationSec = shotMeta?.durationSec ?? 2.5;
          const expectedContext = buildFragmentQualityExpectedContext({
            shot: shotMeta,
            keyartPrompt: firstCandidate.prompt,
            clipPrompt: runBlockPayload.prompt,
          });
          const review = async (
            candidate: (typeof keyartCandidates)[number],
            attempts: number,
            videoUrl: string,
          ) =>
            reviewManhuaClipQuality({
              videoUrl,
              referenceImageUrl: candidate.url,
              expectedContext: buildFragmentQualityExpectedContext({
                shot: shotMeta,
                keyartPrompt: candidate.prompt,
                clipPrompt: runBlockPayload.prompt,
              }) || expectedContext,
              attempts,
              sourceKeyartId: candidate.id,
              expectedDurationSec,
              shotIndex: shotIdx,
            });

          clipQuality = await review(firstCandidate, 1, out.outputUrl);
          if (
            clipQuality.status !== "passed" &&
            !isManhuaClipQualityInfraFailure(clipQuality) &&
            !isManhuaClipQualityKeyartTextFailure(clipQuality)
          ) {
            const fallbackCandidate = sameShotCandidates.find(
              (candidate) => candidate.id !== firstCandidate.id,
            );
            if (fallbackCandidate) {
              out = await runCanvasBlock(
                opts.deps,
                { ...runBlockPayload, refImageUrl: fallbackCandidate.url },
                { visionImages, texts },
              );
              if (!out.outputUrl) throw new Error("智能质检重试未返回成片");
              clipQuality = await review(fallbackCandidate, 2, out.outputUrl);
            }
          }

          if (clipQuality.status !== "passed") {
            const failedQuality = clipQuality;
            const infra = isManhuaClipQualityInfraFailure(failedQuality);
            const keyartTextFail = isManhuaClipQualityKeyartTextFailure(failedQuality);
            // 首镜烧字：自动重出该镜静帧一次，再重跑成片；仍失败才拦
            if (keyartTextFail && firstCandidate.id) {
              opts.onStageRetry?.(
                firstCandidate.id,
                `静帧含字·重出第${shotIdx}镜`,
                1,
                failedQuality.summary || "首镜含违规文字",
              );
              const keyartBlock = working.find((b) => b.id === firstCandidate.id);
              if (keyartBlock) {
                try {
                  const keyOut = await runCanvasBlock(
                    opts.deps,
                    {
                      ...keyartBlock,
                      status: "idle",
                      outputUrl: undefined,
                      outputUrls: [],
                      error: undefined,
                      // 强制文生图，避免带字底图继续融脏
                      imageMode: "generate",
                      editMaskUrl: undefined,
                      editFusionUrls: [],
                    },
                    { visionImages, texts },
                  );
                  if (keyOut.outputUrl) {
                    working = working.map((b) =>
                      b.id === firstCandidate.id
                        ? {
                            ...b,
                            status: "done" as const,
                            outputUrl: keyOut.outputUrl,
                            outputUrls: keyOut.outputUrls ?? [keyOut.outputUrl!],
                            error: undefined,
                          }
                        : b,
                    );
                    publish(working);
                    const freshKey = working.find((b) => b.id === firstCandidate.id)!;
                    const freshUrl = mediaUrlOf(freshKey) || keyOut.outputUrl!;
                    out = await runCanvasBlock(
                      opts.deps,
                      { ...runBlockPayload, refImageUrl: freshUrl },
                      { visionImages, texts },
                    );
                    if (out.outputUrl) {
                      clipQuality = await review(
                        {
                          id: freshKey.id,
                          url: freshUrl,
                          prompt: freshKey.prompt,
                          shotIndex: resolveKeyartShotIndex(freshKey.id, freshKey.prompt),
                        },
                        2,
                        out.outputUrl,
                      );
                    }
                  }
                } catch {
                  /* 自动重出失败则走下方原失败分支 */
                }
              }
            }
          }

          if (clipQuality.status !== "passed") {
            const failedQuality = clipQuality;
            const infra = isManhuaClipQualityInfraFailure(failedQuality);
            const keyartTextFail = isManhuaClipQualityKeyartTextFailure(failedQuality);
            // 软拦：成片保留可播；默认不进成片坞，等用户「仍采用」
            const softTip = keyartTextFail
              ? `质检提醒：${failedQuality.summary}（建议重出静帧后再采用）`
              : infra
                ? `质检暂不可用：${failedQuality.summary}`
                : `质检提醒：${failedQuality.summary}（可预览；点「仍采用此片」才进成片坞）`;
            working = working.map((candidate) =>
              candidate.id === blockId
                ? {
                    ...candidate,
                    status: "done" as const,
                    outputUrl: out.outputUrl,
                    outputUrls: out.outputUrls ?? (out.outputUrl ? [out.outputUrl] : candidate.outputUrls),
                    manhuaClipQuality: {
                      ...failedQuality,
                      userAcceptedDespiteQc: false,
                    },
                    error: softTip,
                  }
                : candidate,
            );
            publish(working);
            completedIds.push(blockId);
            opts.onStageDone?.(blockId, i, orderedIds.length, label);
            succeeded = true;
            break;
          }
        }
        let next = working.map((b) =>
          b.id === blockId
            ? {
                ...b,
                status: "done" as const,
                outputText: out.outputText,
                outputUrl: out.outputUrl,
                outputUrls: out.outputUrls ?? (out.outputUrl ? [out.outputUrl] : b.outputUrls),
                manhuaClipQuality: clipQuality,
                error: undefined,
              }
            : b,
        );
        next = enrichDownstreamPrompts(next, blockId);
        if (stage === "reverse") {
          const expanded = expandManhuaShotKeyartsAfterReverse(next, edges, blockId);
          next = expanded.blocks;
          edges = expanded.edges;
          // 反推后新铺的按镜静帧与片段成片需并入后续执行队列
          const freshOrdered = resolveManhuaFactoryOrderedIds(
            next,
            opts.untilStage ?? "clip",
            opts.episodeIndex,
          ).filter(
            (id) =>
              (id.startsWith("keyart-") || id.startsWith("clip-")) && !orderedIds.includes(id),
          );
          if (freshOrdered.length) {
            const clipAt = orderedIds.findIndex((id) => id.startsWith("clip-"));
            const insertAt = clipAt >= 0 ? clipAt : orderedIds.length;
            orderedIds.splice(insertAt, 0, ...freshOrdered);
          }
        }
        publish(next);
        completedIds.push(blockId);
        opts.onStageDone?.(blockId, i, orderedIds.length, label);
        succeeded = true;
        break;
      } catch (e: unknown) {
        lastMessage = e instanceof Error ? e.message : "生成失败";
        if (lastMessage === "已取消" || opts.signal?.aborted) break;
        if (attempt < maxRetries && isTransientFactoryError(lastMessage)) {
          opts.onStageRetry?.(blockId, label, attempt + 1, lastMessage);
          publish(
            working.map((b) =>
              b.id === blockId
                ? { ...b, status: "running" as const, error: `重试 ${attempt + 1}/${maxRetries}：${lastMessage}` }
                : b,
            ),
          );
          await sleep((stage === "bible" ? 1800 : 1200) * (attempt + 1));
          continue;
        }
        break;
      }
    }

    if (!succeeded) {
      const alreadyLogged = errors.some((e) => e.id === blockId);
      publish(
        working.map((b) =>
          b.id === blockId ? { ...b, status: "error" as const, error: lastMessage } : b,
        ),
      );
      if (!alreadyLogged) {
        errors.push({ id: blockId, message: lastMessage });
      }
      if (lastMessage === "已取消" || opts.signal?.aborted) break;
      if (stopOnError) break;
    }
    i += 1;
  }

  return { blocks: working, completedIds, skippedIds, errors };
}

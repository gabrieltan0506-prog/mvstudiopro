/**
 * 漫剧工厂：一键铺节点 + 顺序自动跑（故事→角色→节拍→反推→静帧→Seedance）
 * 目标：阿硕级「脚本进、成片出」分步编排核（按阶段跑；不引导一键全自动）。
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
import { isManhuaClipQualityInfraFailure } from "@shared/manhuaClipQuality";
import {
  assignManhuaCanvasAssetAtTags,
  buildManhuaAssetLockRegistry,
  formatManhuaAssetImageBindBlock,
  type ManhuaAssetLockRegistry,
} from "@shared/manhuaAssetLockRegistry";
import type { ManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import {
  extractManhuaSegmentDialogueQuotes,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
  type ManhuaEpisodeSegmentPlan,
} from "@shared/manhuaEpisodeSegmentPlan";
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
  formatManhuaStylePackInjectBlock,
  type ManhuaStylePack,
} from "@shared/manhuaStylePack";
import {
  buildManhuaCharacterPromptBlock,
  getManhuaArtStylePreset,
  type ManhuaArtStyleId,
} from "@shared/manhuaCharacterAssetLibrary";
import { buildAncientArchetypePromptBlock } from "@shared/manhuaAncientArchetypeLibrary";
import {
  formatDynastyWardrobeInjectBlock,
  MANHUA_ANCIENT_CHARACTER_FORMULA_ZH,
} from "@shared/manhuaDynastyWardrobeBank";
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
import {
  formatCineVocabInjectBlock,
  type ManhuaCineVocabLocale,
} from "@shared/manhuaCineVocabBank";
import { formatCustomAssetRefsDutyBlock } from "@shared/manhuaCustomAssetRefs";
import { stripManhuaPromptSlop } from "@shared/manhuaDirectingWorkflow";
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
  formatWorkbenchSegmentClipInjectBlock,
  formatWorkbenchShotInjectBlock,
  groupShotsIntoSegments,
  hydrateWorkbenchShotsWithSegmentDialogue,
  manhuaGlobalSegmentIndex,
  manhuaSegmentDurationSec,
  MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
  MANHUA_KEYART_NO_TEXT_LOCK,
  MANHUA_KEYARTS_PER_SEGMENT_MIN,
  MANHUA_SEGMENT_DEFAULT,
  MANHUA_SHOT_KEYART_MAX,
  parseWorkbenchShotsFromText,
  resolveClipLocalSegmentIndex,
  resolveClipSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentClipDurationSec,
  resolveSegmentIndexFromShotIndex,
  stripManhuaClipForbiddenBoards,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";
import { applyShotAnglesFromText } from "@shared/manhuaShotAnglePersist";
import { extractManhuaSceneHintFromPrompt } from "@shared/manhuaClipDialogueTimeline";
import {
  resolvePreviousSegmentClipUrl,
} from "@shared/manhuaClipContinuity";
import {
  planManhuaKeyartEditFusion,
  type ManhuaKeyartEditPlan,
} from "@shared/manhuaKeyartEditFusion";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import {
  attachManhuaKeyartShotInject,
  buildManhuaKeyartSlimEditAddon,
  buildManhuaKeyartSlimPrompt,
  stripManhuaKeyartShotInject,
} from "@shared/manhuaKeyartSlimPrompt";

/** 把 edit 计划的垫图/融图挂到节点；prompt 已是完整短包时不再叠长文 */
function applyKeyartEditPlanToBlock(
  block: CanvasBlock,
  plan: ManhuaKeyartEditPlan,
  opts?: { promptAlreadyFinal?: boolean },
): CanvasBlock {
  let prompt = String(block.prompt || "");
  if (!opts?.promptAlreadyFinal) {
    prompt = stripMarkedSection(prompt, "【静帧·示范图融图】");
    prompt = stripMarkedSection(prompt, "【静帧·用户参考融图】");
    prompt = stripMarkedSection(prompt, "【静帧·人物库垫图·改图】");
    prompt = stripMarkedSection(prompt, "【静帧·用户垫图·改图】");
    prompt = stripMarkedSection(prompt, "【静帧·人物库垫图·Image-2 Edit】");
    prompt = stripMarkedSection(prompt, "【静帧·用户垫图·Image-2 Edit】");
    prompt = stripMarkedSection(prompt, "【静帧·设定卡身份锁】");
    prompt = stripMarkedSection(prompt, "【资产锁·编号对照·必守】");
    // 源头短包路径：融图说明已在 slim 内；旧肥节点兜底才追加短 addon
    if (!prompt.includes("【静帧·源头短包】")) {
      prompt = [prompt, buildManhuaKeyartSlimEditAddon(plan)].filter(Boolean).join("\n\n");
    }
  }
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
  // 新计划暂时算不出垫图时：绝不能清空节点上已有垫图（重跑 prefs 一刷会全军覆没）
  const existingRef = String(block.refImageUrl || "").trim();
  const existingFusion = (block.editFusionUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  if (existingRef || existingFusion.length) {
    const ref = existingRef || existingFusion[0]!;
    return {
      ...block,
      prompt,
      imageModel: "gpt-image-2",
      imageMode: "edit",
      refImageUrl: ref,
      editFusionUrls: existingFusion.filter((u) => u !== ref).slice(0, 15),
    };
  }
  // 无垫图：不静默改文生；保留 generate 标记，运行时会硬失败并提示补人物库
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

/** 批量静帧并发：官方 Image-2 high 较慢，>2 易撞本地 AbortSignal 超时 */
export const MANHUA_KEYART_PARALLEL_CONCURRENCY = 2;

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
  /**
   * 朝代服饰 dyn_*（可选点选；勿按题材自动推荐——玄幻/CG 常无历史朝代）
   */
  dynastyWardrobeIds?: string[];
  /** 用户上传/基于库参考生成的参考图（勾选角色后进静帧融图） */
  customRefs?: ManhuaCustomAssetRef[];
  /** 系列人物/道具表：定妆特写格进资产锁 @道具 子编号 */
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** 剧本跟随身份锁（时代/族裔/服饰；来自 CastBundle） */
  identityLockZh?: string;
  /** 角色/场景统一画风：仿真人 / CG 漫剧 */
  artStyleId?: ManhuaArtStyleId | string;
  /** 产品化风格包：色卡 + 光影构图 DNA（注入静帧/成片） */
  stylePack?: ManhuaStylePack | null;
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
  /** 可拍词表注入语言 */
  cineVocabLocale?: ManhuaCineVocabLocale;
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

export function getBlockEpisodeIndex(block: {
  id: string;
  episodeIndex?: number | null;
}): number | null {
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

/** 漫剧工厂产物（含角色/场景设定图、宣发封面）；自由画布节点不在此列 */
export function isManhuaFactoryArtifactBlock(
  block: Pick<CanvasBlock, "id">,
): boolean {
  const id = String(block.id || "");
  if (!id) return false;
  if (stageKeyFromBlockId(id)) return true;
  if (id.startsWith("promo_cover-")) return true;
  if (id.startsWith("charsheet-") || id.startsWith("sceneplate-")) return true;
  // 旧链偶发无后缀：story / keyart
  if ((MANHUA_FACTORY_STAGE_ORDER as readonly string[]).includes(id)) return true;
  return false;
}

/**
 * 重扩写 / 换剧本时清掉旧工厂链与设定图，避免旧静帧·成片盖住新剧情。
 * 保留自由画布上的非工厂节点。
 */
export function stripManhuaFactoryCanvasArtifacts(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
): { blocks: CanvasBlock[]; edges: CanvasEdge[]; removedCount: number } {
  const removedIds = new Set(
    blocks.filter((b) => isManhuaFactoryArtifactBlock(b)).map((b) => b.id),
  );
  if (!removedIds.size) {
    return { blocks, edges, removedCount: 0 };
  }
  return {
    blocks: blocks.filter((b) => !removedIds.has(b.id)),
    edges: edges.filter((e) => !removedIds.has(e.fromId) && !removedIds.has(e.toId)),
    removedCount: removedIds.size,
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
  const dynastyWardrobeIds = (opts.dynastyWardrobeIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, 2);
  /** 仅显式点选才注入；不按题材硬套朝代 */
  const dynastyWardrobeBlock = formatDynastyWardrobeInjectBlock(dynastyWardrobeIds);
  const ancientFormulaBlock = ancientBlock
    ? `【古风角色公式】${MANHUA_ANCIENT_CHARACTER_FORMULA_ZH}`
    : "";
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
    opts.cineVocabLocale || "zh",
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
    // 成片侧再钉对白/道具/运镜/动作/场景（三分钟集）
    includeEpisodeQuality: true,
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
  const stylePackBlock = formatManhuaStylePackInjectBlock(opts.stylePack);
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
    ancientFormulaBlock,
    dynastyWardrobeBlock,
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
  // 源头短包：不把角色/场景/剧种长文写进每张静帧（避免 expand 克隆肥 base）
  const keyartEditPlan = planManhuaKeyartEditFusion({
    characterIds,
    ancientArchetypeIds,
    artStyleId: opts.artStyleId,
    sceneId,
    propIds,
    customRefs: opts.customRefs,
    assetCanon: opts.assetCanon,
  });
  keyArt.prompt = buildManhuaKeyartSlimPrompt({
    artStyleId: opts.artStyleId,
    characterIds,
    ancientArchetypeIds,
    sceneId,
    propIds,
    customRefs: opts.customRefs,
    editPlan: keyartEditPlan,
  });
  keyArt.parentId = reverse.id;
  /** 成片底图默认 Image-2；有示范图则 edit/融图套场景道具 */
  keyArt.imageModel = "gpt-image-2";
  keyArt.aspectRatio = "9:16";
  Object.assign(keyArt, applyKeyartEditPlanToBlock(keyArt, keyartEditPlan, { promptAlreadyFinal: true }));

  const clip = defaultCanvasBlock("video", originX + gapX * (col0 + 5), originY);
  clip.id = makeFactoryStageId("clip", episodeIndex);
  // 成片正文由 ensureManhuaFragmentClips 写秒轴短指令；此处只占位，禁止灌规则墙/古风板
  clip.prompt = [
    "【成片占位】铺段/审阅后写入秒轴短指令；身份靠垫图@Image，勿在此堆规则墙。",
    artStyle ? `画风：${artStyle.labelZh}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  clip.parentId = keyArt.id;
  /** 工厂主成片仅 Seedance 标准 / 快速（默认 Fast；CG 多图参考） */
  clip.videoModel = MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
  clip.aspectRatio = "9:16";
  if (pathCameraRecipeIds[0]) clip.pathCameraRecipeId = pathCameraRecipeIds[0];
  if (opts.pathAnnotationJson != null) clip.pathAnnotationJson = opts.pathAnnotationJson;

  let promoCover: CanvasBlock | null = null;
  const promoLayout = promoCoverIds[0] ? getPromoCoverLayoutById(promoCoverIds[0]) : null;
  if (promoLayout) {
    promoCover = defaultCanvasBlock("image", originX + gapX * (col0 + 6), originY);
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
    promoCover,
  ].filter(Boolean) as CanvasBlock[];
  const blocks = rawBlocks.map((b) => stampEpisodeMeta(b, episodeIndex, episodeTitle));
  const edges: CanvasEdge[] = [
    { fromId: story.id, toId: bible.id },
    { fromId: bible.id, toId: beats.id },
    { fromId: beats.id, toId: reverse.id },
    { fromId: reverse.id, toId: keyArt.id },
    { fromId: keyArt.id, toId: clip.id },
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
  /** 可拍词表注入语言 */
  cineVocabLocale?: ManhuaCineVocabLocale;
    wardrobePropContinuityIds?: string[];
    sceneId?: string;
    propIds?: string[];
    genreId?: string;
    characterIds?: string[];
    ancientArchetypeIds?: string[];
    /** 朝代服饰 dyn_*（可选；仅点选注入） */
    dynastyWardrobeIds?: string[];
    identityLockZh?: string;
    artStyleId?: ManhuaArtStyleId | string;
    stylePack?: ManhuaStylePack | null;
    videoReverseOutputMode?: "zh" | "en" | "compact";
    customRefs?: ManhuaCustomAssetRef[];
    assetCanon?: ManhuaWriterAssetCanon | null;
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
  const cineVocabBlock = formatCineVocabInjectBlock(
    opts.cineVocabIds || [],
    opts.cineVocabLocale || "zh",
  );
  const referenceDutyBlock = formatCustomAssetRefsDutyBlock(opts.customRefs || []);
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
  const dynastyWardrobeBlock = formatDynastyWardrobeInjectBlock(opts.dynastyWardrobeIds || []);
  const ancientFormulaBlock = ancientBlock
    ? `【古风角色公式】${MANHUA_ANCIENT_CHARACTER_FORMULA_ZH}`
    : "";
  const artStyle = getManhuaArtStylePreset(opts.artStyleId);
  const artStyleBlockKeyart = `【画风硬锁】${artStyle.labelZh}\n${artStyle.promptZh}`;
  const artStyleBlock = artStyleBlockKeyart;
  const stylePackBlock = formatManhuaStylePackInjectBlock(opts.stylePack);
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

    // 关键静帧：prefs 一律重写为源头短包（保留本镜分镜段），不再叠角色/场景长文
    if (b.id.startsWith("keyart-")) {
      const shotIdx = resolveKeyartShotIndex(b.id, b.prompt);
      const shotStub: ManhuaWorkbenchShot | null =
        shotIdx >= 1
          ? {
              index: shotIdx,
              durationSec: 5,
              cameraZh: "",
              actionZh: "",
              dialogueZh: "",
              emotionZh: "",
            }
          : null;
      // 尽量保留已有分镜注入原文（避免 prefs 防抖冲掉动作描写）
      const keptShot = (() => {
        const m = String(b.prompt || "").match(/【分镜\s*\d+·静帧[\s\S]*$/i);
        return m ? m[0].trim() : "";
      })();
      const editPlan = planManhuaKeyartEditFusion({
        characterIds: prefsCharacterIds,
        ancientArchetypeIds: prefsAncientIds,
        artStyleId: opts.artStyleId,
        sceneId: opts.sceneId,
        propIds: opts.propIds,
        customRefs: opts.customRefs,
        assetCanon: opts.assetCanon,
      });
      const slimCore = buildManhuaKeyartSlimPrompt({
        artStyleId: opts.artStyleId,
        characterIds: prefsCharacterIds,
        ancientArchetypeIds: prefsAncientIds,
        sceneId: opts.sceneId,
        propIds: opts.propIds,
        customRefs: opts.customRefs,
        editPlan,
      });
      const nextPrompt = keptShot
        ? `${slimCore}\n\n${keptShot}`
        : shotStub
          ? attachManhuaKeyartShotInject(slimCore, shotStub)
          : slimCore;
      return applyKeyartEditPlanToBlock(
        { ...b, prompt: nextPrompt },
        editPlan,
        { promptAlreadyFinal: true },
      );
    }

    if (b.id.startsWith("beats-") || b.id.startsWith("reverse-")) {
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
      }
      base = stripMarkedSection(base, "【点选道具锚点】");
      base = stripMarkedSection(base, "【参考职责】");
      const parts = [
        base,
        genreBlock && syncGenre ? genreBlock : "",
        sceneBlock && syncScene ? sceneBlock : "",
        sceneDemoBlock && syncScene ? sceneDemoBlock : "",
        craftBlock,
        pathCameraBlock,
        actionCameraBlock,
        cineVocabBlock,
        narrativeLightingBlock,
        b.id.startsWith("beats-") && maleMicroBlock ? maleMicroBlock : "",
        (b.id.startsWith("beats-") || b.id.startsWith("clip-")) && stylePackBlock
          ? stylePackBlock
          : "",
        b.id.startsWith("beats-") && propAnchorBlock ? propAnchorBlock : "",
      ].filter(Boolean);
      return {
        ...b,
        prompt: stripManhuaPromptSlop(parts.join("\n\n")),
        ...(b.id.startsWith("reverse-") ? { videoReverseOutputMode: reverseMode } : {}),
      };
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
        base = stripMarkedSection(base, "【古风角色公式】");
        base = stripMarkedSection(base, "【朝代服饰锚点");
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
        b.id.startsWith("bible-") && ancientFormulaBlock ? ancientFormulaBlock : "",
        b.id.startsWith("bible-") && dynastyWardrobeBlock ? dynastyWardrobeBlock : "",
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
    if (b.id.startsWith("clip-")) {
      // 禁止 prefs 回灌古风板/角色长文/运镜墙；只保秒轴 + Image 对照 + 画风一行
      let base = stripManhuaClipForbiddenBoards(String(b.prompt || ""));
      base = stripInjectBlock(base, "【包装动效手法】");
      for (const mark of [
        "【路径运镜配方】",
        "【动作运镜配方】",
        "【画风硬锁】",
        "【成片画风】",
        "【角色库锚点】",
        "【古风原型锚点】",
        "【古风角色公式】",
        "【服装道具连续性】",
        "【点选道具锚点】",
        "【参考职责】",
        "【镜头连续性】",
        "【跨段转场】",
        "【资产锁·编号对照",
        "【资产】",
      ]) {
        base = stripMarkedSection(base, mark);
      }
      const artLine = `画风：${artStyle.labelZh}`;
      const hasArt = /^画风：/m.test(base);
      return {
        ...b,
        prompt: stripManhuaPromptSlop(
          [base, hasArt ? "" : artLine].filter(Boolean).join("\n"),
        ),
        videoModel: (
          b.videoModel === "seedance-2.0" || b.videoModel === "seedance-2.0-fast"
            ? b.videoModel
            : MANHUA_FACTORY_DEFAULT_VIDEO_MODEL
        ) as CanvasBlock["videoModel"],
        pathCameraRecipeId: pathRecipeId || undefined,
        pathAnnotationJson: opts.pathAnnotationJson,
      };
    }
    if (b.id.startsWith("omni_edit-")) {
      let base = stripInjectBlock(b.prompt, "【包装动效手法】");
      base = stripMarkedSection(base, "【路径运镜配方】");
      base = stripMarkedSection(base, "【动作运镜配方】");
      base = stripMarkedSection(base, "【画风硬锁】");
      base = stripMarkedSection(base, "【成片画风】");
      return {
        ...b,
        prompt: [base, artStyleBlockKeyart, pathCameraBlock, actionCameraBlock, motionBlock]
          .filter(Boolean)
          .join("\n\n"),
        videoModel: (
          b.videoModel === "seedance-2.0" || b.videoModel === "seedance-2.0-fast"
            ? b.videoModel
            : MANHUA_FACTORY_DEFAULT_VIDEO_MODEL
        ) as CanvasBlock["videoModel"],
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
 * 解析「生成片段/段」目标：`shotIndex` 现为段号（1-based）。
 * 跑该段全部缺图静帧 + 该段一条成片。须在 expand / ensure 之后调用。
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
  const segmentIndex = Math.max(1, Math.floor(shotIndex));
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === ep;
  const keyarts = blocks
    .filter(
      (b) =>
        b.id.startsWith("keyart-") &&
        sameEpisode(b) &&
        resolveSegmentIndexFromShotIndex(resolveKeyartShotIndex(b.id, b.prompt)) ===
          segmentIndex,
    )
    .sort(sortKeyartBlocks);
  const clip =
    blocks
      .filter((b) => b.id.startsWith("clip-") && sameEpisode(b))
      .sort(sortKeyartBlocks)
      .find(
        (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, ep) === segmentIndex,
      ) || undefined;
  if (!keyarts.length) {
    return { targetBlockIds: [], forceFromStage: "keyart" };
  }
  const missingKeyarts = keyarts.filter((k) => !mediaUrlOf(k));
  const primary = keyarts[0]!;
  if (!clip) {
    return {
      targetBlockIds: missingKeyarts.length ? missingKeyarts.map((k) => k.id) : [primary.id],
      forceFromStage: "keyart",
      keyartId: primary.id,
    };
  }
  if (missingKeyarts.length) {
    return {
      targetBlockIds: [...missingKeyarts.map((k) => k.id), clip.id],
      forceFromStage: "keyart",
      keyartId: primary.id,
      clipId: clip.id,
    };
  }
  return {
    targetBlockIds: [clip.id],
    forceFromStage: "clip",
    keyartId: primary.id,
    clipId: clip.id,
  };
}

function stripShotInjectSection(prompt: string): string {
  return stripMarkedSection(String(prompt || ""), "【分镜");
}

/** 本集分镜表预期静帧张数（反推/节拍解析；用于进度分母，避免未展开时显示 1/1） */
export function countExpectedManhuaKeyartShots(
  blocks: CanvasBlock[],
  episodeIndex: number | null | undefined,
): number {
  return resolveShotsForEpisodeKeyarts(blocks, episodeIndex).length;
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
  // 返回分镜列表本身；成段/注水在 ensureManhuaFragmentClips / 工作台侧做
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

/** segmentIndex = 全集连续段号（ep2 首段 = 13） */
function makeSegmentClipId(
  episodeIndex: number | null | undefined,
  segmentIndex: number,
): string {
  const pad = String(Math.max(1, segmentIndex)).padStart(2, "0");
  if (typeof episodeIndex === "number" && episodeIndex >= 1) {
    return makeCanvasBlockId(`clip-e${String(episodeIndex).padStart(2, "0")}-g${pad}`);
  }
  return makeCanvasBlockId(`clip-g${pad}`);
}

function extractArtStyleLockFromPrompt(prompt: string | undefined | null): string {
  const m = String(prompt || "").match(/【(?:画风硬锁|成片画风)】[\s\S]*?(?=\n\n【|\n*$)/);
  return String(m?.[0] || "").trim().replace(/^【画风硬锁】/, "【成片画风】");
}

/** 成片只挂画风一行，不搬静帧侧长锁 */
function extractArtStyleOneLineFromPrompt(prompt: string | undefined | null): string {
  const lock = extractArtStyleLockFromPrompt(prompt);
  if (!lock) {
    if (/CG|漫剧|仿真人/.test(String(prompt || ""))) {
      return "画风：CG 漫剧";
    }
    return "";
  }
  const body = lock
    .replace(/^【[^】]+】\s*/, "")
    .split(/\n/)
    .map((s) => s.trim())
    .find((s) => s.length >= 2);
  return body ? `画风：${body.slice(0, 80)}` : "画风：CG 漫剧";
}

function resolveSegmentPlanForEpisodeClips(
  blocks: CanvasBlock[],
  episodeIndex: number,
  optsPlan?: ManhuaEpisodeSegmentPlan | null,
): ManhuaEpisodeSegmentPlan | null {
  if (optsPlan?.segments?.length) return optsPlan;
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === episodeIndex;
  const blobs = blocks
    .filter(
      (b) =>
        sameEpisode(b) &&
        (b.id.startsWith("beats-") ||
          b.id.startsWith("reverse-") ||
          b.id.startsWith("script-") ||
          b.id.startsWith("story-")),
    )
    .map((b) => String(b.outputText || b.prompt || "").trim())
    .filter(Boolean);
  for (const text of blobs) {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(text);
    if (plan.segments.length >= 1) return plan;
  }
  return null;
}

/**
 * 按「段」铺/对齐成片节点（clip-eXX-gSS）：每段一条成片，parent 绑段内首张静帧。
 * 兼容旧 clip-eXX-sNN（视为段号）。
 */
export function ensureManhuaFragmentClips(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  episodeIndex?: number | null,
  opts?: {
    assetCanon?: ManhuaWriterAssetCanon | null;
    characterSheetUrlById?: Record<string, string> | null;
    registry?: ManhuaAssetLockRegistry | null;
    /** 我的角色/场景垫图职责 → 成片路径不再灌长职责墙 */
    customRefs?: ManhuaCustomAssetRef[] | null;
    /** 十至十二段可拍表：缺镜对白时灌秒轴 */
    segmentPlan?: ManhuaEpisodeSegmentPlan | null;
  },
): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  const ep =
    typeof episodeIndex === "number" && episodeIndex >= 1
      ? episodeIndex
      : getBlockEpisodeIndex(blocks.find((b) => b.id.startsWith("reverse-")) || blocks[0]!) ?? 1;
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === ep;
  const shots = resolveShotsForEpisodeKeyarts(blocks, ep);
  const segments = groupShotsIntoSegments(
    shots.length
      ? shots
      : [{ index: 1, durationSec: 0, cameraZh: "", actionZh: "" } as ManhuaWorkbenchShot],
    { videoModel: MANHUA_FACTORY_DEFAULT_VIDEO_MODEL },
  );

  const keyarts = blocks.filter((b) => b.id.startsWith("keyart-") && sameEpisode(b)).sort(sortKeyartBlocks);
  if (!keyarts.length) return { blocks, edges };

  const keyartByShot = new Map<number, CanvasBlock>();
  for (const keyart of keyarts) {
    const shotIdx = resolveKeyartShotIndex(keyart.id, keyart.prompt);
    if (!keyartByShot.has(shotIdx)) keyartByShot.set(shotIdx, keyart);
  }

  const legacyClip = blocks.find(
    (b) =>
      b.id.startsWith("clip-") &&
      sameEpisode(b) &&
      !/-s\d{2,}(?:-|$)/.test(b.id) &&
      !/-g\d{2,}(?:-|$)/i.test(b.id),
  );
  const existingSegClips = blocks.filter(
    (b) =>
      b.id.startsWith("clip-") &&
      sameEpisode(b) &&
      (/-g\d{2,}(?:-|$)/i.test(b.id) || /-s\d{2,}(?:-|$)/.test(b.id)),
  );
  /** 键 = 全集连续段号；兼容旧集内 g01 重计 */
  const clipBySeg = new Map<number, CanvasBlock>();
  for (const clip of existingSegClips) {
    const local = resolveClipLocalSegmentIndex(clip.id, clip.prompt, ep);
    const globalSeg = manhuaGlobalSegmentIndex(ep, local);
    if (!clipBySeg.has(globalSeg)) clipBySeg.set(globalSeg, clip);
  }
  // 旧整集 clip 只作模板，不直接顶替段级 -g 节点（避免一直 0 条段成片）

  const template =
    existingSegClips[0] ||
    legacyClip ||
    keyarts[0]!;
  const nextExtras: CanvasBlock[] = [];
  const keepSegClipIds = new Set<string>();
  const defaultModel =
    (template.kind === "video" && template.videoModel) || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;

  const lockRegistry =
    opts?.registry ||
    buildManhuaAssetLockRegistry({
      assetCanon: opts?.assetCanon,
      characterSheetUrlById: opts?.characterSheetUrlById,
      customRefs: opts?.customRefs,
    });
  const assetLockBlock = formatManhuaAssetImageBindBlock(lockRegistry);
  const segmentPlan = resolveSegmentPlanForEpisodeClips(blocks, ep, opts?.segmentPlan);

  for (const seg of segments) {
    const segKeyarts = seg.shots
      .map((s) => keyartByShot.get(s.index))
      .filter((k): k is CanvasBlock => Boolean(k));
    if (!segKeyarts.length) continue;
    const primary = segKeyarts[0]!;
    const segUrls = segKeyarts.map((k) => mediaUrlOf(k)).filter(Boolean) as string[];
    const globalSeg = manhuaGlobalSegmentIndex(ep, seg.index);
    const existing = clipBySeg.get(globalSeg);
    const artLock =
      extractArtStyleOneLineFromPrompt(primary.prompt) ||
      extractArtStyleOneLineFromPrompt(template.prompt);
    const continuityAddon = globalSeg >= 2 ? "【连续】承上段末帧脸服场，勿跳棚。" : "";
    const intentZh = String(seg.shots.find((s) => s.intentZh)?.intentZh || "").trim();
    const planBeat = segmentPlan?.segments.find((s) => s.index === seg.index);
    const dialogueLines = planBeat
      ? extractManhuaSegmentDialogueQuotes(planBeat.dialogueZh)
      : [];
    const hydratedShots = hydrateWorkbenchShotsWithSegmentDialogue(
      seg.shots,
      dialogueLines,
      planBeat?.performanceZh,
    );
    const padLockBlock = segUrls.length
      ? `【垫图】本段静帧${segUrls.length}张（出片顺序：上段末帧→资产定妆→本段静帧，按序绑@Image）`
      : "【垫图·缺失】禁止出片";
    const segPrompt = stripManhuaClipForbiddenBoards(
      stripManhuaPromptSlop(
        [
          formatWorkbenchSegmentClipInjectBlock({
            segmentIndex: globalSeg,
            durationSec: seg.durationSec,
            shots: hydratedShots,
            sceneHintZh:
              extractManhuaSceneHintFromPrompt(primary.prompt) ||
              String(planBeat?.sceneZh || "").trim() ||
              undefined,
            intentZh: intentZh || String(planBeat?.intentZh || "").trim() || undefined,
            segmentDialogueLines: dialogueLines,
            segmentPerformanceZh: planBeat?.performanceZh,
          }),
          padLockBlock,
          assetLockBlock,
          continuityAddon,
          artLock,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
    if (existing) {
      // 已有段成片：刷新导戏 prompt（对白锁/@角色），保留已生成成片 URL
      keepSegClipIds.add(existing.id);
      clipBySeg.set(globalSeg, {
        ...existing,
        prompt: segPrompt,
        parentId: primary.id,
        refImageUrl: segUrls[0] || mediaUrlOf(primary) || existing.refImageUrl,
        editFusionUrls: segUrls.slice(1).slice(0, 15),
        videoModel:
          existing.videoModel === "seedance-2.0" ||
          existing.videoModel === "seedance-2.0-fast"
            ? existing.videoModel
            : defaultModel === "seedance-2.0" || defaultModel === "seedance-2.0-fast"
              ? defaultModel
              : MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
      });
      continue;
    }
    const clone: CanvasBlock = {
      ...template,
      kind: "video",
      id: makeSegmentClipId(ep, globalSeg),
      x: primary.x + 220,
      y: primary.y,
      parentId: primary.id,
      prompt: segPrompt,
      status: "idle",
      outputUrl: undefined,
      outputUrls: [],
      outputText: undefined,
      error: undefined,
      manhuaClipQuality: undefined,
      refImageUrl: segUrls[0] || mediaUrlOf(primary) || primary.refImageUrl,
      editFusionUrls: segUrls.slice(1).slice(0, 15),
      videoModel:
        defaultModel === "seedance-2.0" || defaultModel === "seedance-2.0-fast"
          ? defaultModel
          : MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
      aspectRatio: template.aspectRatio || "9:16",
      episodeIndex: ep,
      episodeTitle: primary.episodeTitle || template.episodeTitle,
    };
    nextExtras.push(clone);
    keepSegClipIds.add(clone.id);
    clipBySeg.set(globalSeg, clone);
  }

  const staleClipIds = new Set([
    ...existingSegClips.filter((c) => !keepSegClipIds.has(c.id)).map((c) => c.id),
    // 已铺段级成片后，丢掉无 -g/-s 的旧整集 clip
    ...(legacyClip && keepSegClipIds.size ? [legacyClip.id] : []),
  ]);

  const refreshedById = new Map(
    Array.from(clipBySeg.values()).map((c) => [c.id, c] as const),
  );

  let nextBlocks = [
    ...blocks.filter((b) => !staleClipIds.has(b.id)),
    ...nextExtras,
  ].map((b) => {
    if (!b.id.startsWith("clip-") || !sameEpisode(b) || !keepSegClipIds.has(b.id)) return b;
    const refreshed = refreshedById.get(b.id);
    if (refreshed) return refreshed;
    const localSeg = resolveClipLocalSegmentIndex(b.id, b.prompt, ep);
    const seg = segments.find((s) => s.index === localSeg);
    const segKeyarts = (seg?.shots || [])
      .map((s) => keyartByShot.get(s.index))
      .filter((k): k is CanvasBlock => Boolean(k));
    const primary = segKeyarts[0];
    if (!primary) return b;
    const segUrls = segKeyarts.map((k) => mediaUrlOf(k)).filter(Boolean) as string[];
    return {
      ...b,
      parentId: primary.id,
      refImageUrl: segUrls[0] || mediaUrlOf(primary) || b.refImageUrl,
      editFusionUrls: segUrls.slice(1).slice(0, 15),
      videoModel: b.videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
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
  // 重挂：段内首张 keyart → 该段 clip
  for (const seg of segments) {
    const primary = seg.shots.map((s) => keyartByShot.get(s.index)).find(Boolean);
    const clip = clipBySeg.get(manhuaGlobalSegmentIndex(ep, seg.index));
    if (!primary || !clip) continue;
    nextEdges.push({ fromId: primary.id, toId: clip.id });
  }

  const laid = layoutManhuaEpisodeReadableChain(nextBlocks, ep, {
    assetCanon: opts?.assetCanon,
    characterSheetUrlById: opts?.characterSheetUrlById,
    registry: opts?.registry,
  });
  return { blocks: laid, edges: nextEdges };
}

/** 静帧/成片竖排模块：每列最多几镜（约 13 镜 → 3 列） */
export const MANHUA_LAYOUT_STACK_PER_COL = 5;

function placeManhuaStackColumns(
  items: CanvasBlock[],
  originX: number,
  originY: number,
  gapX: number,
  gapY: number,
  perCol: number,
  pos: Map<string, { x: number; y: number }>,
): { cols: number; rows: number } {
  const n = items.length;
  if (!n) return { cols: 0, rows: 0 };
  const per = Math.max(1, Math.floor(perCol));
  items.forEach((b, i) => {
    const col = Math.floor(i / per);
    const row = i % per;
    pos.set(b.id, { x: originX + col * gapX, y: originY + row * gapY });
  });
  return {
    cols: Math.ceil(n / per),
    rows: Math.min(per, n),
  };
}

/**
 * 画布竖排模块（+顶栏文案）——对标阿硕可读链，不抄品牌：
 * 0 顶栏：故事→设定→节拍→反推
 * 1 角色墙（@角色N，每行最多 4）
 * 2 场景墙（@场景N，分行，不与角色混排）
 * 3 道具墙（弱化一行）
 * 4 静帧：每列最多 5 镜竖排
 * 5 成片：每段约 15s 一卡，同理分列（卡面读秒轴）
 * 只改坐标 + 资产@标，不重生成。
 */
/** 从定妆卡节点收集 wa_char_* → HTTPS，供特写格 @道具 子编号挂图 */
export function collectManhuaCharacterSheetUrlById(
  blocks: CanvasBlock[],
  assetCanon?: ManhuaWriterAssetCanon | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const b of blocks) {
    if (!b.id.startsWith("charsheet-")) continue;
    const url = String(b.outputUrl || b.outputUrls?.[0] || "").trim();
    if (!url) continue;
    const seed = b.id.replace(/^charsheet-/, "");
    map[seed] = url;
    const hit = assetCanon?.characters.find(
      (c) => c.id === seed || b.id.includes(c.id),
    );
    if (hit) map[hit.id] = url;
  }
  return map;
}

export function layoutManhuaEpisodeReadableChain(
  blocks: CanvasBlock[],
  episodeIndex?: number | null,
  opts?: {
    originX?: number;
    originY?: number;
    colGap?: number;
    rowGap?: number;
    stackPerCol?: number;
    assetCanon?: ManhuaWriterAssetCanon | null;
    characterSheetUrlById?: Record<string, string> | null;
    registry?: ManhuaAssetLockRegistry | null;
    /** 透传给 ensure 路径；layout 本身不消费 */
    customRefs?: ManhuaCustomAssetRef[] | null;
  },
): CanvasBlock[] {
  const ep =
    typeof episodeIndex === "number" && episodeIndex >= 1
      ? Math.floor(episodeIndex)
      : getBlockEpisodeIndex(blocks.find((b) => b.id.startsWith("reverse-") || b.id.startsWith("story-")) || blocks[0]!) ??
        1;
  const originX = opts?.originX ?? 60;
  const originY = opts?.originY ?? 60;
  const gapX = opts?.colGap ?? 300;
  const gapY = opts?.rowGap ?? 380;
  const stackPer = opts?.stackPerCol ?? MANHUA_LAYOUT_STACK_PER_COL;
  const assetsPerRow = 4;
  const assetRowGap = Math.round(gapY * 0.72);
  const sameEpisode = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === ep;

  const pick = (prefix: string) =>
    blocks.filter((b) => b.id.startsWith(`${prefix}-`) && sameEpisode(b));

  const textCols = [
    pick("story")[0],
    pick("bible")[0],
    pick("beats")[0],
    pick("reverse")[0],
  ].filter(Boolean) as CanvasBlock[];

  const charWall = blocks
    .filter((b) => b.id.startsWith("charsheet-") && sameEpisode(b))
    .sort((a, b) => a.id.localeCompare(b.id));
  const sceneWall = blocks
    .filter((b) => b.id.startsWith("sceneplate-") && sameEpisode(b))
    .sort((a, b) => a.id.localeCompare(b.id));
  const propWall = blocks
    .filter(
      (b) =>
        sameEpisode(b) &&
        (b.id.startsWith("propplate-") ||
          b.id.startsWith("propsheet-") ||
          b.id.startsWith("prop-")),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  // 无集号孤儿：挂到对应墙末尾，仍分行
  for (const b of blocks) {
    if (getBlockEpisodeIndex(b) != null) continue;
    if (b.id.startsWith("charsheet-") && !charWall.some((x) => x.id === b.id)) {
      charWall.push(b);
    } else if (b.id.startsWith("sceneplate-") && !sceneWall.some((x) => x.id === b.id)) {
      sceneWall.push(b);
    } else if (
      (b.id.startsWith("propplate-") ||
        b.id.startsWith("propsheet-") ||
        b.id.startsWith("prop-")) &&
      !propWall.some((x) => x.id === b.id)
    ) {
      propWall.push(b);
    }
  }

  const keyarts = pick("keyart").sort(sortKeyartBlocks);
  const clips = pick("clip").sort(
    (a, b) =>
      resolveClipSegmentIndex(a.id, a.prompt) - resolveClipSegmentIndex(b.id, b.prompt),
  );

  const hasAssets = charWall.length + sceneWall.length + propWall.length > 0;
  if (!textCols.length && !keyarts.length && !hasAssets) return blocks;

  const pos = new Map<string, { x: number; y: number }>();
  const placeWall = (list: CanvasBlock[], startY: number) => {
    list.forEach((b, i) => {
      const col = i % assetsPerRow;
      const row = Math.floor(i / assetsPerRow);
      pos.set(b.id, {
        x: originX + gapX * col,
        y: startY + row * Math.round(gapY * 0.85),
      });
    });
    const rows = list.length ? Math.ceil(list.length / assetsPerRow) : 0;
    return startY + (rows ? rows * Math.round(gapY * 0.85) + Math.round(assetRowGap * 0.35) : 0);
  };

  const textY = originY;
  textCols.forEach((b, i) => {
    pos.set(b.id, { x: originX + gapX * i, y: textY });
  });
  let cursorY = originY + (textCols.length ? Math.round(gapY * 0.55) : 0);
  cursorY = placeWall(charWall, cursorY);
  cursorY = placeWall(sceneWall, cursorY);
  cursorY = placeWall(propWall, cursorY);
  const keyartY = cursorY;

  const keyStack = placeManhuaStackColumns(
    keyarts,
    originX,
    keyartY,
    gapX,
    gapY,
    stackPer,
    pos,
  );
  const clipY = keyartY + (keyStack.rows ? keyStack.rows * gapY + Math.round(gapY * 0.25) : 0);
  placeManhuaStackColumns(clips, originX, clipY, gapX, gapY, stackPer, pos);

  const positioned = blocks.map((b) => {
    const p = pos.get(b.id);
    return p ? { ...b, x: p.x, y: p.y } : b;
  });
  const sheetUrls =
    opts?.characterSheetUrlById ||
    collectManhuaCharacterSheetUrlById(positioned, opts?.assetCanon);
  // 盖 @角色/@场景/@道具；有系列表时定妆卡特写格再编 @道具N 子号（跨集锁）
  return assignManhuaCanvasAssetAtTags(positioned, {
    registry: opts?.registry,
    assetCanon: opts?.assetCanon,
    characterSheetUrlById: sheetUrls,
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

  // 同镜多节点：优先保留已有产出图的那张，避免补镜时再克隆空节点把已出图挤掉
  const existingByShot = new Map<number, CanvasBlock>();
  for (const keyart of existingKeyarts) {
    const shotIndex = resolveKeyartShotIndex(keyart.id, keyart.prompt);
    const prev = existingByShot.get(shotIndex);
    if (!prev) {
      existingByShot.set(shotIndex, keyart);
      continue;
    }
    const preferNew = mediaUrlOf(keyart) && !mediaUrlOf(prev);
    if (preferNew) existingByShot.set(shotIndex, keyart);
  }

  const keepIds = new Set<string>();
  const extras: CanvasBlock[] = [];
  // 源头短包核：去掉分镜段后复用；旧肥节点若无短包标记，仍 strip 旧分镜以免叠两段分镜
  const basePrompt = primary.prompt.includes("【静帧·源头短包】")
    ? stripManhuaKeyartShotInject(primary.prompt)
    : stripShotInjectSection(primary.prompt);

  for (const shot of shots) {
    const existing = existingByShot.get(shot.index);
    if (existing) {
      keepIds.add(existing.id);
      continue;
    }
    // 只为缺失镜号新建空节点；绝不重造已有镜（会丢掉已出图）
    const pad = String(shot.index).padStart(2, "0");
    extras.push({
      ...primary,
      id: makeCanvasBlockId(
        ep != null ? `keyart-e${String(ep).padStart(2, "0")}-s${pad}` : `keyart-s${pad}`,
      ),
      x: primary.x + Math.min(shot.index, 3) * 28,
      y: primary.y + (shot.index - 1) * 36,
      parentId: reverse.id,
      prompt: attachManhuaKeyartShotInject(basePrompt, shot),
      status: "idle",
      outputUrl: undefined,
      outputUrls: [],
      outputText: undefined,
      error: undefined,
      episodeIndex: primary.episodeIndex ?? ep ?? undefined,
      episodeTitle: primary.episodeTitle,
    });
  }

  const removedIds = new Set(
    existingKeyarts.filter((b) => !keepIds.has(b.id)).map((b) => b.id),
  );

  let nextBlocks = blocks
    .filter((b) => !removedIds.has(b.id))
    .map((b) => {
      if (!b.id.startsWith("keyart-") || !sameEpisode(b) || !keepIds.has(b.id)) return b;
      const shotIdx = resolveKeyartShotIndex(b.id, b.prompt);
      const shot = shots.find((s) => s.index === shotIdx);
      if (!shot) return b;
      const base = b.prompt.includes("【静帧·源头短包】")
        ? stripManhuaKeyartShotInject(b.prompt)
        : stripShotInjectSection(b.prompt);
      // 只更新分镜注入文案，保留 status / outputUrl
      return {
        ...b,
        prompt: attachManhuaKeyartShotInject(base, shot),
      };
    });
  nextBlocks = [...nextBlocks, ...extras];

  let nextEdges = edges.filter(
    (edge) => !removedIds.has(edge.fromId) && !removedIds.has(edge.toId),
  );
  nextEdges = nextEdges.filter(
    (e) => !(e.fromId === reverse.id && e.toId.startsWith("keyart-")),
  );
  const keyartIds = nextBlocks
    .filter((b) => b.id.startsWith("keyart-") && sameEpisode(b))
    .map((b) => b.id);
  nextEdges = [
    ...nextEdges,
    ...keyartIds.map((id) => ({ fromId: reverse.id, toId: id })),
  ];

  return ensureManhuaFragmentClips(nextBlocks, nextEdges, ep ?? 1);
}

export function stageKeyFromBlockId(blockId: string): ManhuaFactoryStageKey | null {
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    if (blockId.startsWith(`${stage}-`)) return stage;
  }
  return null;
}

/** 静帧/成片：有产出 URL 即视为已完成（不依赖 status，避免云同步/中断后 status 不准又重烧） */
function blockHasMediaOutput(block: CanvasBlock): boolean {
  return Boolean(block.outputUrl || (block.outputUrls && block.outputUrls.length));
}

function blockLooksDone(block: CanvasBlock): boolean {
  if (block.kind === "image" || block.kind === "video" || block.id.startsWith("keyart-") || block.id.startsWith("clip-")) {
    return blockHasMediaOutput(block);
  }
  if (block.status === "done") {
    return Boolean(block.outputText?.trim());
  }
  return Boolean(block.outputText?.trim()) && block.status !== "error";
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

function buildEpisodeQualityExpectedContext(opts: {
  shots?: ManhuaWorkbenchShot[];
  keyartPrompt?: string;
  clipPrompt?: string;
  segmentCount?: number;
  durationSec?: number;
}): string {
  const shotBlock =
    opts.shots?.length
      ? opts.shots
          .slice(0, 8)
          .map((s) => formatWorkbenchShotInjectBlock(s))
          .join("\n\n")
      : extractShotInjectSection(opts.keyartPrompt || "") ||
        String(opts.clipPrompt || "").slice(0, 1200);
  const segs = opts.segmentCount ?? MANHUA_SEGMENT_DEFAULT;
  const dur = opts.durationSec ?? segs * manhuaSegmentDurationSec(MANHUA_FACTORY_DEFAULT_VIDEO_MODEL);
  return [
    shotBlock,
    `质检范围：本集约 ${segs} 段、合计约 ${dur} 秒成片抽样。核对画风与参考静帧一致、人物服装连续、无新增可读字幕即可。`,
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
    if (b.id.startsWith("keyart-")) {
      // 源头短包：反推/bible 长文不再叠进静帧（身份靠垫图+短锁，画面靠本镜分镜）
      return b;
    }
    if (b.id.startsWith("clip-")) {
      const epClip = getBlockEpisodeIndex(b) ?? ep ?? 1;
      const localSeg = resolveClipLocalSegmentIndex(b.id, b.prompt, epClip);
      const globalSeg = manhuaGlobalSegmentIndex(epClip, localSeg);
      const segShots = shots.filter(
        (s) => resolveSegmentIndexFromShotIndex(s.index) === localSeg,
      );
      const model = b.videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
      const sceneFromKeyart =
        segShots
          .map((s) =>
            working.find(
              (x) =>
                sameEpisode(x) &&
                x.id.startsWith("keyart-") &&
                resolveKeyartShotIndex(x.id, x.prompt) === s.index,
            ),
          )
          .map((k) => (k ? extractManhuaSceneHintFromPrompt(k.prompt) : ""))
          .find(Boolean) || extractManhuaSceneHintFromPrompt(b.prompt);
      const intentZh = String(segShots.find((s) => s.intentZh)?.intentZh || "").trim();
      const fallbackShot = {
        index: (localSeg - 1) * MANHUA_KEYARTS_PER_SEGMENT_MIN + 1,
        durationSec: 0,
        cameraZh: "",
        actionZh: "",
      } as ManhuaWorkbenchShot;
      const useShots = segShots.length ? segShots : [fallbackShot];
      // 反推回灌秒轴时保留已写的 Image 对照 / 垫图说明，禁止又变回「只有名字」
      const keptAssetBind = (() => {
        const m = String(b.prompt || "").match(
          /【资产·Image对照】[\s\S]*?(?=\n【(?!资产·Image对照)|$)/,
        );
        return m?.[0]?.trim() || "";
      })();
      const keptPad = (() => {
        const m = String(b.prompt || "").match(/【垫图[^\n]*/);
        return m?.[0]?.trim() || "";
      })();
      const keptArt = (() => {
        const m = String(b.prompt || "").match(/^画风：[^\n]+/m);
        return m?.[0]?.trim() || "";
      })();
      return {
        ...b,
        prompt: stripManhuaClipForbiddenBoards(
          stripManhuaPromptSlop(
            [
              formatWorkbenchSegmentClipInjectBlock({
                segmentIndex: globalSeg,
                durationSec: resolveSegmentClipDurationSec(useShots, model),
                shots: useShots,
                sceneHintZh: sceneFromKeyart || undefined,
                intentZh,
              }),
              keptPad,
              keptAssetBind,
              globalSeg >= 2 ? "【连续】承上段末帧脸服场，勿跳棚。" : "",
              keptArt,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        ),
        videoModel: model,
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
  /** 单节点最终失败（含关键静帧批量中的一张） */
  onStageError?: (blockId: string, label: string, message: string) => void;
  onStageSkip?: (blockId: string, label: string) => void;
  onStageRetry?: (blockId: string, label: string, attempt: number, message: string) => void;
  signal?: AbortSignal;
  /** 同集镜间接力 A/B；默认双开 */
  shotContinuity?: {
    keyartFromPrevStill?: boolean;
    clipFromPrevTail?: boolean;
  };
  /**
   * true：覆盖重出本批全部关键静帧（无视已有图）。
   * 默认 false：已有产出图的静帧一律跳过，只补失败/缺失。
   * （forceFromStage 不再强迫已出静帧重烧）
   */
  overwriteKeyarts?: boolean;
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
    // 旧画布缺 videoModel / 仍挂 Omni：一律迁 Seedance Fast（含遗留 omni_edit-*）
    if (
      block.kind === "video" ||
      block.id.startsWith("clip-") ||
      block.id.startsWith("omni_edit-")
    ) {
      const nextModel =
        block.videoModel === "seedance-2.0" || block.videoModel === "seedance-2.0-fast"
          ? block.videoModel
          : MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
      if (nextModel !== block.videoModel) {
        block = { ...block, videoModel: nextModel };
        working = working.map((b) => (b.id === blockId ? block! : b));
        opts.onBlocksChange?.(working);
      }
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
      const overwriteKeyarts = opts.overwriteKeyarts === true;
      const targeted =
        resolvedTargetIds && resolvedTargetIds.length
          ? new Set(resolvedTargetIds.filter((id) => id.startsWith("keyart-")))
          : null;
      while (j < orderedIds.length && orderedIds[j]!.startsWith("keyart-")) {
        const kid = orderedIds[j]!;
        const kb = working.find((b) => b.id === kid);
        if (!kb) {
          j += 1;
          continue;
        }
        // 默认：有图就跳过。仅 overwrite 或显式点名单镜重出时才重烧已出图。
        const mustOverwriteThis =
          overwriteKeyarts || (targeted != null && targeted.has(kid));
        if (skipDone && !mustOverwriteThis && blockLooksDone(kb)) {
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

      // 开跑前闸门：缺垫图的单镜直接失败；若整批都缺则中止，避免同错刷屏
      const padMissingMsg =
        "关键静帧缺少人物/场景参考底图。请到资产设定确认定妆与场景空镜（或上传参考）后再生成。";
      const runnableJobs: KeyartJob[] = [];
      for (const job of jobs) {
        const kb = working.find((b) => b.id === job.id);
        const hasPad =
          Boolean(String(kb?.refImageUrl || "").trim()) ||
          Boolean((kb?.editFusionUrls || []).some(Boolean));
        if (hasPad) {
          runnableJobs.push(job);
          continue;
        }
        publish(
          working.map((b) =>
            b.id === job.id ? { ...b, status: "error" as const, error: padMissingMsg } : b,
          ),
        );
        if (!errors.some((e) => e.id === job.id)) {
          errors.push({ id: job.id, message: padMissingMsg });
        }
        opts.onStageError?.(job.id, MANHUA_FACTORY_STAGE_LABEL_ZH.keyart, padMissingMsg);
      }
      if (!runnableJobs.length) {
        i = j;
        continue;
      }
      // 后续只跑有垫图的镜头
      jobs.length = 0;
      jobs.push(...runnableJobs);

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
      // 进度用「本批静帧张数」；只在单镜真正开跑时回调一次（避免批头+单镜双调闪烁）
      const keyartBatchTotal = jobs.length;

      await mapWithConcurrency(jobs, concurrency, async (job, jobOrdinal) => {
        const kid = job.id;
        const kLabel = MANHUA_FACTORY_STAGE_LABEL_ZH.keyart;
        const localIndex = typeof jobOrdinal === "number" ? jobOrdinal : jobs.findIndex((j) => j.id === kid);
        opts.onStageStart?.(kid, Math.max(0, localIndex), keyartBatchTotal, kLabel);
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
            /** 有垫图/融图就走改图；勿因 imageMode 被 prefs 误标 generate 而清空参考 */
            const padUrl =
              String(current.refImageUrl || "").trim() ||
              String((current.editFusionUrls || []).find(Boolean) || "").trim();
            const fusionKeep = (current.editFusionUrls || [])
              .map((u) => String(u || "").trim())
              .filter((u) => u && u !== padUrl)
              .slice(0, 15);
            let runBlockPayload: CanvasBlock = padUrl
              ? {
                  ...current,
                  imageMode: "edit",
                  refImageUrl: padUrl,
                  editFusionUrls: fusionKeep,
                }
              : { ...current, refImageUrl: undefined, editFusionUrls: [] };
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
              // 批量并行不能拿上一镜静帧作硬底（上一镜可能未完成），
              // 但绝不能清空已有人物/场景融图改成纯文生——会与关键静帧硬锁冲突。
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
            opts.onStageDone?.(kid, Math.max(0, localIndex), keyartBatchTotal, kLabel);
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
          opts.onStageError?.(kid, kLabel, lastMessage);
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
        const { normalizeManhuaShotContinuityPrefs } = await import("@shared/manhuaShotContinuity");
        const shotCont = normalizeManhuaShotContinuityPrefs(opts.shotContinuity);
        // 静帧硬接力已在上方 keyart 并行批次处理；此处串行路径不会再出现 keyart

        // 段成片 ← 上一段成片（末帧/视频参考，全集连续编号：g13←g12）
        if (stage === "clip") {
          const epForSeg = getBlockEpisodeIndex(runBlockPayload) ?? opts.episodeIndex ?? 1;
          const rawSeg = resolveClipSegmentIndex(blockId, runBlockPayload.prompt);
          const localSeg = resolveClipLocalSegmentIndex(blockId, runBlockPayload.prompt, epForSeg);
          let prevClipUrl: string | undefined;
          if (shotCont.clipFromPrevTail && !runBlockPayload.refVideoUrl) {
            prevClipUrl = resolvePreviousSegmentClipUrl(working, epForSeg, rawSeg);
          }
          if (prevClipUrl) {
            const basePrompt = String(runBlockPayload.prompt || "");
            const needCont = !/【连续】|镜头连续性/.test(basePrompt);
            runBlockPayload = {
              ...runBlockPayload,
              refVideoUrl: prevClipUrl,
              prompt: stripManhuaPromptSlop(
                [basePrompt, needCont ? "【连续】承上段末帧脸服场，勿跳棚。" : ""]
                  .filter(Boolean)
                  .join("\n"),
              ),
            };
          }
          // 段内全部静帧作多图参考：图是什么画风，成片就跟什么（不靠猜）
          const segKeyarts = working
            .filter(
              (b) =>
                b.id.startsWith("keyart-") &&
                (getBlockEpisodeIndex(b) ?? 1) === epForSeg &&
                resolveSegmentIndexFromShotIndex(resolveKeyartShotIndex(b.id, b.prompt)) ===
                  localSeg,
            )
            .sort(sortKeyartBlocks);
          const segUrls = segKeyarts.map((b) => mediaUrlOf(b)).filter(Boolean) as string[];
          if (segUrls.length) {
            const artLock = extractArtStyleLockFromPrompt(segKeyarts[0]?.prompt);
            const basePrompt = String(runBlockPayload.prompt || "");
            runBlockPayload = {
              ...runBlockPayload,
              refImageUrl: segUrls[0],
              editFusionUrls: segUrls.slice(1).slice(0, 15),
              prompt:
                artLock &&
                !basePrompt.includes("画风硬锁") &&
                !basePrompt.includes("成片画风")
                  ? `${basePrompt}\n\n${artLock}`
                  : basePrompt,
            };
          }
        }

        const docTexts =
          current.kind === "text" || current.kind === "copy_organize"
            ? await loadCanvasDocumentTexts(collectDocumentAssets(blockId, working, edges))
            : [];
        const texts = [...collectUpstreamTexts(blockId, working, edges), ...docTexts];
        const out = await runCanvasBlock(opts.deps, runBlockPayload, { visionImages, texts });
        let next = working.map((b) =>
          b.id === blockId
            ? {
                ...b,
                status: "done" as const,
                outputText: out.outputText,
                outputUrl: out.outputUrl,
                outputUrls: out.outputUrls ?? (out.outputUrl ? [out.outputUrl] : b.outputUrls),
                lastFrameUrl: out.lastFrameUrl || b.lastFrameUrl,
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

  // 一集一次质检（不按段拦）；单段重出跳过
  const until = opts.untilStage ?? "clip";
  const untilIdx = MANHUA_FACTORY_STAGE_ORDER.indexOf(until);
  const clipStageIdx = MANHUA_FACTORY_STAGE_ORDER.indexOf("clip");
  const isFragmentOnly = Boolean(
    opts.fragmentShotIndex != null || (opts.targetBlockIds && opts.targetBlockIds.length > 0),
  );
  if (
    !opts.signal?.aborted &&
    untilIdx >= clipStageIdx &&
    !isFragmentOnly &&
    (opts.episodeIndex == null || opts.episodeIndex >= 1)
  ) {
    const ep = opts.episodeIndex ?? 1;
    const episodeClips = working
      .filter((b) => b.id.startsWith("clip-") && (getBlockEpisodeIndex(b) ?? 1) === ep)
      .sort(
        (a, b) =>
          resolveClipSegmentIndex(a.id, a.prompt) - resolveClipSegmentIndex(b.id, b.prompt),
      );
    const allReady =
      episodeClips.length > 0 &&
      episodeClips.every((c) => c.status === "done" && Boolean(mediaUrlOf(c)));
    if (allReady) {
      const first = episodeClips[0]!;
      const firstUrl = mediaUrlOf(first);
      const seg0 = resolveClipSegmentIndex(first.id, first.prompt);
      const refKey = working
        .filter(
          (b) =>
            b.id.startsWith("keyart-") &&
            (getBlockEpisodeIndex(b) ?? 1) === ep &&
            resolveSegmentIndexFromShotIndex(resolveKeyartShotIndex(b.id, b.prompt)) === seg0,
        )
        .sort(sortKeyartBlocks)[0];
      const refUrl = mediaUrlOf(refKey);
      if (firstUrl && refUrl) {
        try {
          const shots = resolveShotsForEpisodeKeyarts(working, ep);
          const segs = groupShotsIntoSegments(shots, {
            videoModel: first.videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
          });
          const expectedDurationSec = segs.reduce((s, x) => s + x.durationSec, 0);
          const report = await reviewManhuaClipQuality({
            videoUrl: firstUrl,
            referenceImageUrl: refUrl,
            expectedContext: buildEpisodeQualityExpectedContext({
              shots,
              keyartPrompt: refKey?.prompt,
              clipPrompt: first.prompt,
              segmentCount: segs.length,
              durationSec: expectedDurationSec,
            }),
            attempts: 1,
            sourceKeyartId: refKey?.id,
            expectedDurationSec,
            shotIndex: 1,
          });
          if (report.status !== "passed") {
            const infra = isManhuaClipQualityInfraFailure(report);
            let tip = infra
              ? `整集质检暂不可用：${report.summary}`
              : `整集质检提醒：${report.summary}（成片可播；可点「仍采用」进坞）`;
            if (!infra) {
              try {
                const { formatManhuaRetakeHintZh, suggestManhuaRetakeVariable } =
                  await import("@shared/manhuaDirectingWorkflow");
                tip = `${tip} · ${formatManhuaRetakeHintZh(suggestManhuaRetakeVariable(report.summary), 1, 3)}`;
              } catch {
                /* ignore */
              }
            }
            working = working.map((b) =>
              b.id === first.id
                ? {
                    ...b,
                    manhuaClipQuality: { ...report, userAcceptedDespiteQc: false },
                    error: tip,
                  }
                : b,
            );
          } else {
            working = working.map((b) =>
              b.id.startsWith("clip-") && (getBlockEpisodeIndex(b) ?? 1) === ep
                ? { ...b, manhuaClipQuality: report, error: b.status === "error" ? b.error : undefined }
                : b,
            );
          }
          publish(working);
        } catch {
          /* 整集质检失败不阻断成片 */
        }
      }
    }
  }

  return { blocks: working, completedIds, skippedIds, errors };
}

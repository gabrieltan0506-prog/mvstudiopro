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
import { runCanvasBlock, type CanvasRunDeps } from "./canvasRunBlock";
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
import { CANVAS_DIRECTOR_CRAFT_PROMPT_BLOCK } from "@shared/manhuaWriterRoom";
import {
  buildManhuaCharacterPromptBlock,
  getManhuaArtStylePreset,
  type ManhuaArtStyleId,
} from "@shared/manhuaCharacterAssetLibrary";
import { buildMotionPromptInjectBlock } from "@shared/motionPromptBank";
import { buildCraftShotInjectBlock, recommendCraftShotFromTopic } from "@shared/craftShotBank";
import {
  buildManhuaPreviouslyOnRecap,
  buildManhuaRecapCardImagePrompt,
  shouldAttachManhuaPreviouslyOn,
} from "@shared/manhuaEpisodeRecap";

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

export type SpawnManhuaDramaStudioOpts = {
  originX?: number;
  originY?: number;
  /** 用户题材一句，会写入故事节点 prompt */
  topic?: string;
  /** 编剧剧种：仙侠/古风/都市/校园/末日/科幻/悬疑 */
  genreId?: string;
  /** 单选场景资产 id：scene_01…scene_20（可选，优先于剧种默认场景包） */
  sceneId?: string;
  /** 角色库 id：char_f_* / char_m_*（可多选，注入角色卡） */
  characterIds?: string[];
  /** 角色/场景统一画风 A/B/C */
  artStyleId?: ManhuaArtStyleId | string;
  /** 包装动效库 id：注入微动成片 / 视频改写节点 */
  motionPromptIds?: string[];
  /** 拍摄手法条目 id：注入节拍 / 反推 / 静帧 */
  craftShotIds?: string[];
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
  const characterIds = (opts.characterIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const characterBlock = buildManhuaCharacterPromptBlock(characterIds, {
    artStyleId: opts.artStyleId,
  });
  const motionPromptIds = (opts.motionPromptIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const motionBlock = buildMotionPromptInjectBlock(motionPromptIds);
  let craftShotIds = (opts.craftShotIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!craftShotIds.length) {
    const autoCraft = recommendCraftShotFromTopic(opts.topic).craftShotId;
    if (autoCraft) craftShotIds = [autoCraft];
  }
  const craftShotBlock = buildCraftShotInjectBlock(craftShotIds);
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
  const usePack = Boolean(genreId || sceneId || writerContext || characterBlock || craftShotBlock);
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
    recapCard.imageModel = "nano-banana-2";
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
  story.prompt = storyPrompt;
  story.width = 400;
  story.height = 320;
  story.textModel = "gemini-3.1-pro";
  if (recapCard) story.parentId = recapCard.id;

  const bible = defaultCanvasBlock("text", originX + gapX * (col0 + 1), originY);
  bible.id = makeFactoryStageId("bible", episodeIndex);
  const bibleBase = usePack
    ? buildManhuaStagePromptWithGenre("character_bible", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.character_bible;
  bible.prompt = characterBlock ? `${bibleBase}\n\n${characterBlock}` : bibleBase;
  bible.parentId = story.id;
  bible.textModel = "gemini-3.1-pro";

  const beats = defaultCanvasBlock("text", originX + gapX * (col0 + 2), originY);
  beats.id = makeFactoryStageId("beats", episodeIndex);
  const beatsBase = usePack
    ? buildManhuaStagePromptWithGenre("episode_beats", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats;
  beats.prompt = craftShotBlock ? `${beatsBase}\n\n${craftShotBlock}` : beatsBase;
  beats.parentId = bible.id;
  beats.textModel = "gemini-3.1-pro";

  const reverse = defaultCanvasBlock("video_reverse", originX + gapX * (col0 + 3), originY);
  reverse.id = makeFactoryStageId("reverse", episodeIndex);
  const reverseBase = usePack
    ? buildManhuaStagePromptWithGenre("video_reverse", stageOpts)
    : MANHUA_DRAMA_DEFAULT_PROMPTS.video_reverse;
  reverse.prompt = craftShotBlock ? `${reverseBase}\n\n${craftShotBlock}` : reverseBase;
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
  keyArt.prompt = [keyArtBase, craftShotBlock, artStyleBlock].filter(Boolean).join("\n\n");
  keyArt.parentId = reverse.id;
  keyArt.imageModel = "nano-banana-2";
  keyArt.aspectRatio = "9:16";

  const clip = defaultCanvasBlock("video", originX + gapX * (col0 + 5), originY);
  clip.id = makeFactoryStageId("clip", episodeIndex);
  clip.prompt = motionBlock
    ? `${MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip}\n\n${motionBlock}`
    : MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip;
  clip.parentId = keyArt.id;
  clip.videoModel = "seedance-2.0";
  clip.aspectRatio = "9:16";

  /** Gemini Omni · 自然语言视频改写（GEMINI_API_KEY；可续 previous_interaction_id） */
  const omniEdit = defaultCanvasBlock("video", originX + gapX * (col0 + 6), originY);
  omniEdit.id = makeFactoryStageId("omni_edit", episodeIndex);
  const omniBase =
    "在保留角色身份与主构图的前提下，按自然语言改写上一镜视频：加强微表情与运镜层次，不要重拍成无关场景。";
  omniEdit.prompt = motionBlock ? `${omniBase}\n\n${motionBlock}` : omniBase;
  omniEdit.parentId = clip.id;
  omniEdit.videoModel = "gemini-omni-flash";
  omniEdit.aspectRatio = "9:16";

  const rawBlocks = [recapCard, story, bible, beats, reverse, keyArt, clip, omniEdit].filter(
    Boolean,
  ) as CanvasBlock[];
  const blocks = rawBlocks.map((b) => stampEpisodeMeta(b, episodeIndex, episodeTitle));
  const edges: CanvasEdge[] = [];
  if (recapCard) edges.push({ fromId: recapCard.id, toId: story.id });
  edges.push(
    { fromId: story.id, toId: bible.id },
    { fromId: bible.id, toId: beats.id },
    { fromId: beats.id, toId: reverse.id },
    { fromId: reverse.id, toId: keyArt.id },
    { fromId: keyArt.id, toId: clip.id },
    { fromId: clip.id, toId: omniEdit.id },
  );

  return {
    blocks,
    edges,
    resolvedGenreId: genreId,
    genreInferred: resolved.inferred,
    resolvedSceneId: sceneId,
    characterIds,
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
    const prev = i > 0 ? episodes[i - 1] : undefined;
    const writerContext = String(opts.writerContextForEpisode?.(ep) || "").trim();
    const priorForRecap = episodes.slice(0, i).map((e) => ({
      index: e.index,
      title: e.title,
      body: String(e.body || "").trim(),
      endHook: String(e.endHook || "").trim(),
    }));
    const previouslyOnRecap =
      shouldAttachManhuaPreviouslyOn(ep.index) && priorForRecap.length
        ? buildManhuaPreviouslyOnRecap(priorForRecap)
        : "";
    const spawned = spawnManhuaDramaStudio({
      ...opts,
      originX,
      originY: originY + i * rowGap,
      episodeIndex: ep.index,
      episodeTitle: ep.title,
      endingHook: ep.endHook,
      previousEndingHook: prev?.endHook,
      previouslyOnRecap: previouslyOnRecap || undefined,
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
    sceneId?: string;
    genreId?: string;
    characterIds?: string[];
    artStyleId?: ManhuaArtStyleId | string;
    videoReverseOutputMode?: "zh" | "en" | "compact";
  },
): CanvasBlock[] {
  const craftBlock = buildCraftShotInjectBlock(opts.craftShotIds || []);
  const motionBlock = buildMotionPromptInjectBlock(opts.motionPromptIds || []);
  const characterBlock = buildManhuaCharacterPromptBlock(opts.characterIds || [], {
    artStyleId: opts.artStyleId,
  });
  const artStyle = getManhuaArtStylePreset(opts.artStyleId);
  const artStyleBlock = `【画风硬锁】${artStyle.labelZh}\n${artStyle.promptZh}`;
  const scene = getManhuaSceneTemplate(opts.sceneId);
  const sceneBlock = scene ? composeManhuaScenePromptBlock([scene]) : "";
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
      b.id.startsWith("story-") || b.id.startsWith("bible-") || b.id.startsWith("beats-");

    if (b.id.startsWith("beats-") || b.id.startsWith("reverse-") || b.id.startsWith("keyart-")) {
      let base = stripInjectBlock(b.prompt, "【手法条目库·原子镜头】");
      if (syncGenre) base = stripMarkedSection(base, "【编剧剧种模板");
      if (syncScene) {
        base = stripMarkedSection(base, "【漫剧场景资产库");
        if (b.id.startsWith("keyart-")) {
          base = stripMarkedSection(base, "【本集主场景优先】");
          base = stripMarkedSection(base, "【画风硬锁】");
        }
      }
      const parts = [
        base,
        genreBlock && syncGenre ? genreBlock : "",
        sceneBlock && syncScene ? sceneBlock : "",
        b.id.startsWith("keyart-") && scene
          ? `【本集主场景优先】${scene.nameZh}\n直接吸收其生图提示词与核心元素，角色必须融入场景：\n${scene.promptZh}`
          : "",
        craftBlock,
        b.id.startsWith("keyart-") ? artStyleBlock : "",
      ].filter(Boolean);
      return {
        ...b,
        prompt: parts.join("\n\n"),
        ...(b.id.startsWith("reverse-") ? { videoReverseOutputMode: reverseMode } : {}),
      };
    }
    if (b.id.startsWith("story-") || b.id.startsWith("bible-")) {
      let base = b.prompt;
      if (syncGenre) base = stripMarkedSection(base, "【编剧剧种模板");
      if (b.id.startsWith("story-")) base = stripMarkedSection(base, "【漫剧场景资产库");
      if (b.id.startsWith("bible-")) base = stripMarkedSection(base, "【角色库锚点】");
      const parts = [
        base,
        genreBlock && syncGenre ? genreBlock : "",
        b.id.startsWith("story-") && sceneBlock ? sceneBlock : "",
        b.id.startsWith("bible-") && characterBlock ? characterBlock : "",
      ].filter(Boolean);
      return { ...b, prompt: parts.join("\n\n") };
    }
    if (b.id.startsWith("clip-") || b.id.startsWith("omni_edit-")) {
      const base = stripInjectBlock(b.prompt, "【包装动效手法】");
      return {
        ...b,
        prompt: motionBlock ? `${base}\n\n${motionBlock}` : base,
      };
    }
    return b;
  });
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
    "竖屏电影感关键静帧：主体清晰、角色外形锁定、无字幕、无水印。",
  ]
    .filter(Boolean)
    .join("\n");
  return { keyArtHint, seedanceHint };
}

/** 网关超时 / 瞬时 5xx / abort 等可重试 */
export function isTransientFactoryError(message: string): boolean {
  const m = String(message || "");
  return /abort|timeout|超时|ROUTER_EXTERNAL|ECONNRESET|ETIMEDOUT|502|503|504|网关|稍后重试|算力紧张|rate.?limit|429/i.test(
    m,
  );
}

/**
 * 续跑起点：优先第一个 error；否则第一个未完成（非 done 有产出）。
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
    .trim();
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
  if (!keyArtHint && !seedanceHint && !bibleText) return working;
  return working.map((b) => {
    if (!sameEpisode(b)) return b;
    if (b.id.startsWith("keyart-") && (keyArtHint || bibleText)) {
      // 保留铺节点时写入的场景资产库 / 剧种块，只追加反推与角色卡
      const kept = stripFactoryEnrichSections(b.prompt) || MANHUA_DRAMA_DEFAULT_PROMPTS.key_art;
      const parts = [
        kept,
        keyArtHint ? `【来自编导反推】\n${keyArtHint}` : "",
        bibleText ? `【角色卡锚点】\n${bibleText}` : "",
      ].filter(Boolean);
      return { ...b, prompt: parts.join("\n\n") };
    }
    if (b.id.startsWith("clip-") && seedanceHint) {
      const kept = stripFactoryEnrichSections(b.prompt) || MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip;
      return {
        ...b,
        prompt: `${kept}\n\n【微动优先】\n${seedanceHint}`,
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
}): Promise<ManhuaFactoryPipelineResult> {
  const stopOnError = opts.stopOnError !== false;
  const skipDone = opts.skipDone !== false;
  const defaultMaxRetries = Math.max(0, Math.min(4, opts.maxRetries ?? 2));
  let working = opts.blocks.map((b) => ({ ...b }));
  const edges = opts.edges;
  const orderedIds = resolveManhuaFactoryOrderedIds(
    working,
    opts.untilStage ?? "clip",
    opts.episodeIndex,
  );
  const forceIdx = opts.forceFromStage
    ? MANHUA_FACTORY_STAGE_ORDER.indexOf(opts.forceFromStage)
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

  for (let i = 0; i < orderedIds.length; i++) {
    if (opts.signal?.aborted) {
      errors.push({ id: orderedIds[i]!, message: "已取消" });
      break;
    }
    const blockId = orderedIds[i]!;
    const block = working.find((b) => b.id === blockId);
    if (!block) continue;
    const stage = stageKeyFromBlockId(blockId);
    const label = stage ? MANHUA_FACTORY_STAGE_LABEL_ZH[stage] : blockId;
    const stageIdx = stage ? MANHUA_FACTORY_STAGE_ORDER.indexOf(stage) : i;
    const mustRerun = forceIdx >= 0 && stageIdx >= forceIdx;

    if (skipDone && !mustRerun && blockLooksDone(block)) {
      skippedIds.push(blockId);
      opts.onStageSkip?.(blockId, label);
      continue;
    }

    opts.onStageStart?.(blockId, i, orderedIds.length, label);
    publish(
      working.map((b) =>
        b.id === blockId ? { ...b, status: "running" as const, error: undefined } : b,
      ),
    );

    // 角色卡阶段历史上易 503：多给两次退避；下游 runGeminiScript / 网关会再换 Flash
    const maxRetries = stage === "bible" ? Math.min(5, defaultMaxRetries + 2) : defaultMaxRetries;
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
        const runBlockPayload =
          nearestRef && nearestRef !== current.refImageUrl
            ? { ...current, refImageUrl: nearestRef }
            : current;

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
                error: undefined,
              }
            : b,
        );
        next = enrichDownstreamPrompts(next, blockId);
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
      publish(
        working.map((b) =>
          b.id === blockId ? { ...b, status: "error" as const, error: lastMessage } : b,
        ),
      );
      errors.push({ id: blockId, message: lastMessage });
      if (stopOnError) break;
    }
  }

  return { blocks: working, completedIds, skippedIds, errors };
}

/**
 * 漫剧工厂：一键铺节点 + 顺序自动跑（故事→角色→节拍→反推→静帧→Seedance）
 * 目标：阿硕级「脚本进、成片出」半自动→全自动闭环（本文件为编排核）。
 */

import {
  collectUpstreamTexts,
  collectVisionImages,
  defaultCanvasBlock,
  makeCanvasBlockId,
  resolveNearestUpstreamImageUrl,
  type CanvasBlock,
  type CanvasEdge,
} from "./canvasTypes";
import { runCanvasBlock, type CanvasRunDeps } from "./canvasRunBlock";
import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "@shared/videoReversePrompt";
import {
  buildManhuaStagePromptWithGenre,
  resolveManhuaGenreId,
} from "@shared/screenwriterGenreTemplates";

export type DramaStudioSpawn = {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  /** 实际套用的剧种（含题材自动推断） */
  resolvedGenreId?: string;
  genreInferred?: boolean;
};

/** 漫剧工厂固定阶段顺序（与 spawn id 前缀对齐） */
export const MANHUA_FACTORY_STAGE_ORDER = [
  "story",
  "bible",
  "beats",
  "reverse",
  "keyart",
  "clip",
] as const;

export type ManhuaFactoryStageKey = (typeof MANHUA_FACTORY_STAGE_ORDER)[number];

export const MANHUA_FACTORY_STAGE_LABEL_ZH: Record<ManhuaFactoryStageKey, string> = {
  story: "故事大纲",
  bible: "角色卡",
  beats: "镜头节拍",
  reverse: "编导分镜/反推",
  keyart: "关键静帧",
  clip: "Seedance 成片",
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
};

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
  const sceneId = String(opts.sceneId || "").trim() || undefined;
  const stageOpts = { genreId, sceneId, topic: opts.topic };
  const usePack = Boolean(genreId || sceneId);

  const story = defaultCanvasBlock("text", originX, originY);
  story.id = makeCanvasBlockId("story");
  story.prompt = usePack
    ? buildManhuaStagePromptWithGenre("story_brief", stageOpts)
    : withTopic(MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief, opts.topic);
  story.width = 400;
  story.height = 320;
  story.textModel = "gemini-3.1-pro";

  const bible = defaultCanvasBlock("text", originX + gapX, originY);
  bible.id = makeCanvasBlockId("bible");
  bible.prompt = usePack
    ? buildManhuaStagePromptWithGenre("character_bible", { genreId, sceneId })
    : MANHUA_DRAMA_DEFAULT_PROMPTS.character_bible;
  bible.parentId = story.id;
  bible.textModel = "gemini-3.1-pro";

  const beats = defaultCanvasBlock("text", originX + gapX * 2, originY);
  beats.id = makeCanvasBlockId("beats");
  beats.prompt = usePack
    ? buildManhuaStagePromptWithGenre("episode_beats", { genreId, sceneId })
    : MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats;
  beats.parentId = bible.id;
  beats.textModel = "gemini-3.1-pro";

  const reverse = defaultCanvasBlock("video_reverse", originX + gapX * 3, originY);
  reverse.id = makeCanvasBlockId("reverse");
  reverse.prompt = usePack
    ? buildManhuaStagePromptWithGenre("video_reverse", { genreId, sceneId })
    : MANHUA_DRAMA_DEFAULT_PROMPTS.video_reverse;
  reverse.parentId = beats.id;
  reverse.height = 380;

  const keyArt = defaultCanvasBlock("image", originX + gapX * 4, originY);
  keyArt.id = makeCanvasBlockId("keyart");
  keyArt.prompt = usePack
    ? buildManhuaStagePromptWithGenre("key_art", { genreId, sceneId })
    : MANHUA_DRAMA_DEFAULT_PROMPTS.key_art;
  keyArt.parentId = reverse.id;
  keyArt.imageModel = "nano-banana-2";
  keyArt.aspectRatio = "9:16";

  const clip = defaultCanvasBlock("video", originX + gapX * 5, originY);
  clip.id = makeCanvasBlockId("clip");
  clip.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip;
  clip.parentId = keyArt.id;
  clip.videoModel = "seedance-2.0";
  clip.aspectRatio = "9:16";

  const blocks = [story, bible, beats, reverse, keyArt, clip];
  const edges: CanvasEdge[] = [
    { fromId: story.id, toId: bible.id },
    { fromId: bible.id, toId: beats.id },
    { fromId: beats.id, toId: reverse.id },
    { fromId: reverse.id, toId: keyArt.id },
    { fromId: keyArt.id, toId: clip.id },
  ];

  return {
    blocks,
    edges,
    resolvedGenreId: genreId,
    genreInferred: resolved.inferred,
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

export function resolveManhuaFactoryOrderedIds(
  blocks: CanvasBlock[],
  untilStage: ManhuaFactoryStageKey = "clip",
): string[] {
  const untilIdx = MANHUA_FACTORY_STAGE_ORDER.indexOf(untilStage);
  const ids: string[] = [];
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    if (MANHUA_FACTORY_STAGE_ORDER.indexOf(stage) > untilIdx) break;
    const byToken = blocks.find((b) => b.id.startsWith(`${stage}-`));
    if (byToken && !ids.includes(byToken.id)) ids.push(byToken.id);
  }
  if (ids.length < 2 && blocks.length) {
    const byParent: string[] = [];
    const roots = blocks.filter((b) => !b.parentId || !blocks.some((x) => x.id === b.parentId));
    let curId = roots[0]?.id ?? "";
    const seen = new Set<string>();
    while (curId && !seen.has(curId)) {
      seen.add(curId);
      byParent.push(curId);
      curId = blocks.find((b) => b.parentId === curId)?.id ?? "";
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
  return /abort|timeout|超时|ROUTER_EXTERNAL|ECONNRESET|ETIMEDOUT|502|503|504|网关|稍后重试|rate.?limit|429/i.test(
    m,
  );
}

/**
 * 续跑起点：优先第一个 error；否则第一个未完成（非 done 有产出）。
 * 全完成则返回 null。
 */
export function resolveFactoryResumeStage(blocks: CanvasBlock[]): ManhuaFactoryStageKey | null {
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    const b = blocks.find((x) => x.id.startsWith(`${stage}-`));
    if (!b) return stage;
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
  const md = reverse?.outputText || "";
  const { keyArtHint, seedanceHint } = extractFactoryMotionHints(md);
  const bibleText = String(working.find((b) => b.id.startsWith("bible-"))?.outputText || "")
    .trim()
    .slice(0, 700);
  if (!keyArtHint && !seedanceHint && !bibleText) return working;
  return working.map((b) => {
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
  const maxRetries = Math.max(0, Math.min(4, opts.maxRetries ?? 2));
  let working = opts.blocks.map((b) => ({ ...b }));
  const edges = opts.edges;
  const orderedIds = resolveManhuaFactoryOrderedIds(working, opts.untilStage ?? "clip");
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
        const texts = collectUpstreamTexts(blockId, working, edges);
        const nearestRef =
          current.kind === "image" || current.kind === "video"
            ? current.refImageUrl || resolveNearestUpstreamImageUrl(blockId, working, edges)
            : current.refImageUrl;
        const runBlockPayload =
          nearestRef && nearestRef !== current.refImageUrl
            ? { ...current, refImageUrl: nearestRef }
            : current;

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
          await sleep(1200 * (attempt + 1));
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

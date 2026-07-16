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

export type DramaStudioSpawn = {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
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

  const story = defaultCanvasBlock("text", originX, originY);
  story.id = makeCanvasBlockId("story");
  story.prompt = withTopic(MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief, opts.topic);
  story.width = 400;
  story.height = 320;
  story.textModel = "gemini-3.1-pro";

  const bible = defaultCanvasBlock("text", originX + gapX, originY);
  bible.id = makeCanvasBlockId("bible");
  bible.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.character_bible;
  bible.parentId = story.id;
  bible.textModel = "gemini-3.1-pro";

  const beats = defaultCanvasBlock("text", originX + gapX * 2, originY);
  beats.id = makeCanvasBlockId("beats");
  beats.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats;
  beats.parentId = bible.id;
  beats.textModel = "gemini-3.1-pro";

  const reverse = defaultCanvasBlock("video_reverse", originX + gapX * 3, originY);
  reverse.id = makeCanvasBlockId("reverse");
  reverse.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.video_reverse;
  reverse.parentId = beats.id;
  reverse.height = 380;

  const keyArt = defaultCanvasBlock("image", originX + gapX * 4, originY);
  keyArt.id = makeCanvasBlockId("keyart");
  keyArt.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.key_art;
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

  return { blocks, edges };
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
    let cur = roots[0]?.id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      byParent.push(cur);
      const child = blocks.find((b) => b.parentId === cur);
      cur = child?.id;
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
  const keyArtHint = [
    summary ? `题材摘要：${summary}` : "",
    "竖屏电影感关键静帧：主体清晰、角色外形锁定、无字幕、无水印。",
  ]
    .filter(Boolean)
    .join("\n");
  return { keyArtHint, seedanceHint };
}

function enrichDownstreamPrompts(working: CanvasBlock[], justFinishedId: string): CanvasBlock[] {
  const stage = stageKeyFromBlockId(justFinishedId);
  if (stage !== "reverse") return working;
  const reverse = working.find((b) => b.id === justFinishedId);
  const md = reverse?.outputText || "";
  const { keyArtHint, seedanceHint } = extractFactoryMotionHints(md);
  if (!keyArtHint && !seedanceHint) return working;
  return working.map((b) => {
    if (b.id.startsWith("keyart-") && keyArtHint) {
      const base = MANHUA_DRAMA_DEFAULT_PROMPTS.key_art;
      return {
        ...b,
        prompt: `${base}\n\n【来自编导反推】\n${keyArtHint}`,
      };
    }
    if (b.id.startsWith("clip-") && seedanceHint) {
      return {
        ...b,
        prompt: `${MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip}\n\n【微动优先】\n${seedanceHint}`,
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
  onBlocksChange?: (blocks: CanvasBlock[]) => void;
  onStageStart?: (blockId: string, index: number, total: number, label: string) => void;
  onStageDone?: (blockId: string, index: number, total: number, label: string) => void;
  onStageSkip?: (blockId: string, label: string) => void;
  signal?: AbortSignal;
}): Promise<ManhuaFactoryPipelineResult> {
  const stopOnError = opts.stopOnError !== false;
  const skipDone = opts.skipDone !== false;
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

    try {
      const visionImages = collectVisionImages(blockId, working, edges);
      const texts = collectUpstreamTexts(blockId, working, edges);
      const nearestRef =
        block.kind === "image" || block.kind === "video"
          ? block.refImageUrl || resolveNearestUpstreamImageUrl(blockId, working, edges)
          : block.refImageUrl;
      const runBlockPayload =
        nearestRef && nearestRef !== block.refImageUrl
          ? { ...block, refImageUrl: nearestRef }
          : block;

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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "生成失败";
      publish(
        working.map((b) =>
          b.id === blockId ? { ...b, status: "error" as const, error: message } : b,
        ),
      );
      errors.push({ id: blockId, message });
      if (stopOnError) break;
    }
  }

  return { blocks: working, completedIds, skippedIds, errors };
}

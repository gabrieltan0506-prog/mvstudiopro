/**
 * 漫剧工厂：一键铺节点 + 顺序自动跑（故事→角色→节拍→反推→静帧→Seedance）
 * 借鉴 AI-CanvasPro Story Studio 阶段感，用我们导演中台 + 视频反推增强。
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

export function spawnManhuaDramaStudio(originX = 80, originY = 80): DramaStudioSpawn {
  const gapX = 460;
  const gapY = 0;

  const story = defaultCanvasBlock("text", originX, originY);
  story.id = makeCanvasBlockId("story");
  story.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief;
  story.width = 400;
  story.height = 320;

  const bible = defaultCanvasBlock("text", originX + gapX, originY + gapY);
  bible.id = makeCanvasBlockId("bible");
  bible.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.character_bible;
  bible.parentId = story.id;

  const beats = defaultCanvasBlock("text", originX + gapX * 2, originY);
  beats.id = makeCanvasBlockId("beats");
  beats.prompt = MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats;
  beats.parentId = bible.id;

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

/** 按阶段前缀从当前画布解析执行顺序（缺省阶段跳过） */
export function resolveManhuaFactoryOrderedIds(
  blocks: CanvasBlock[],
  untilStage: ManhuaFactoryStageKey = "clip",
): string[] {
  const untilIdx = MANHUA_FACTORY_STAGE_ORDER.indexOf(untilStage);
  const allowed = new Set(MANHUA_FACTORY_STAGE_ORDER.slice(0, untilIdx + 1));
  const ids: string[] = [];
  for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
    if (!allowed.has(stage)) break;
    // makeCanvasBlockId("story") → `story-<ts>-<rand>`
    const byToken = blocks.find((b) => b.id.startsWith(`${stage}-`));
    if (byToken && !ids.includes(byToken.id)) ids.push(byToken.id);
  }
  // fallback: topological order along parentId chain from first text block
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

export type ManhuaFactoryPipelineResult = {
  blocks: CanvasBlock[];
  completedIds: string[];
  errors: Array<{ id: string; message: string }>;
};

/**
 * 顺序自动跑漫剧工厂：每步用**最新 working snapshot** 收集上游，避免 React 闭包读到旧 output。
 */
export async function runManhuaDramaFactoryPipeline(opts: {
  deps: CanvasRunDeps;
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  /** 跑到哪一阶段（含）；默认到 Seedance */
  untilStage?: ManhuaFactoryStageKey;
  stopOnError?: boolean;
  onBlocksChange?: (blocks: CanvasBlock[]) => void;
  onStageStart?: (blockId: string, index: number, total: number) => void;
  onStageDone?: (blockId: string, index: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<ManhuaFactoryPipelineResult> {
  const stopOnError = opts.stopOnError !== false;
  let working = opts.blocks.map((b) => ({ ...b }));
  const edges = opts.edges;
  const orderedIds = resolveManhuaFactoryOrderedIds(working, opts.untilStage ?? "clip");
  const completedIds: string[] = [];
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

    opts.onStageStart?.(blockId, i, orderedIds.length);
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
      publish(
        working.map((b) =>
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
        ),
      );
      completedIds.push(blockId);
      opts.onStageDone?.(blockId, i, orderedIds.length);
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

  return { blocks: working, completedIds, errors };
}

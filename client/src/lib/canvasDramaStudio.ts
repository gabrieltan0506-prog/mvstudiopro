/**
 * 漫剧工作室：一键铺节点（故事→角色→节拍→反推→静帧→Seedance）
 * 借鉴 AI-CanvasPro Story Studio 阶段感，用我们导演中台 + 视频反推增强。
 */

import {
  defaultCanvasBlock,
  makeCanvasBlockId,
  type CanvasBlock,
  type CanvasEdge,
} from "./canvasTypes";
import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "@shared/videoReversePrompt";

export type DramaStudioSpawn = {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
};

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

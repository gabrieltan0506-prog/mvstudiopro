import {
  canvasMusicMvPlanSchema,
  type CanvasMusicMvPlan,
} from "@shared/canvasMusicMv";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";

/** 计划版本进入节点 ID，重做分镜不覆盖上一版已出片的节点。 */
export function createMusicMvShotBlocks(
  parent: CanvasBlock,
  plan: CanvasMusicMvPlan,
  revision: string,
  references: Array<
    string | { id: string; url: string; gcsUri?: string; fileName: string }
  >
): CanvasBlock[] {
  canvasMusicMvPlanSchema.parse(plan);
  return plan.shots.map((shot, index) => {
    const block = defaultCanvasBlock(
      "video",
      parent.x + parent.width + 60 + (index % 4) * 480,
      parent.y + Math.floor(index / 4) * 560,
      parent.id
    );
    block.id = `mvshot-${parent.id}-${revision}-${index + 1}`;
    block.aspectRatio = parent.aspectRatio;
    block.videoModel = parent.videoModel;
    block.videoResolution = parent.videoResolution;
    // 片段按整秒生成，再由合成精确裁切；不会把整首歌曲伪装为每镜同步参考。
    block.prompt = `目标时长：${Math.max(5, Math.ceil(shot.endSec - shot.startSec))} 秒。\n${shot.visualPrompt}\n运镜：${shot.cameraPrompt}\n歌曲段落：${shot.lyricQuote || "器乐段"}\nMV时间位置：${shot.startSec}–${shot.endSec}秒。后期统一贴入原歌曲。`;
    const referenceImages = shot.referenceIndices.map(i => {
      const reference = references[i];
      if (!reference) throw new Error("分镜引用的图片不存在，请重新确认参考");
      return typeof reference === "string"
        ? { id: `reference-${i}`, url: reference, fileName: `参考图 ${i + 1}` }
        : reference;
    });
    block.musicMvShot = {
      planRequestId: revision,
      audioId: plan.audioId,
      shotId: shot.id,
      startSec: shot.startSec,
      endSec: shot.endSec,
      referenceImages,
    };
    block.refImageUrl = referenceImages[0]?.url;
    block.editFusionUrls = referenceImages.map(row => row.url);
    block.seedance25WorkMode = referenceImages.length
      ? "reference_to_video"
      : "text_to_video";
    return block;
  });
}

export function musicMvReadyClips(
  plan: CanvasMusicMvPlan,
  ids: string[],
  blocks: CanvasBlock[]
) {
  if (ids.length !== plan.shots.length)
    throw new Error("镜头数量与分镜不一致，请重新铺设镜头");
  return plan.shots.map((shot, i) => {
    const block = blocks.find(row => row.id === ids[i]);
    if (!block || block.status !== "done" || !block.outputUrl)
      throw new Error(`镜头 ${i + 1} 尚未出片，不能合成完整 MV`);
    return {
      shotId: shot.id,
      url: block.outputUrl,
      taskId:
        block.musicMvShot?.outputs?.find(
          row => row.url.split("?")[0] === block.outputUrl?.split("?")[0]
        )?.taskId || block.videoTaskId,
    };
  });
}

/** 视频版本与自己的任务号一同保留，手选历史视频后仍能由服务端验主。 */
export function rememberMusicMvOutput(
  block: CanvasBlock,
  url: string | undefined,
  taskId: string | undefined
): Partial<CanvasBlock> {
  if (!block.musicMvShot || !url || !taskId) return {};
  const outputs = block.musicMvShot.outputs || [];
  return {
    musicMvShot: {
      ...block.musicMvShot,
      outputs: [
        ...outputs.filter(row => row.taskId !== taskId || row.url !== url),
        { taskId, url },
      ],
    },
  };
}

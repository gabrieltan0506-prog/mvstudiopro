/**
 * 漫剧合成入队 payload（www→Fly jobs worker）
 * 前台 createJobSameOrigin({ type: "video", input }) 使用。
 */
import type { ManhuaAssembleClipInput } from "./manhuaFinalAssemble";
import type { ManhuaAssembleSegmentRef } from "./manhuaAssembleCompleteness";

export type ManhuaAssembleJobParams = {
  clips: ManhuaAssembleClipInput[];
  /** 最终导出完整性快照；服务端据此硬拒绝试片/半集。 */
  expectedSegments?: ManhuaAssembleSegmentRef[];
  topic?: string;
  seriesTitle?: string;
  logline?: string;
  musicDuration?: number;
  transition?: string;
  resolution?: string;
  musicVolume?: number;
  musicFadeInSec?: number;
  musicFadeOutSec?: number;
  musicUrl?: string;
  musicPrompt?: string;
};

export function buildManhuaAssembleJobInput(params: ManhuaAssembleJobParams): {
  action: "manhua_assemble_final";
  params: ManhuaAssembleJobParams;
} {
  return {
    action: "manhua_assemble_final",
    params: {
      ...params,
      clips: Array.isArray(params.clips) ? params.clips : [],
      transition: params.transition || "fade",
      resolution: params.resolution || "9:16",
    },
  };
}

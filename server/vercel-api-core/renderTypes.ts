import type { ManhuaRenderedSubtitle, ManhuaSubtitleSource } from "../../shared/manhuaRenderedSubtitle.js";
export type RenderTransition = "cut" | "fade";

export interface SceneVideoInput {
  subtitleSource?: ManhuaSubtitleSource;
  subtitleShotIndex?: number;
  sceneIndex?: number;
  url: string;
  duration?: string | number;
  stillImageUrl?: string;
  stillDuration?: string | number;
  voiceUrl?: string;
  includeVoice?: boolean;
  /** 源片裁切入点（秒）；与 trimOutSec 同时有效时 ffmpeg 真裁切 */
  trimInSec?: number;
  trimOutSec?: number;
}

export interface RenderWorkflowInput {
  /** 仅服务端回调；jobs 回执在上传成功后持久化实际字幕表。 */
  onSubtitleTimeline?: (timeline: ManhuaRenderedSubtitle) => void;
  sceneVideos: SceneVideoInput[];
  /** 漫剧合成保留片内对白、音效和环境声；旧独立配音工作流不改变。 */
  preserveSourceAudio?: boolean;
  musicUrl?: string;
  voiceUrl?: string;
  musicStartSec?: number;
  musicEndSec?: number;
  musicVolume?: number;
  voiceVolume?: number;
  musicFadeInSec?: number;
  musicFadeOutSec?: number;
  transition?: RenderTransition | string;
  resolution?: string;
}

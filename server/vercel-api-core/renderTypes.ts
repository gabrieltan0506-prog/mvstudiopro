export type RenderTransition = "cut" | "fade";

export interface SceneVideoInput {
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
  sceneVideos: SceneVideoInput[];
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

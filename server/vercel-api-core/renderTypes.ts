import type { ManhuaRenderedSubtitle, ManhuaSubtitleSource } from "../../shared/manhuaRenderedSubtitle.js";
import type { SongAlignedSubtitle } from "../../shared/songAlignedSubtitle";
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
  /** 1109 MV 演唱镜：模型自带音轨（自己哼唱）会与原唱打架，环境层静音。 */
  muteSourceAudio?: boolean;
}

export interface RenderWorkflowInput {
  /** 仅服务端回调；jobs 回执在上传成功后持久化实际字幕表。 */
  onSubtitleTimeline?: (timeline: ManhuaRenderedSubtitle) => void;
  sceneVideos: SceneVideoInput[];
  /** 漫剧合成保留片内对白、音效和环境声；旧独立配音工作流不改变。 */
  preserveSourceAudio?: boolean;
  /** MV：选定歌曲为主音轨（0 dB），镜头自带声音只作环境层按 sourceAudioGainDb 混入。 */
  musicOnly?: boolean;
  /** musicOnly 时镜头环境层电平（dB，−40～−12，默认 −20）；不变速。 */
  sourceAudioGainDb?: number;
  /** 1109 MV 高光首尾音画同步淡入/淡出（秒）。 */
  videoFadeInSec?: number;
  videoFadeOutSec?: number;
  alignedLyrics?: SongAlignedSubtitle;
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

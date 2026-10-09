import { buildManhuaStageBgmAudio } from "@shared/manhuaPrevisAudio";
import type { ArtMotionSpec, ArtMotionState } from "@shared/artMotion";
import type { CanvasBlock } from "./canvasTypes";

/** 提交与采用均核对当前已采用BGM，防止旧配置覆盖新配乐。 */
export function assertCurrentStageAnimationAudio(clip:CanvasBlock,spec:ArtMotionSpec) {
  if(!clip.audioStudio && !spec.audioTimeline)return;
  if(spec.audioUri)return; // 兼容已有单音轨工程，其来源另由原鉴权链校验。
  const current=buildManhuaStageBgmAudio(clip.audioStudio,spec.duration,clip.previsStudio?.audioStartSec??0,clip.previsStudio?.loopBgm??false);
  if(JSON.stringify(current)!==JSON.stringify(spec.audioTimeline))throw Error("本段已采用配乐或秒位已变化，请回到场景页核对后重新提交");
}

/** 使用已回执动画进入原分段剪辑；保留原视频版本，不伪造视频模型任务。 */
export function adoptStageAnimationAsClip(clip: CanvasBlock, state: ArtMotionState, output: {url:string;gcsUri:string}): CanvasBlock {
  const request=state.request, source=state.spec.stageAnimation;
  if(!source || source.clipId!==clip.id || clip.archivedFromPreviousScript || !request?.jobId || request.status!=="succeeded" || request.gcsUri!==output.gcsUri ||
    JSON.stringify(request.spec)!==JSON.stringify(state.spec) || !/^https:\/\//.test(output.url))
    throw new Error("动画回执、原片段或当前配置不一致，未采用到剪辑");
  assertCurrentStageAnimationAudio(clip,state.spec);
  if(clip.status==="running" || ["queued","running","timed_out_pending_reconcile","reconcile_manual"].includes(clip.videoTaskStatus??"") || clip.previsStudio?.pending)
    throw new Error("原片段仍有在途任务，暂不替换剪辑版本");
  return {...clip,outputUrl:output.url,outputUrls:Array.from(new Set([output.url,clip.outputUrl,...(clip.outputUrls??[])].filter((v):v is string=>Boolean(v)))),status:"done",
    manhuaClipQuality:undefined,lastFrameUrl:undefined,error:undefined,
    uploadedAssets:[...clip.uploadedAssets.filter(a=>a.id!==`stage-animation-${request.id}`),{id:`stage-animation-${request.id}`,url:output.url,previewUrl:output.url,gcsUri:output.gcsUri,fileName:state.spec.title||"本段预演动画",kind:"video",mimeType:"video/mp4"}]};
}

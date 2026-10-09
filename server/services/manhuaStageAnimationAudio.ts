import type { ArtMotionSpec } from "../../shared/artMotion";
import type { ManhuaPrevisRequest } from "../../shared/manhuaPrevis";
import { preparePrevisAudio } from "./manhuaPrevisAudio";
/** 与已验证动作工程同片长，直接复用现有鉴权、精确裁切与混音实现。 */
export async function prepareStageAnimationAudio(spec:ArtMotionSpec,source:ManhuaPrevisRequest,userId:string,root:string,signal:AbortSignal,deps:Parameters<typeof preparePrevisAudio>[4]) {
 if(!spec.audioTimeline)return undefined;
 if(spec.audioUri || spec.audioTimeline.durationSec!==spec.duration || source.spec.durationSec!==spec.duration || spec.audioTimeline.dialogueCount!==0)throw Error("场景动画配乐时序或音轨选择不一致");
 return preparePrevisAudio({...source,audio:spec.audioTimeline},userId,root,signal,deps);
}

import { z } from 'zod';
const vector = (length: number) => z.array(z.number().finite()).length(length);
export const previsAnimationFramesSchema = z.object({
  version: z.literal(1), fps: z.literal(24), width: z.number().int().positive(), height: z.number().int().positive(),
  coordinateSystem: z.literal('stage-z-up-meters'), boundaryZh: z.string().min(1),
  frames: z.array(z.object({frame:z.number().int().positive(),timeSec:z.number().finite().nonnegative(),
    camera:z.object({position:vector(3),quaternionXYZW:vector(4),vfovRad:z.number().finite().positive().max(Math.PI)}).strict(),
    visibleObjectIds:z.array(z.string().min(1)).max(4096),
  }).strict()).min(48).max(720),
}).strict();
export type PrevisAnimationFrames=z.infer<typeof previsAnimationFramesSchema>;
export type PrevisStageAnimation={jobId:string;requestId:string;glbUrl:string;framesUrl:string;sha256:string;framesSha256:string};

export function previsAnimationReceipt(value:unknown,jobId:string) {
  if(!value || typeof value!=="object" || Array.isArray(value) || !/^prv_[a-f0-9]{48}$/.test(jobId))return null;
  const v=value as Record<string,unknown>;
  if(v.glbUrl!==`/api/manhua-previs-media/${jobId}/animation` || v.framesUrl!==`/api/manhua-previs-media/${jobId}/animation-frames`
    || typeof v.sha256!=="string" || !/^[a-f0-9]{64}$/.test(v.sha256)
    || typeof v.framesSha256!=="string" || !/^[a-f0-9]{64}$/.test(v.framesSha256))return null;
  return {glbUrl:v.glbUrl as string,framesUrl:v.framesUrl as string,sha256:v.sha256,framesSha256:v.framesSha256};
}

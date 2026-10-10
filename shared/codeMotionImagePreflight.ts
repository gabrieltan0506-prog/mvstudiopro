import { z } from "zod";
export const codeMotionImageEvidenceSchema=z.object({
  imageId:z.string().uuid(),gcsUri:z.string().regex(/^gs:\/\//),width:z.number().int().positive(),height:z.number().int().positive(),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type CodeMotionImageEvidence=z.infer<typeof codeMotionImageEvidenceSchema>;
export function decideCodeMotionImagePreflight(images:CodeMotionImageEvidence[],orientation:"landscape"|"portrait") {
  const target=orientation==="landscape"?16/9:9/16;
  const reasons=images.flatMap(image=>{
    const reasons:string[]=[];
    if(Math.min(image.width,image.height)<480) reasons.push(`${image.imageId}:原图${image.width}×${image.height}，短边不足480像素`);
    const ratio=image.width/image.height,kept=Math.min(ratio/target,target/ratio);
    if(kept<0.65) reasons.push(`${image.imageId}:原图比例与成片画幅不符，填满画面预计只保留${Math.round(kept*100)}%面积`);
    return reasons;
  });
  return {mode:!images.length?"generate" as const:reasons.length?"edit" as const:"reuse" as const,reasons,semanticAssessment:"not_performed" as const,images};
}

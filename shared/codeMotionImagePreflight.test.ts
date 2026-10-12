import { expect,it } from "vitest";
import { decideCodeMotionImagePreflight } from "./codeMotionImagePreflight";
const image={imageId:"11111111-1111-4111-8111-111111111111",gcsUri:"gs://fixture/photo.png",width:1920,height:1080,bytes:1024,sha256:"a".repeat(64)};
it("preflight distinguishes missing images, reusable originals, low resolution and measured multi-reference aspect conflicts",()=>{
 expect(decideCodeMotionImagePreflight([],"landscape").mode).toBe("generate");
 expect(decideCodeMotionImagePreflight([image],"landscape").mode).toBe("reuse");
 expect(decideCodeMotionImagePreflight([{...image,width:320,height:180}],"landscape").reasons[0]).toContain("不足480");
 const multi=decideCodeMotionImagePreflight([image,{...image,imageId:"22222222-2222-4222-8222-222222222222",width:1080,height:1920}],"landscape");
 expect(multi.mode).toBe("edit");expect(multi.reasons).toHaveLength(1);expect(multi.images).toHaveLength(2);
 expect(multi.semanticAssessment).toBe("not_performed");
});

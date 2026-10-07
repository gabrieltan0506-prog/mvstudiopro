import { expect, it } from "vitest";
import { resolvePostProdInputSources, type PostProdMediaDeps } from "./postProdMediaSource";
import { isBlenderPostProdAction } from "../jobs/workerRole";
import { manhuaVfxCompositionSchema, type ManhuaVfxJob } from "../../shared/manhuaVfx";
it("requires ownership of every overlay image and routes the new renderer as Blender",async()=>{
 const input:ManhuaVfxJob={action:"manhua_vfx",scopeKey:"a",requestId:"12345678-1234-4234-8234-123456789abc",params:{videoUri:"gs://bucket/uploads/u7/source.mp4",sourceKey:"a",composition:{version:1,seed:1,effects:[{id:"image",kind:"image_overlay",imageUri:"gs://bucket/uploads/u7/image.png",startSec:0,durationSec:1,color:"#FFFFFF",scale:.3,intensity:1,anchor:{space:"screen",position:[.5,.5]}}]}}};
 const deps:PostProdMediaDeps={getBucket:()=>"bucket",verifyOwnership:async()=>false,loadSucceededJobOutputObjects:async()=>new Set()};
 expect(await resolvePostProdInputSources({userId:"7",input},deps)).toEqual(input);
 const changed=structuredClone(input);changed.params.composition.effects[0].imageUri="gs://bucket/uploads/u8/image.png";
 await expect(resolvePostProdInputSources({userId:"7",input:changed},deps)).rejects.toThrow("素材尚未登记");
 delete changed.params.composition.effects[0].imageUri;
 expect(manhuaVfxCompositionSchema.safeParse(changed.params.composition).success).toBe(false);
 expect(isBlenderPostProdAction("manhua_vfx")).toBe(true);
});

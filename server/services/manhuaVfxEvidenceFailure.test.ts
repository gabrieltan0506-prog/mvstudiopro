import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderManhuaVfx } from "./manhuaVfxRender";
const input={action:"manhua_vfx",requestId:"11111111-1111-4111-8111-111111111111",scopeKey:"test",params:{videoUri:"gs://offline/source.mp4",sourceKey:"source",composition:{version:1,seed:1,effects:[{id:"fx",kind:"shield",startSec:0,durationSec:1,color:"#FFFFFF",scale:.2,intensity:1,anchor:{space:"screen",position:[.5,.5]}}]}}};
it.each(["rotation","manifest"])("%s拒收前原始与完整解析JSON都永久归档，不提交结果",async failure=>{
 const archived=new Map<string,string>();let rendererCalls=0,resultCalls=0;
 const probe={streams:[{codec_type:"video",width:64,height:64,duration:"1",avg_frame_rate:"12/1",...(failure==="rotation"?{tags:{rotate:"90"}}:{})},{codec_type:"audio",codec_name:"aac"}]};
 await expect(renderManhuaVfx(input,"7",new AbortController().signal,{
  fetch:async(_uri,file)=>{await writeFile(file,"synthetic");return 9;},
  upload:async({objectName,buffer})=>{archived.set(path.basename(objectName),buffer.toString());return {bucket:"offline",objectName,gcsUri:`gs://offline/${objectName}`};},
  runMedia:async()=>({stdout:JSON.stringify(probe),stderr:""}),
  runBlender:async(_command,args)=>{rendererCalls++;await writeFile(path.join(args.at(-1)!,"manifest.json"),JSON.stringify({complete:false,files:[],extraEvidence:[1,2,3]}));return "";},
  uploadResult:async()=>{resultCalls++;throw new Error("must not publish");},
 })).rejects.toThrow("未完成");
 expect(resultCalls).toBe(0);
 expect(JSON.parse(archived.get("source-probe.parsed.json")!)).toEqual(probe);
 if(failure==="rotation")expect(rendererCalls).toBe(0);
 else expect(JSON.parse(archived.get("renderer-manifest.parsed.json")!)).toEqual(JSON.parse(archived.get("renderer-manifest.json")!));
});

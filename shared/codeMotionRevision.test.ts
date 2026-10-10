import { expect,it } from "vitest";
import { codeMotionProjectSchema,compileCodeMotion } from "./codeMotion";
import { reviseCodeMotionProject } from "./codeMotionRevision";

const make=()=>codeMotionProjectSchema.parse({id:"11111111-1111-4111-8111-111111111111",brief:{title:"保持原片",request:"局部文字调整",style:"scenes",duration:20,orientation:"landscape",images:[{id:"44444444-4444-4444-8444-444444444444",name:"原图",gcsUri:`gs://bucket/uploads/u1/code-motion/${"a".repeat(64)}.png`}]},plan:{version:1,summary:"四镜",scenes:Array.from({length:4},(_,i)=>({heading:`标题${i}`,body:`说明${i}`,duration:5,production:{motion:i<2?"natural":"code",imagePrompt:"原画面",videoPrompt:"原动作"},composition:{id:`scene${i}`,duration:5,elements:[{id:`scene${i}-title`,type:"text",text:`标题${i}`},{id:`scene${i}-body`,type:"text",text:`说明${i}`},{id:"ball",type:"shape",shape:"ellipse"},{id:"photo",type:"image",imageId:"44444444-4444-4444-8444-444444444444",width:1,height:1}]}})),codeVideo:{version:1,assets:[0,1].map(i=>({id:`video${i}`,videoUri:`gs://bucket/original${i}.mp4`,sha256:String(i).repeat(64),durationSec:5})),clips:[0,1].map(i=>({assetId:`video${i}`,at:i*5,duration:5}))}}});
const nextId="22222222-2222-4222-8222-222222222222";
it("local revision updates selected visible text, preserves original assets and leaves untouched shots exact",()=>{
 const original=make(),before=JSON.stringify(original);
 const revised=reviseCodeMotionProject(original,nextId,[{index:0,heading:"新标题",body:"新说明",direction:"保留原图调整文字"}]);
 expect(JSON.stringify(original)).toBe(before);
 expect(revised.id).toBe(nextId);
 expect(revised.brief.images).toEqual(original.brief.images);
 expect(revised.plan!.scenes.slice(1)).toEqual(original.plan!.scenes.slice(1));
 expect(revised.plan!.scenes[0].composition!.elements.map(e=>e.type==="text"?e.text:e.id)).toEqual(["新标题","新说明","ball","photo"]);
 expect(revised.plan!.scenes[0].production!.motion).toBe("code");
 expect(revised.plan!.codeVideo!.clips.map(c=>c.assetId)).toEqual(["video1"]);
 expect(revised.plan!.codeVideo!.assets.map(a=>a.id)).toEqual(["video1"]);
 expect(()=>compileCodeMotion(revised.brief,revised.plan)).not.toThrow();
});
it("removes the video container when all generated shots are revised and rejects duplicate/out-of-range edit indexes",()=>{
 const project=make();
 const revised=reviseCodeMotionProject(project,nextId,[0,1].map(index=>({index,heading:"修改",body:""})));
 expect(revised.plan!.codeVideo).toBeUndefined();
 expect(()=>compileCodeMotion(revised.brief,revised.plan)).not.toThrow();
 expect(()=>reviseCodeMotionProject(project,nextId,[{index:5,heading:"无此镜",body:""}])).toThrow("不存在");
 expect(()=>reviseCodeMotionProject(project,nextId,[0,0].map(index=>({index,heading:"重复",body:""})))).toThrow("重复");
});

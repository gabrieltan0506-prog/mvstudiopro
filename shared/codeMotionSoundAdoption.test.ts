import { expect, it } from "vitest";
import { codeMotionProjectSchema, compileCodeMotion } from "./codeMotion";
import { adoptCodeMotionSoundInProject } from "./codeMotionSoundAdoption";

it("replacing an analysed BGM candidate clears only its obsolete timing and preserves reusable audio", () => {
  const source = {id:"22222222-2222-4222-8222-222222222222",name:"配乐1",gcsUri:`gs://bucket/post-prod/1/code-motion/11111111-1111-4111-8111-111111111111/audio/22222222-2222-4222-8222-222222222222/${"a".repeat(64)}.wav`,duration:40,mimeType:"audio/wav" as const,sha256:"a".repeat(64),bytes:100,generated:{kind:"bgm" as const,requestId:"44444444-4444-4444-8444-444444444444"}};
  const project=codeMotionProjectSchema.parse({id:"11111111-1111-4111-8111-111111111111",brief:{title:"原音",request:"配乐",style:"words",duration:20,orientation:"landscape"},plan:{version:1,summary:"四个画面",scenes:Array.from({length:4},(_,i)=>({heading:`镜${i}`,body:"",duration:5}))}});
  const first=adoptCodeMotionSoundInProject(project,source);
  first.plan!.timing={version:1,sourceId:source.id,sourceSha256:source.sha256,method:"manual",review:"confirmed",words:[],beats:[{id:"beat1",at:1,strength:1}]};
  expect(adoptCodeMotionSoundInProject(first,source).plan!.timing).toEqual(first.plan!.timing);
  const second={...source,id:"33333333-3333-4333-8333-333333333333",name:"配乐2",sha256:"b".repeat(64)};
  const replaced=adoptCodeMotionSoundInProject(first,second);
  expect(replaced.plan!.timing).toBeUndefined();
  expect(replaced.brief.audios!.map(a=>a.id)).toEqual([second.id]);
  expect(replaced.plan!.audioTimeline).toHaveLength(1);
  expect(()=>compileCodeMotion(replaced.brief,replaced.plan)).not.toThrow();
  expect(first.plan!.timing).toBeDefined();
});


it("natural-duration draft adopts BGM through actual scene end before saving", () => {
  const project = codeMotionProjectSchema.parse({id:"11111111-1111-4111-8111-111111111111", brief:{title:"自然收尾",request:"随旁白结束",style:"words",duration:30,durationMode:"natural",orientation:"landscape"}, plan:{version:1,summary:"完整句尾",scenes:[{heading:"开场",body:"",duration:15},{heading:"结尾",body:"",duration:20.2}]}});
  project.brief.duration = 30; // Unsaved client draft still displays the requested scale.
  const source = {id:"22222222-2222-4222-8222-222222222222",name:"配乐",gcsUri:"gs://bucket/music.wav",duration:40,mimeType:"audio/wav" as const,sha256:"a".repeat(64),bytes:100,generated:{kind:"bgm" as const,requestId:"44444444-4444-4444-8444-444444444444"}};
  const adopted=adoptCodeMotionSoundInProject(project,source);
  expect(adopted.brief.duration).toBe(35.2);
  expect(adopted.plan!.audioTimeline![0].duration).toBe(35.2);
  expect(compileCodeMotion(adopted.brief,adopted.plan).duration).toBe(35.2);
});

it("dialogue requires an adopted video and matching dialogue track; legacy narration stays code-only", () => {
  const p=codeMotionProjectSchema.parse({id:"11111111-1111-4111-8111-111111111111",brief:{title:"对话",request:"原台词",style:"scenes",duration:20,orientation:"landscape"},plan:{version:1,summary:"四镜",scenes:Array.from({length:4},(_,i)=>({heading:`镜${i}`,body:"",duration:5,composition:{id:`scene${i}`,duration:5,elements:[{id:"text",type:"text",text:"原文"}]},...(i===0?{speech:{text:"一起走吧",voice:"male",role:"dialogue"}}:{})}))}});
  const source={id:"22222222-2222-4222-8222-222222222222",name:"对白",gcsUri:"gs://bucket/dialogue.wav",duration:3,mimeType:"audio/wav" as const,sha256:"a".repeat(64),bytes:100,generated:{kind:"speech" as const,requestId:"44444444-4444-4444-8444-444444444444",sceneIndex:0,text:"一起走吧",voice:"male" as const,role:"dialogue" as const}};
  const adopted=adoptCodeMotionSoundInProject(p,source);
  expect(()=>compileCodeMotion(adopted.brief,adopted.plan)).toThrow("动态镜头");
  adopted.plan!.codeVideo={version:1,assets:[{id:"clip",videoUri:"gs://bucket/clip.mp4",durationSec:5,sha256:"b".repeat(64)}],clips:[{assetId:"clip",at:0,duration:5,sourceStartSec:0,fit:"cover"}]};
  expect(()=>compileCodeMotion(adopted.brief,adopted.plan)).not.toThrow();
  adopted.plan!.audioTimeline![0].role="narration";
  expect(()=>compileCodeMotion(adopted.brief,adopted.plan)).toThrow("配音");
  delete adopted.plan!.scenes[0].speech!.role;
  delete adopted.brief.audios![0].generated!.role;
  delete adopted.plan!.codeVideo;
  expect(()=>compileCodeMotion(adopted.brief,adopted.plan)).not.toThrow();
});

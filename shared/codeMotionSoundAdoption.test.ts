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

import { expect, it } from "vitest";
import { codeMotionProjectSchema, compileCodeMotion } from "./codeMotion";
import { adoptCodeMotionImageInProject } from "./codeMotionImageProduction";
import { planCodeMotionProductionVideo } from "../server/services/codeMotionProductionVideo";
import { codeMotionProductionFingerprint } from "../server/services/codeMotionProductionGrant";

it("adopted scene image reaches the official compiler without deleting original graphic animation or changing production identity", () => {
  const project = codeMotionProjectSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    brief: { title: "灯光", request: "图形展示", style: "scenes", duration: 20, orientation: "landscape", images: [] },
    plan: { version: 1, summary: "灯光变化", scenes: Array.from({ length: 4 }, (_, i) => ({ heading: `镜${i}`,
      production: { motion: "code", imagePrompt: "树林中的球", videoPrompt: "小球滚动" }, body: "", duration: 5,
      composition: { id: `scene${i}`, duration: 5, elements: [{ id: "ball", type: "shape", shape: "ellipse", keyframes: [{ at: 0, x: 0.1 }, { at: 5, x: 0.9 }] }] },
    })) },
  });
  const image = { id: "22222222-2222-4222-8222-222222222222", name: "场景.png", gcsUri: `gs://bucket/uploads/u1/code-motion/${"a".repeat(64)}.png` };
  const adopted = adoptCodeMotionImageInProject(project, { sceneIndex: 1, image });
  expect(project.brief.images).toHaveLength(0);
  expect(adopted.plan!.scenes[1]!.imageId).toBe(image.id);
  const natural = structuredClone(adopted);
  natural.plan!.scenes[1]!.production!.motion = "natural";
  expect(planCodeMotionProductionVideo(natural, "free").find(s => s.sceneIndex === 1)).toMatchObject({ imageUrls: [image.gcsUri], missing: [] });
  expect(() => compileCodeMotion(natural.brief, natural.plan!)).toThrow();
  expect(adopted.plan!.scenes[1]!.composition!.elements[1]).toEqual(project.plan!.scenes[1]!.composition!.elements[0]);
  expect(codeMotionProductionFingerprint(adopted)).toBe(codeMotionProductionFingerprint(project));
  expect(codeMotionProjectSchema.safeParse(adopted).success).toBe(true);
  const spec = compileCodeMotion(adopted.brief, adopted.plan!);
  expect(JSON.stringify(spec)).toContain(image.gcsUri);
  expect(JSON.stringify(spec)).toContain("ball");
});

it("only an explicit redraw receipt replaces a selected card while the original project stays intact",()=>{
  const old={id:"44444444-4444-4444-8444-444444444444",name:"原图",gcsUri:`gs://bucket/uploads/u1/code-motion/${"b".repeat(64)}.png`};
  const project=codeMotionProjectSchema.parse({id:"11111111-1111-4111-8111-111111111111",brief:{title:"原图",request:"修复画幅",style:"cards",duration:20,orientation:"landscape",images:[old]},plan:{version:1,summary:"四镜",scenes:Array.from({length:4},(_,i)=>({heading:`镜${i}`,body:"",duration:5,...(i===0?{imageId:old.id}:{})}))}});
  const image={...old,id:"55555555-5555-4555-8555-555555555555",name:"重绘",gcsUri:`gs://bucket/uploads/u1/code-motion/${"c".repeat(64)}.png`};
  expect(()=>adoptCodeMotionImageInProject(project,{sceneIndex:0,image})).toThrow("已采用其他原图");
  const adopted=adoptCodeMotionImageInProject(project,{sceneIndex:0,image,replacesImageId:old.id});
  expect(adopted.plan!.scenes[0].imageId).toBe(image.id);
  expect(()=>compileCodeMotion(adopted.brief,adopted.plan)).not.toThrow();
  expect(project.brief.images).toEqual([old]);
});

it("scene redraw visibly replaces only its reference layers, retains graphics and preserves original bytes in the unchanged input",()=>{
 const old={id:"44444444-4444-4444-8444-444444444444",name:"原图",gcsUri:`gs://bucket/uploads/u1/code-motion/${"b".repeat(64)}.png`};
 const project=codeMotionProjectSchema.parse({id:"11111111-1111-4111-8111-111111111111",brief:{title:"原图",request:"修复画幅",style:"scenes",duration:20,orientation:"landscape",images:[old]},plan:{version:1,summary:"四镜",scenes:Array.from({length:4},(_,i)=>({heading:`镜${i}`,body:"",duration:5,composition:{id:`scene${i}`,duration:5,elements:[{id:"ball",type:"shape",shape:"ellipse"},...(i===0?[{id:"original",type:"image",imageId:old.id,width:1,height:1}]:[])]}}))}});
 const image={...old,id:"55555555-5555-4555-8555-555555555555",name:"重绘",gcsUri:`gs://bucket/uploads/u1/code-motion/${"c".repeat(64)}.png`};
 const adopted=adoptCodeMotionImageInProject(project,{sceneIndex:0,image,replacesImageId:old.id,replacesImageIds:[old.id]});
 expect(adopted.plan!.scenes[0].composition!.elements.map(e=>e.id)).toEqual(["ink-generated-image-0","ball"]);
 expect(adopted.brief.images).toEqual([image]);expect(project.brief.images).toEqual([old]);
 expect(codeMotionProductionFingerprint(adopted)).toBe(codeMotionProductionFingerprint(project));
 expect(()=>compileCodeMotion(adopted.brief,adopted.plan)).not.toThrow();
});

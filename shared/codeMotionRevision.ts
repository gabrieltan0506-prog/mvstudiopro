import { z } from "zod";
import { codeMotionProjectSchema, type CodeMotionProject } from "./codeMotion";

export const codeMotionRevisionChangeSchema = z.object({
  index:z.number().int().min(0).max(5),
  heading:z.string().trim().min(1).max(48),
  body:z.string().trim().max(100),
  direction:z.string().trim().max(400).optional(),
}).strict();
export type CodeMotionRevisionChange = z.infer<typeof codeMotionRevisionChangeSchema>;

/** A local edit retains owned media and original narration; it never silently requests another model. */
export function reviseCodeMotionProject(
  project: CodeMotionProject,
  newId: string,
  rawChanges: CodeMotionRevisionChange[]
): CodeMotionProject {
  z.string().uuid().parse(newId);
  if (newId === project.id) throw new Error("修改稿须使用新作品编号，原稿保持不变");
  const changes=z.array(codeMotionRevisionChangeSchema).min(1).max(6).parse(rawChanges);
  if (new Set(changes.map(c=>c.index)).size !== changes.length) throw new Error("修改画面不能重复");
  const value=structuredClone(project);
  value.id=newId;
  if (!value.plan) throw new Error("请先打开已有分镜的作品");
  const selected=new Set(changes.map(c=>c.index));
  let at=0;
  const windows=value.plan.scenes.map((s,index)=>{const window={index,start:at,end:at+s.duration};at+=s.duration;return window;}).filter(w=>selected.has(w.index));
  if (windows.length !== changes.length) throw new Error("修改画面不存在，请重新选择");
  for (const change of changes) {
    const scene=value.plan.scenes[change.index];
    const previous={heading:scene.heading,body:scene.body};
    scene.heading=change.heading;
    scene.body=change.body;
    if (change.direction !== undefined) scene.direction=change.direction;
    if (scene.production) {
      const {referenceVideoIds:_references,...production}=scene.production;
      scene.production={...production,motion:"code"};
    }
    if (!scene.composition) continue;
    for (const field of ["heading","body"] as const) {
      const content=change[field],old=previous[field];
      if (content===old) continue;
      const reservedId=`ink-revision-${field}-${change.index}`;
      const exact=scene.composition.elements.find(e=>e.type==="text" && (e.id===reservedId || (!!old && e.text===old)));
      const target=exact ?? scene.composition.elements.find(e=>e.type==="text" && (field==="heading" ? /(?:title|heading)$/i.test(e.id) : /(?:body|subtitle)$/i.test(e.id)));
      if (target?.type==="text") {
        // Keep the node identity for a subsequent scene's carry transition, even when its label is cleared.
        target.text=content || " ";
      } else if (content) {
        scene.composition.elements.push({id:reservedId,type:"text",text:content,fontSize:field==="heading"?0.065:0.04,
          font:"sans",weight:field==="heading"?"bold":"normal",align:"center",maxWidth:0.9,lineHeight:1.2,letterSpacing:0,
          start:0,transform:{x:0.5,y:field==="heading"?0.16:0.84,fill:"#ffffff"},keyframes:[],continuity:"reset",layer:80,blend:"normal"});
      }
    }
  }
  const video=value.plan.codeVideo;
  if (video) {
    const clips=video.clips.filter(c=>!windows.some(w=>c.at<w.end-1e-6 && c.at+c.duration>w.start+1e-6));
    if (!clips.length) delete value.plan.codeVideo;
    else {
      const used=new Set([...clips.map(c=>c.assetId),...value.plan.scenes.flatMap(s=>s.production?.referenceVideoIds||[])]);
      value.plan.codeVideo={...video,clips,assets:video.assets.filter(a=>used.has(a.id))};
    }
  }
  return codeMotionProjectSchema.parse(value);
}

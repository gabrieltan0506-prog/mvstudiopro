import type { CodeMotionProject } from "./codeMotion";
import { codeMotionPlanElementSchema, codeMotionPlanSceneSchema } from "./codeMotionComposition";

export const CODE_MOTION_EFFECTS = [
  { id: "fade", label: "柔和淡入" },
  { id: "slideLeft", label: "向左滑动" },
  { id: "wipe", label: "擦拭转场" },
  { id: "zoom", label: "推进转场" },
  { id: "drift", label: "漂浮粒子" },
  { id: "burst", label: "扩散粒子" },
  { id: "orbit", label: "环绕粒子" },
  { id: "geometry", label: "空间几何转动" },
] as const;
export type CodeMotionEffect = (typeof CODE_MOTION_EFFECTS)[number]["id"];

/** Writes the same composition schema consumed by both preview and formal rendering. */
export function applyCodeMotionEffect(
  project: CodeMotionProject,
  effect: CodeMotionEffect
): CodeMotionProject {
  if (!project.plan || project.brief.style !== "scenes")
    throw Error("请先整理逐镜创作，再采用特效");
  let at = 0,
    changed = 0;
  const scenes = project.plan.scenes.map(scene => {
    const start = at;
    at += scene.duration;
    const coveredByVideo = project.plan!.codeVideo?.clips.some(
      c => c.at < at && c.at + c.duration > start
    );
    if (!scene.composition || coveredByVideo) return scene;
    changed++;
    const composition = structuredClone(scene.composition);
    if (effect === "fade" || effect === "slideLeft" || effect === "wipe" || effect === "zoom") {
      composition.transition = {
        type: effect,
        duration: Math.min(0.35, scene.duration / 2),
      };
    } else {
      composition.elements = composition.elements.filter(
        e => e.id !== "ink-menu-effect"
      );
      composition.elements.push(
        effect === "geometry"
          ? codeMotionPlanElementSchema.parse({
              id: "ink-menu-effect",
              type: "mesh",
              geometry: "octahedron",
              width: 0.25,
              height: 0.25,
              depth: 0.25,
              transform: { x: 0.8, y: 0.25, fill: "#df9969" },
              keyframes: [
                { at: 0, rotationY: 0 },
                { at: scene.duration, rotationY: 180 },
              ],
            })
          : codeMotionPlanElementSchema.parse({
              id: "ink-menu-effect",
              type: "particles",
              motion: effect,
              count: 60,
              seed: 41,
              spread: 0.7,
              speed: 0.12,
              size: 0.004,
              transform: { x: 0.5, y: 0.5, fill: "#df9969" },
              keyframes: [],
            })
      );
    }
    return {
      ...scene,
      composition: codeMotionPlanSceneSchema.parse(composition),
    };
  });
  if (!changed)
    throw Error(
      "当前镜头由原片覆盖，没有可采用代码特效的镜头；可在逐镜设置中修改原片"
    );
  return { ...project, plan: { ...project.plan, scenes } };
}

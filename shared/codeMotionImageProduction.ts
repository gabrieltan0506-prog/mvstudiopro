import { z } from "zod";
import type { CodeMotionProject } from "./codeMotion";
import { canvasImageCredits } from "./canvasGenerationPricing";

export const codeMotionImageContextSchema = z
  .object({
    projectId: z.string().uuid(),
    grantId: z.string().min(1).max(128),
    kind: z.literal("image"),
    index: z.number().int().min(0).max(5),
    requestId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type CodeMotionImageContext = z.infer<
  typeof codeMotionImageContextSchema
>;
export const CODE_MOTION_IMAGE_MODELS = {
  free: "gpt-image-2-2026-04-21",
  paid: "gpt-image-2.5-sunburst",
} as const;
export function codeMotionImagePolicy(tier: "free" | "paid", index: number) {
  return {
    model: CODE_MOTION_IMAGE_MODELS[tier],
    quality: tier === "free" ? ("medium" as const) : ("high" as const),
    credits: tier === "free" ? 0 : canvasImageCredits(index),
  };
}
/** No second planner or paid model: use the reviewed, saved shot descriptions verbatim. */
export function codeMotionImagePrompts(project: CodeMotionProject) {
  if (!project.plan || !["scenes", "cards"].includes(project.brief.style))
    throw new Error("请先保存逐镜创作或图文介绍的画面安排");
  if (project.plan.scenes.length < 4 || project.plan.scenes.length > 6)
    throw new Error("场景图生产需要先安排 4–6 个画面");
  return project.plan.scenes.map((scene, index) => ({
    index,
    name: `画面${index + 1} · ${scene.heading}`.slice(0, 160),
    prompt: [
      `为以下视频制作第 ${index + 1}/${project.plan!.scenes.length} 张完整场景图。`,
      `主题：${project.brief.title}。创作要求：${project.brief.request}`,
      `本镜：${scene.heading}。${scene.body}`,
      (scene as typeof scene & { production?: { imagePrompt?: string } })
        .production?.imagePrompt || "",
      scene.direction ? `画面、动作与构图：${scene.direction}` : "",
      "保持全片人物、物件、画风和场景身份一致。单幅场景，不做拼贴或多格漫画。不要文字、字幕、标签或水印，文字由成片代码绘制。",
    ]
      .filter(Boolean)
      .join("\n"),
  }));
}

/** Selecting a generated background preserves the user's original text, shapes and image layers. */
export function adoptCodeMotionImageInProject(
  project: CodeMotionProject,
  source: {
    sceneIndex: number;
    image: CodeMotionProject["brief"]["images"][number];
    replacesImageId?:string;
    replacesImageIds?:string[];
  }
): CodeMotionProject {
  const value = structuredClone(project);
  const scene = value.plan?.scenes[source.sceneIndex];
  if (!scene) throw new Error("原画面已经改变，图片保留在原批次中");
  if (value.brief.style === "scenes") {
    if (!scene.composition) throw new Error("此镜没有画面编排，请先恢复原分镜");
    scene.imageId = source.image.id;
    const id = `ink-generated-image-${source.sceneIndex}`;
    const existing = scene.composition.elements.find(e => e.id === id);
    scene.composition.elements = scene.composition.elements.filter(
      e => e.id !== id && !(e.type==="image" && source.replacesImageIds?.includes(e.imageId))
    );
    scene.composition.elements.unshift({
      id,
      type: "image",
      imageId: source.image.id,
      width: 1,
      height: 1,
      fit: "cover",
      start: 0,
      continuity: "reset",
      transform: { x: 0.5, y: 0.5 },
      keyframes: [],
      blend: "normal",
      layer: -100,
    });
    // Only a previously selected generated background may be deselected. The batch keeps its bytes.
    if (
      existing?.type === "image" &&
      existing.imageId !== source.image.id &&
      !value.plan!.scenes.some(
        s =>
          s.imageId === existing.imageId ||
          s.composition?.elements.some(
            e => e.type === "image" && e.imageId === existing.imageId
          )
      )
    ) {
      value.brief.images = value.brief.images.filter(
        i => i.id !== existing.imageId
      );
    }
  } else if (value.brief.style === "cards") {
    if (scene.imageId && scene.imageId !== source.image.id && scene.imageId!==source.replacesImageId)
      throw new Error("此镜已采用其他原图，请先调整该镜图片安排；原图未移除");
    const previous=scene.imageId;
    scene.imageId = source.image.id;
    // The immutable batch still records the original bytes; only this selected card changes.
    if(previous && previous!==source.image.id && !value.plan!.scenes.some(s=>s.imageId===previous))
      value.brief.images=value.brief.images.filter(i=>i.id!==previous);
  } else throw new Error("场景图只能用于逐镜创作或图文介绍");
  // Redraw substitutes the selected image layers; original bytes remain in the immutable batch's preflight evidence.
  if(source.replacesImageIds?.length) value.brief.images=value.brief.images.filter(image=>
    !source.replacesImageIds!.includes(image.id) || value.plan!.scenes.some(s=>s.imageId===image.id || s.composition?.elements.some(e=>e.type==="image"&&e.imageId===image.id)));
  if (!value.brief.images.some(i => i.id === source.image.id))
    value.brief.images.push(source.image);
  if (value.brief.images.length > 8)
    throw new Error("已选图片超过 8 张，请先调整不用的素材；原作品未修改");
  return value;
}

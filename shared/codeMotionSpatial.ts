import { z } from "zod";
import type { CodeMotionProject } from "./codeMotion";

export const CODE_MOTION_SPATIAL_MAX_BYTES = 250 * 1024 * 1024;

/** 三维源文件、参考帧和成片视频分开保存，参考帧不进入代码画面。 */
export const codeMotionSpatialAssetSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["glb", "spz"]),
    name: z.string().min(1).max(160),
    gcsUri: z
      .string()
      .regex(/^gs:\/\/[^\s?#]+$/)
      .max(2048),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(CODE_MOTION_SPATIAL_MAX_BYTES),
  })
  .strict();
const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const codeMotionSpatialFrameSchema = z
  .object({
    id: z.string().uuid(),
    sceneIndex: z.number().int().min(0).max(11),
    sceneDigest: z.string().regex(/^[a-f0-9]{64}$/),
    image: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160),
        gcsUri: z.string().max(2048),
      })
      .strict(),
    worldId: z.string().regex(/^[a-f0-9]{64}$/),
    referenceImageIds: z.array(z.string().uuid()).max(8).optional(),
    actors: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            assetId: z.string().regex(/^[a-f0-9]{64}$/),
            stagePoint: z.tuple([z.number().finite(), z.number().finite()]),
            heightM: z.number().positive().max(100),
            yawDeg: z.number().finite(),
          })
          .strict()
      )
      .max(8),
    metricScaleFactor: z.number().finite().positive().max(10000),
    groundPlaneOffset: z.number().finite(),
    camera: z
      .object({
        position: vector,
        target: vector,
        lens: z.number().positive().max(1000),
        kind: z.enum(["establish", "ots", "single"]),
        labelZh: z.string().max(100),
      })
      .strict(),
    revision: z.string().min(1).max(200),
    viewLabelZh: z.string().min(1).max(100),
  })
  .strict();
export const codeMotionSpatialSchema = z
  .object({
    assets: z.array(codeMotionSpatialAssetSchema).max(12),
    frames: z.array(codeMotionSpatialFrameSchema).max(12),
  })
  .strict();
export type CodeMotionSpatial = z.infer<typeof codeMotionSpatialSchema>;

/** 保存三维视角即选择模型镜头，但不创建任务或改变已确认的镜长。 */
export function prepareCodeMotionSpatialScene(
  project: CodeMotionProject,
  sceneIndex: number
): CodeMotionProject {
  const scene = project.plan?.scenes[sceneIndex];
  const maximum = project.brief.generationTier === "free" ? 5 : 30;
  if (
    !scene ||
    !Number.isInteger(scene.duration) ||
    scene.duration < 4 ||
    scene.duration > maximum
  )
    throw new Error(
      `三维参考交给视频模型的镜头须为4–${maximum}整秒，请先调整本镜时长`
    );
  return {
    ...project,
    plan: {
      ...project.plan!,
      scenes: project.plan!.scenes.map((value, index) =>
        index === sceneIndex
          ? {
              ...value,
              production: {
                ...value.production,
                imagePrompt:
                  value.production?.imagePrompt ||
                  [value.heading, value.body, value.direction]
                    .filter(Boolean)
                    .join("\n")
                    .slice(0, 2000),
                videoPrompt:
                  value.production?.videoPrompt ||
                  value.direction ||
                  value.body,
                motion: "natural" as const,
              },
            }
          : value
      ),
    },
  };
}

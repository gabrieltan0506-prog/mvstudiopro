import { z } from "zod";
import { evaluateManhuaWorld3dEligibility, type ManhuaWorld3dCandidate } from "./manhuaWorld3d";

/** 只传当前作品里已确认的场景版本；下载地址由服务端任务回执解析。 */
export const manhuaVfxEnvironmentSchema = z.object({
  worldTaskId: z.string().regex(/^mw_[a-f0-9]{24}$/),
  sceneRef: z.string().min(1).max(160),
  sourceVersion: z.string().min(1).max(4096),
}).strict();
export type ManhuaVfxEnvironment = z.infer<typeof manhuaVfxEnvironmentSchema>;
export type ManhuaVfxEnvironmentOption = ManhuaVfxEnvironment & { label: string; thumbnail?: string };

export function manhuaVfxEnvironmentOptions(refs: Array<ManhuaWorld3dCandidate & { id: string; labelZh?: string }>): ManhuaVfxEnvironmentOption[] {
  return refs.flatMap(ref => {
    const eligible = evaluateManhuaWorld3dEligibility(ref), world = eligible.currentWorld3d;
    if (!eligible.eligible || world?.status !== "succeeded" || !world.assets?.spz500kGcsUri ||
      !world.assets.colliderGlbGcsUri || !(Number(world.assets.metricScaleFactor) > 0) ||
      !Number.isFinite(world.assets.groundPlaneOffset)) return [];
    const parsed = manhuaVfxEnvironmentSchema.safeParse({ worldTaskId: world.taskId, sceneRef: ref.id, sourceVersion: world.sourceVersion });
    return parsed.success ? [{ ...parsed.data, label: ref.labelZh || ref.id, thumbnail: ref.url }] : [];
  });
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { manhuaVfxJobSchema, type ManhuaVfxJob } from "../../shared/manhuaVfx";
import { manhuaVfxEnvironmentSchema, type ManhuaVfxEnvironment } from "../../shared/manhuaVfxEnvironment";
import { getManhuaWorldTask } from "./manhuaWorldTask";
import { getGcsBucketName } from "./gcs";
import { readArtMotionArchive, writeArtMotionArchive } from "./artMotionArchive";

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}
export const vfxEnvironmentSourceSchema = z.object({
  taskId: z.string(), sceneRef: z.string(), sourceVersion: z.string(), status: z.literal("succeeded"),
  assets: z.object({ spz500kGcsUri: z.string(), colliderGlbGcsUri: z.string(),
    metricScaleFactor: z.number().finite().positive(), groundPlaneOffset: z.number().finite(),
  }).strict(),
}).strict();
export type VfxEnvironmentSource = z.infer<typeof vfxEnvironmentSourceSchema>;
function checkSource(raw: unknown, binding: ManhuaVfxEnvironment, userId: string, bucket: string) {
  const source = vfxEnvironmentSourceSchema.parse(raw);
  const prefix = `gs://${bucket}/manhua-world/u${userId}/${binding.worldTaskId}/`;
  if (source.taskId !== binding.worldTaskId || source.sceneRef !== binding.sceneRef || source.sourceVersion !== binding.sourceVersion ||
    source.assets.spz500kGcsUri !== prefix + "scene-500k.spz" || source.assets.colliderGlbGcsUri !== prefix + "collider.glb")
    throw new Error("正式场景归属、版本或归档地址不一致");
  return source;
}
export async function resolveVfxEnvironment(userId: string, raw: unknown,
  deps = { load: getManhuaWorldTask, bucket: getGcsBucketName }): Promise<VfxEnvironmentSource> {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("场景账号无效");
  const binding = manhuaVfxEnvironmentSchema.parse(raw), world = await deps.load(binding.worldTaskId, Number(userId));
  if (!world) throw new Error("本人正式场景不存在或已删除");
  const assets = world.assets;
  return checkSource({ taskId: world.taskId, sceneRef: world.sceneRef, sourceVersion: world.sourceVersion, status: world.status,
    assets: assets && { spz500kGcsUri: assets.spz500kGcsUri, colliderGlbGcsUri: assets.colliderGlbGcsUri,
      metricScaleFactor: assets.metricScaleFactor, groundPlaneOffset: assets.groundPlaneOffset } }, binding, userId, deps.bucket());
}
const envelope = z.object({ version: z.literal(1), userId: z.string(), requestId: z.string().uuid(), effectId: z.string(),
  inputSha256: z.string(), sourceSha256: z.string(), source: vfxEnvironmentSourceSchema }).strict();
function key(userId: string, input: ManhuaVfxJob, effectId: string) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("场景账号无效");
  return `post-prod/${userId}/vfx-inputs/${input.requestId}/world-${sha(effectId)}.json`;
}
/** 网站入队前封存；无需把网站卷、凭证或可变任务状态复制到工作机。 */
export async function archiveVfxEnvironment(userId: string, raw: ManhuaVfxJob, effectId: string,
  deps = { resolve: resolveVfxEnvironment, write: writeArtMotionArchive }) {
  const input = manhuaVfxJobSchema.parse(raw), effect = input.params.composition.effects.find(item => item.id === effectId);
  if (!effect?.world?.environment) throw new Error("本次特效没有正式场景绑定");
  const source = await deps.resolve(userId, effect.world.environment);
  const body = envelope.parse({ version: 1, userId, requestId: input.requestId, effectId, inputSha256: sha(input), sourceSha256: sha(source), source });
  await deps.write(key(userId, input, effectId), Buffer.from(JSON.stringify(body)));
}
export async function readVfxEnvironment(userId: string, raw: ManhuaVfxJob, effectId: string,
  deps = { read: readArtMotionArchive, bucket: getGcsBucketName }) {
  const input = manhuaVfxJobSchema.parse(raw), binding = input.params.composition.effects.find(item => item.id === effectId)?.world?.environment;
  if (!binding) throw new Error("本次特效没有正式场景绑定");
  const snapshot = envelope.parse(JSON.parse((await deps.read(key(userId, input, effectId), 64 * 1024)).toString()));
  if (snapshot.userId !== userId || snapshot.requestId !== input.requestId || snapshot.effectId !== effectId ||
    snapshot.inputSha256 !== sha(input) || snapshot.sourceSha256 !== sha(snapshot.source)) throw new Error("正式场景快照与本次不可变特效请求不一致");
  return checkSource(snapshot.source, binding, userId, deps.bucket());
}

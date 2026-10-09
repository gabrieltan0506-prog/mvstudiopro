import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getJobByIdStrict } from "../jobs/repository";
import { resolveManhuaPrevisMedia } from "./manhuaPrevisMedia";
import { fetchPostProdSourceToFile } from "./postProduction";
import { manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import { manhuaVfxBulletSchema } from "../../shared/manhuaVfxPixelParameters";

type Bullet = z.infer<typeof manhuaVfxBulletSchema>;
type SceneJob = Parameters<typeof resolveManhuaPrevisMedia>[0];
const MAX_SCENE_BYTES = 512 * 1024 * 1024;
export async function resolveManhuaVfxSceneSource(bullet: Bullet, userId: string, load: (id: string) => Promise<SceneJob> = getJobByIdStrict) {
  const sceneJob = await load(bullet.sceneJobId);
  const source = resolveManhuaPrevisMedia(sceneJob, Number(userId), "scene");
  const input = sceneJob?.input as { params?: unknown } | undefined;
  const request = manhuaPrevisRequestSchema.safeParse(input?.params);
  const output = sceneJob?.output as { sceneSha256?: unknown } | undefined;
  if (!source || !request.success || request.data.scopeId !== bullet.sceneScopeId || request.data.clipId !== bullet.clipId || typeof output?.sceneSha256 !== "string")
    throw new Error("三维场景不属于所选作品片段，或成功回执未闭合");
  if (bullet.freezeSec >= request.data.spec.durationSec) throw new Error("冻结秒位超出源三维场景");
  return { ...source, sha256: output.sceneSha256, sourceRequestId: request.data.requestId, sourceScopeId: request.data.scopeId, sourceClipId: request.data.clipId, durationSec: request.data.spec.durationSec };
}

/** 场景只能来自本人已成功的固定预演产物；客户端不能传路径、URL或任意blend。 */
export async function prepareManhuaVfxScene(bullet: Bullet, effectId: string, userId: string, root: string, signal: AbortSignal,
  deps = { load: getJobByIdStrict as (id: string) => Promise<SceneJob>, fetch: fetchPostProdSourceToFile }) {
  const source = await resolveManhuaVfxSceneSource(bullet, userId, deps.load);
  signal.throwIfAborted();
  const dir = path.join(root, "scenes"); await mkdir(dir, { recursive: true });
  const scenePath = path.join(dir, `scene-${effectId}.blend`);
  await deps.fetch(source.gcsUri, scenePath, { signal, budget: { remainingBytes: MAX_SCENE_BYTES } });
  const info = await stat(scenePath);
  if (info.size < 1000 || info.size > MAX_SCENE_BYTES) throw new Error("三维场景为空或超过512MiB预算");
  const bytes = await readFile(scenePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.subarray(0, 7).toString() !== "BLENDER" || sha256 !== source.sha256) throw new Error("三维场景内容或SHA已变化，未开始环绕渲染");
  signal.throwIfAborted();
  return { scenePath, sceneSha256: sha256, receipt: { ...source, bytes: info.size } };
}

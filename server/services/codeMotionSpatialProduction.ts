import { createHash } from "node:crypto";
import { z } from "zod";
import {
  codeMotionSpatialProductionInputSchema,
  CODE_MOTION_3D_COST_NOTICE,
  type CodeMotionSpatialProductionInput,
} from "../../shared/codeMotionSpatialProduction";
import {
  codeMotionStorage,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import { createManhua3dTask, getManhua3dTask } from "./manhua3dTask";
import { createManhuaWorldTask, getManhuaWorldTask } from "./manhuaWorldTask";
import { assertCodeMotionImageSource } from "./codeMotionImport";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { signGsUriV4ReadUrl } from "./gcs";
import {
  spatialPrefix,
  writeSpatialRecord,
  importCodeMotionSpatialAsset,
  spatialImportDeps,
} from "./codeMotionSpatial";

const sourceSchema = z
  .object({ id: z.string().uuid(), name: z.string(), gcsUri: z.string() })
  .strict();
const manifestSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    world: sourceSchema,
    actors: z.array(sourceSchema).min(1).max(4),
    worldPrompt: z.string(),
    model: z.literal("marble-1.1"),
    confirmedAt: z.string().datetime(),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
export const spatialProductionDeps = {
  storage: codeMotionStorage,
  load: loadCodeMotion,
  resolve: resolveRegisteredPostProdMediaSource,
  assertImage: assertCodeMotionImageSource,
  sign: signGsUriV4ReadUrl,
  createActor: createManhua3dTask,
  actor: getManhua3dTask,
  createWorld: createManhuaWorldTask,
  world: getManhuaWorldTask,
  importAsset: importCodeMotionSpatialAsset,
  assetDeps: spatialImportDeps,
};
function prefix(userId: string, projectId: string) {
  return `${spatialPrefix(userId, projectId)}production/`;
}
async function readManifest(
  userId: string,
  projectId: string,
  storage: CodeMotionStoreDeps
) {
  const raw = await storage.read(`${prefix(userId, projectId)}manifest.json`);
  return raw ? manifestSchema.parse(JSON.parse(raw.body.toString())) : null;
}
async function receiptTaskId(storage: CodeMotionStoreDeps, name: string) {
  const raw = await storage.read(name);
  return raw
    ? z
        .object({ taskId: z.string().min(1) })
        .parse(JSON.parse(raw.body.toString())).taskId
    : null;
}
export async function prepareCodeMotionSpatialProduction(
  userId: string,
  input: CodeMotionSpatialProductionInput,
  deps = spatialProductionDeps
) {
  const value = codeMotionSpatialProductionInputSchema.parse(input);
  const saved = await deps.load(userId, value.projectId, deps.storage);
  if (
    !saved ||
    saved.generation !== value.expectedGeneration ||
    !saved.project.plan
  )
    throw Error("作品已变化，请先保存再查看3D制作安排");
  if (saved.project.brief.generationTier === "free")
    throw Error("3D资产生成不在免费制作额度内，请先选择付费生成");
  const images = saved.project.brief.images;
  const pick = async (id: string) => {
    const image = images.find(i => i.id === id);
    if (!image) throw Error("参考图不在当前作品内，请先生成或上传并采用");
    deps.assertImage(userId, image.gcsUri);
    if ((await deps.resolve({ userId, source: image.gcsUri })) !== image.gcsUri)
      throw Error("参考图归属未确认");
    return image;
  };
  const world = await pick(value.worldImageId),
    actors = [];
  for (const id of value.actorImageIds) actors.push(await pick(id));
  const content = {
    version: 1 as const,
    projectId: value.projectId,
    world,
    actors,
    worldPrompt: value.worldPrompt,
    model: "marble-1.1" as const,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  const previous = await readManifest(userId, value.projectId, deps.storage);
  if (previous && previous.fingerprint !== fingerprint)
    throw Error("本作品已有3D制作，请先恢复原任务；没有重新购买不同资产");
  return {
    ...content,
    fingerprint,
    costNotice: CODE_MOTION_3D_COST_NOTICE,
    worldPreview: deps.sign(world.gcsUri, 3600),
    actorPreviews: actors.map(a => ({
      id: a.id,
      name: a.name,
      url: deps.sign(a.gcsUri, 3600),
    })),
  };
}
/** 整批输入先归档；原任务服务按稳定素材版本幂等，断线恢复不调用retry。 */
export async function submitCodeMotionSpatialProduction(
  userId: string,
  input: CodeMotionSpatialProductionInput & { confirmedFingerprint: string },
  deps = spatialProductionDeps
) {
  const { confirmedFingerprint, ...request } = input;
  const prepared = await prepareCodeMotionSpatialProduction(
    userId,
    request,
    deps
  );
  if (prepared.fingerprint !== confirmedFingerprint)
    throw Error("3D参考和提示词已变化，请重新核对本次安排");
  let manifest = await readManifest(userId, input.projectId, deps.storage);
  const { world, actors, worldPrompt, model, fingerprint, projectId } =
    prepared;
  if (manifest && manifest.fingerprint !== fingerprint)
    throw Error("本作品已有另一批3D制作，请恢复原任务；未创建新任务");
  if (!manifest) {
    manifest = {
      version: 1,
      projectId,
      world,
      actors,
      worldPrompt,
      model,
      fingerprint,
      confirmedAt: new Date().toISOString(),
    };
    const name = `${prefix(userId, input.projectId)}manifest.json`;
    try {
      await deps.storage.write(
        name,
        Buffer.from(JSON.stringify(manifest)),
        "0"
      );
    } catch (error) {
      const winner = await readManifest(userId, input.projectId, deps.storage);
      if (!winner || winner.fingerprint !== fingerprint) throw error;
      manifest = winner;
    }
  }
  const base = prefix(userId, input.projectId);
  if (!(await receiptTaskId(deps.storage, `${base}world.json`))) {
    const result = await deps.createWorld({
      userId: Number(userId),
      sceneRef: `ink:${input.projectId}:world`,
      sourceVersion: world.gcsUri,
      sourceImageUrl: deps.sign(world.gcsUri, 3 * 3600),
      sourceImageGcsUri: world.gcsUri,
      displayName: world.name,
      model,
      prompt: { type: "image", isPano: "auto", textPrompt: worldPrompt },
    });
    await writeSpatialRecord(deps.storage, `${base}world.json`, {
      taskId: result.taskId,
    });
  }
  for (let index = 0; index < actors.length; index++) {
    if (await receiptTaskId(deps.storage, `${base}actor-${index}.json`))
      continue;
    const image = actors[index];
    const result = await deps.createActor({
      userId: Number(userId),
      assetRef: `ink:${input.projectId}:actor:${index}`,
      sourceVersion: image.gcsUri,
      sourceImageUrl: deps.sign(image.gcsUri, 3 * 3600),
      options: {
        texture: true,
        pbr: true,
        textureQuality: "detailed",
        geometryQuality: "detailed",
        textureAlignment: "original_image",
        orientation: "align_image",
        autoSize: false,
        quad: false,
      },
    });
    await writeSpatialRecord(deps.storage, `${base}actor-${index}.json`, {
      taskId: result.taskId,
    });
  }
  return getCodeMotionSpatialProduction(userId, input.projectId, deps);
}
export async function getCodeMotionSpatialProduction(
  userId: string,
  projectId: string,
  deps = spatialProductionDeps
) {
  const manifest = await readManifest(userId, projectId, deps.storage);
  if (!manifest) return null;
  const base = prefix(userId, projectId),
    worldId = await receiptTaskId(deps.storage, `${base}world.json`);
  const world = worldId ? await deps.world(worldId, Number(userId)) : null;
  const actors = [];
  for (let index = 0; index < manifest.actors.length; index++) {
    const taskId = await receiptTaskId(
      deps.storage,
      `${base}actor-${index}.json`
    );
    actors.push({
      source: manifest.actors[index],
      task: taskId ? await deps.actor(taskId, Number(userId)) : null,
    });
  }
  return {
    fingerprint: manifest.fingerprint,
    worldSource: manifest.world,
    worldPrompt: manifest.worldPrompt,
    world,
    actors,
    needsResume: !world || actors.some(a => !a.task),
    ready:
      world?.status === "succeeded" &&
      actors.every(a => a.task?.status === "succeeded"),
  };
}
export async function adoptCodeMotionSpatialProduction(
  userId: string,
  projectId: string,
  deps = spatialProductionDeps
) {
  const status = await getCodeMotionSpatialProduction(userId, projectId, deps);
  if (!status?.ready || !status.world?.assets?.spz500kGcsUri)
    throw Error("3D资产尚未全部生成并归档，请恢复原任务；未重新生成");
  const scale = status.world.assets.metricScaleFactor,
    ground = status.world.assets.groundPlaneOffset;
  if (!Number.isFinite(scale) || Number(scale) <= 0 || !Number.isFinite(ground))
    throw Error("场景回执缺少真实比例或地面偏移，请查询原任务，未猜测空间参数");
  if (status.actors.some(actor => !actor.task?.glbGcsUri))
    throw Error("人物模型未归档，请查询原任务");
  const assets = [];
  const importOwned = async (
    gcsUri: string,
    name: string,
    kind: "glb" | "spz"
  ) =>
    deps.importAsset(
      userId,
      { projectId, gcsUri, name, kind },
      {
        ...deps.assetDeps,
        storage: deps.storage,
        resolve: async input => {
          if (input.userId !== userId || input.source !== gcsUri)
            throw Error("3D任务归属不一致");
          return gcsUri;
        },
      }
    );
  const world = await importOwned(
    status.world.assets.spz500kGcsUri,
    status.worldSource.name,
    "spz"
  );
  assets.push(world);
  const actorIds = [];
  for (const actor of status.actors) {
    if (!actor.task?.glbGcsUri) throw Error("人物模型未归档，请查询原任务");
    const asset = await importOwned(
      actor.task.glbGcsUri,
      actor.source.name,
      "glb"
    );
    assets.push(asset);
    actorIds.push(asset.id);
  }
  return {
    assets,
    worldId: world.id,
    actorIds,
    referenceImageIds: status.actors.map(actor => actor.source.id),
    metricScaleFactor: Number(scale),
    groundPlaneOffset: Number(ground),
  };
}

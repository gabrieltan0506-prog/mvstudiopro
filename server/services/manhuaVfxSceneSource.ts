import type { ManhuaVfxEnvironment } from "../../shared/manhuaVfxEnvironment";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getJobByIdStrict } from "../jobs/repository";
import { resolveManhuaPrevisMedia } from "./manhuaPrevisMedia";
import { fetchPostProdSourceToFile } from "./postProduction";
import { manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import { manhuaVfxBulletSchema } from "../../shared/manhuaVfxPixelParameters";
import { deriveManhuaVfxChoreographySpec, manhuaVfxSceneActorBindings, type ManhuaVfxChoreography } from "../../shared/manhuaVfxChoreography";
import { preparePrevisModels } from "./manhuaPrevisModels";
import { validatePrevisReport } from "./manhuaPrevisReport";
import { blenderLaunchCommand, blenderLowPriorityDefault, runPrevisProcess } from "./manhuaPrevisRender";
import { writeFile } from "node:fs/promises";

type Bullet = z.infer<typeof manhuaVfxBulletSchema>;
type SceneSelection = Pick<Bullet, "sceneJobId" | "sceneScopeId" | "clipId"> & ({ freezeSec: number } | { sourceStartSec: number; choreography?: ManhuaVfxChoreography; environment?: ManhuaVfxEnvironment; render?: { quality: "preview" | "beauty" } });
type SceneJob = Parameters<typeof resolveManhuaPrevisMedia>[0];
const MAX_SCENE_BYTES = 512 * 1024 * 1024;
export async function resolveManhuaVfxSceneSource(bullet: SceneSelection, userId: string, load: (id: string) => Promise<SceneJob> = getJobByIdStrict) {
  const sceneJob = await load(bullet.sceneJobId);
  const source = resolveManhuaPrevisMedia(sceneJob, Number(userId), "scene");
  const input = sceneJob?.input as { params?: unknown } | undefined;
  const request = manhuaPrevisRequestSchema.safeParse(input?.params);
  const output = sceneJob?.output as { sceneSha256?: unknown } | undefined;
  if (!source || !request.success || request.data.scopeId !== bullet.sceneScopeId || request.data.clipId !== bullet.clipId || typeof output?.sceneSha256 !== "string")
    throw new Error("三维场景不属于所选作品片段，或成功回执未闭合");
  const start = "freezeSec" in bullet ? bullet.freezeSec : bullet.sourceStartSec;
  if (start >= request.data.spec.durationSec) throw new Error("源三维场景的冻结或起始秒位越界");
  if ("sourceStartSec" in bullet && bullet.environment && (request.data.spec.actors.some(actor => !actor.riggedModel) || request.data.spec.sceneEffects?.length || request.data.spec.waterEmergence))
    throw new Error("正式场景须先绑定全部人物的真实模型；独立水体或场景特效请保留原工序，不会静默导出白模替身或丢失效果");
  const spec = "sourceStartSec" in bullet && bullet.choreography
    ? deriveManhuaVfxChoreographySpec(request.data.spec, bullet.choreography) : request.data.spec;
  return { ...source, sha256: output.sceneSha256, sourceRequestId: request.data.requestId, sourceScopeId: request.data.scopeId, sourceClipId: request.data.clipId, durationSec: request.data.spec.durationSec, spec };
}

/** 场景只能来自本人已成功的固定预演产物；客户端不能传路径、URL或任意blend。 */
export async function prepareManhuaVfxScene(bullet: SceneSelection, effectId: string, userId: string, root: string, signal: AbortSignal,
  deps: { load: (id: string) => Promise<SceneJob>; fetch: typeof fetchPostProdSourceToFile;
    prepareModels?: typeof preparePrevisModels; run?: typeof runPrevisProcess } = { load: getJobByIdStrict, fetch: fetchPostProdSourceToFile }) {
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
  let sceneSha256 = sha256;
  let choreographyReport: unknown;
  const fullMaterials = "sourceStartSec" in bullet && bullet.render?.quality === "beauty" && source.spec.actors.some(actor => actor.riggedModel);
  if ("sourceStartSec" in bullet && (bullet.choreography || fullMaterials)) {
    // 只在本次临时目录重建源角色动画；不改原场景对象或预演任务。
    const derivedDir = path.join(dir, `choreography-${effectId}`);
    await mkdir(derivedDir);
    const specPath = path.join(derivedDir, "spec.json"), modelPath = path.join(derivedDir, "models.json");
    await writeFile(specPath, JSON.stringify(source.spec), { flag: "wx", signal });
    const models = source.spec.actors.some(actor => actor.riggedModel)
      ? await (deps.prepareModels ?? preparePrevisModels)(fullMaterials ? { ...source.spec, exportAnimation: true } : source.spec, Number(userId), derivedDir, signal) : [];
    if (models.length) await writeFile(modelPath, JSON.stringify(models), { flag: "wx", signal });
    const launch = blenderLaunchCommand({ blender: process.env.BLENDER_BIN || "blender", useXvfb: process.platform === "linux", lowPriority: blenderLowPriorityDefault() },
      ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", path.resolve("server/scripts/render-manhua-previs.py"), "--", specPath, derivedDir, ...(models.length ? [modelPath] : [])]);
    await (deps.run ?? runPrevisProcess)(launch.command, launch.args, signal);
    const reportFile = path.join(derivedDir, "report.json"), reportInfo = await stat(reportFile);
    if (reportInfo.size <= 0 || reportInfo.size > 4 * 1024 * 1024) throw new Error("角色穿行报告为空或超过限制");
    choreographyReport = JSON.parse(await readFile(reportFile, "utf8"));
    validatePrevisReport(choreographyReport, source.spec, models);
    const derivedPath = path.join(derivedDir, "scene.blend"), derivedInfo = await stat(derivedPath);
    if (derivedInfo.size < 1000 || derivedInfo.size > MAX_SCENE_BYTES) throw new Error("角色穿行场景大小无效");
    const derived = await readFile(derivedPath);
    if (derived.subarray(0, 7).toString() !== "BLENDER") throw new Error("角色穿行场景格式无效");
    sceneSha256 = createHash("sha256").update(derived).digest("hex");
    await writeFile(scenePath, derived, { signal });
  }
  return { scenePath, sceneSha256, sceneActors: manhuaVfxSceneActorBindings(source.spec),
    receipt: { ...source, bytes: info.size, fullMaterials, ...(choreographyReport ? { choreographyReport, derivedSceneSha256: sceneSha256 } : {}) } };
}

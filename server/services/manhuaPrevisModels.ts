import { exportedProxyVertices } from "./manhuaPrevisProxy";
/** 本人3D任务 → 有界云对象验真 → worker临时文件；凭证不进入任务或子进程。 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getCompletedManhua3dSource, Manhua3dSourceRejectedError } from "./manhua3dTask";
import { inspectGcsObjectBounded } from "./gcs";
import { assertValidGlb2 } from "../../shared/glbValidation";
import type { ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
export const PREVIS_MODEL_MAX_BYTES = 64 * 1024 * 1024;
export type PrevisModelSource = Awaited<
  ReturnType<typeof getCompletedManhua3dSource>
>;
export type PrevisModelDeps = {
  source: typeof getCompletedManhua3dSource;
  inspect: typeof inspectGcsObjectBounded;
};
const defaults: PrevisModelDeps = {
  source: getCompletedManhua3dSource,
  inspect: inspectGcsObjectBounded,
};
export async function resolvePrevisModels(
  spec: ManhuaPrevisSpec,
  userId: number,
  d: PrevisModelDeps = defaults
) {
  const sources: Array<{ actorId: string; source: PrevisModelSource }> = [];
  let total = 0;
  // previs_creature.py：18节骨段 + 6×3羽片，每网格8顶点。
  let vertices = spec.actors.filter(a => a.creature?.preset === "four_tail_black_wings").length * 288;
  for (const actor of spec.actors) {
    if (!actor.riggedModel) continue;
    if (!actor.assetRef) throw new Manhua3dSourceRejectedError("角色模型未绑定项目人物");
    // 绑骨模型可能挂在同一人物的 A-pose 候选图上（0916 口径）；回执按模型所在 ref 核对，身份仍是 assetRef。
    const modelAssetRef = actor.riggedModel.sourceAssetRef ?? actor.assetRef;
    const source = await d.source(
      actor.riggedModel.sourceJobId,
      userId,
      modelAssetRef,
      { prefer: "previs" }
    );
    if (
      source.taskId !== actor.riggedModel.sourceJobId ||
      source.assetRef !== modelAssetRef ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes < 20 ||
      source.bytes > PREVIS_MODEL_MAX_BYTES ||
      !/^[a-f0-9]{64}$/.test(source.sha256)
    )
      throw new Manhua3dSourceRejectedError("角色模型来源或体积未通过预演检查");
    let modelVertices = source.vertices;
    if (modelVertices === undefined) {
      // 历史回执没有计数；入队前读取真实GLB验真，不能将未知当成0。
      const chunks: Buffer[] = [];
      let received = 0;
      const checked = await d.inspect({gcsUri: source.gcsUri, maxBytes: PREVIS_MODEL_MAX_BYTES,
        timeoutMs: 120000, onChunk: chunk => {
          received += chunk.length;
          if (received > PREVIS_MODEL_MAX_BYTES) throw Error("角色文件超过64MB");
          chunks.push(Buffer.from(chunk));
        }});
      const buffer = Buffer.concat(chunks);
      if (buffer.length !== source.bytes || checked.sha256 !== source.sha256 ||
          checked.byteLength !== source.bytes || createHash("sha256").update(buffer).digest("hex") !== source.sha256)
        throw Error("角色模型下载不完整，保留原请求编号");
      modelVertices = exportedProxyVertices(buffer, 2_000_000);
    }
    if (!Number.isSafeInteger(modelVertices) || modelVertices < 100)
      throw new Manhua3dSourceRejectedError("角色模型顶点回执无效");
    vertices += modelVertices;
    if (vertices * spec.durationSec * 24 * (spec.aspect === "9:16" ? 3 : 1) > 12_000_000)
      throw new Manhua3dSourceRejectedError("本段角色模型合计超出1200万顶点帧预算，请缩短片段、改横屏或使用低模代理");
    total += source.bytes;
    if (total > PREVIS_MODEL_MAX_BYTES * 2)
      throw new Manhua3dSourceRejectedError("本段角色模型总量超过128MB，请分段预演");
    sources.push({ actorId: actor.id, source });
  }
  return sources;
}
export async function preparePrevisModels(
  spec: ManhuaPrevisSpec,
  userId: number,
  dir: string,
  signal: AbortSignal,
  d: PrevisModelDeps = defaults
) {
  const resolved = await resolvePrevisModels(spec, userId, d);
  const manifests: Array<{
    actorId: string;
    localPath: string;
    sha256: string;
    sourceJobId: string;
    bytes: number;
  }> = [];
  for (let index = 0; index < resolved.length; index++) {
    const { actorId, source } = resolved[index];
    signal.throwIfAborted();
    const chunks: Buffer[] = [];
    let bytes = 0;
    const inspection = await d.inspect({
      gcsUri: source.gcsUri,
      maxBytes: PREVIS_MODEL_MAX_BYTES,
      timeoutMs: 120000,
      signal,
      onChunk: chunk => {
        bytes += chunk.byteLength;
        if (bytes > PREVIS_MODEL_MAX_BYTES) throw new Error("角色文件超过64MB");
        chunks.push(Buffer.from(chunk));
      },
    });
    signal.throwIfAborted();
    const buffer = Buffer.concat(chunks);
    if (
      buffer.length !== source.bytes ||
      inspection.byteLength !== source.bytes ||
      inspection.sha256 !== source.sha256 ||
      createHash("sha256").update(buffer).digest("hex") !== source.sha256
    )
      throw new Error("角色模型已变化或下载不完整，请重新选择");
    assertValidGlb2(buffer);
    const localPath = path.join(dir, `actor-model-${index}.glb`);
    signal.throwIfAborted();
    await writeFile(localPath, buffer, { flag: "wx", signal });
    signal.throwIfAborted();
    manifests.push({
      actorId,
      localPath,
      sha256: source.sha256,
      sourceJobId: source.taskId,
      bytes: source.bytes,
    });
  }
  return manifests;
}

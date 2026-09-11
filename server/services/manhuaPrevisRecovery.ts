/** 只回收已存证的白模产物；不生成、不重排、不覆盖已有产物。 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import { getGcsBucketName, inspectGcsObjectBounded } from "./gcs";
import type { PostProdJobRow } from "./postProdJobResponse";

export type PrevisRecoveryRow = NonNullable<PostProdJobRow> & {
  userId: string;
  type: string;
};
export type PrevisRecoveryDeps = {
  bucket: () => string;
  inspect: typeof inspectGcsObjectBounded;
  save: (
    row: PrevisRecoveryRow,
    output: Record<string, unknown>
  ) => Promise<PrevisRecoveryRow | null>;
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const objectEvidence = z
  .object({
    gcsUri: z.string(),
    bytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
    sha256: digest,
  })
  .strict();
const manifestSchema = z
  .object({
    userId: z.string(),
    requestId: z.string().uuid(),
    scopeId: z.string().uuid(),
    clipId: z.string(),
    result: objectEvidence,
  })
  .strict();
const resultSchema = z
  .object({
    userId: z.string(),
    requestId: z.string().uuid(),
    scopeId: z.string().uuid(),
    clipId: z.string(),
    spec: manhuaPrevisRequestSchema.shape.spec,
    gcsUri: z.string(),
    bytes: z
      .number()
      .int()
      .min(1000)
      .max(64 * 1024 * 1024),
    sha256: digest,
    durationSec: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
    sceneGcsUri: z.string(),
    requestGcsUri: z.string(),
    reportGcsUri: z.string(),
    probeGcsUri: z.string(),
    requestSha256: digest,
    reportSha256: digest,
    probeSha256: digest,
    sceneSha256: digest,
    report: z
      .object({
        frames: z.number().int(),
        fps: z.literal(24),
        actors: z
          .array(
            z
              .object({
                id: z.string(),
                nameZh: z.string(),
                bones: z.number().int().min(12),
                contactError: z.number().finite().nonnegative().max(0.005),
                stanceDrift: z.number().finite().nonnegative().max(0.005),
                offscreenFrames: z.array(z.number().int().min(1).max(720)),
              })
              .passthrough()
          )
          .min(1)
          .max(6),
        warnings: z.array(z.string()),
      })
      .passthrough(),
  })
  .strict();

export function canRecoverPrevis(row: PrevisRecoveryRow) {
  if (
    row.status !== "failed" ||
    row.type !== "post_prod" ||
    row.provider !== "blender-previs"
  )
    return false;
  // worker 心跳不是成品；不把任何未知输出或取消标记当作空结果。
  return (
    row.output == null ||
    (typeof row.output === "object" &&
      !Array.isArray(row.output) &&
      Object.keys(row.output).every(key => key === "postProdHeartbeatAt"))
  );
}

export async function recoverPrevisResult(
  row: PrevisRecoveryRow,
  userId: number,
  d: PrevisRecoveryDeps
): Promise<PrevisRecoveryRow> {
  if (row.userId !== String(userId) || !canRecoverPrevis(row)) return row;
  const raw = row.input as {
    action?: unknown;
    params?: unknown;
    cancelRequestedAt?: unknown;
    hiddenAt?: unknown;
  };
  if (
    raw?.action !== "manhua_previs" ||
    raw.cancelRequestedAt != null ||
    raw.hiddenAt != null
  )
    return row;
  const parsed = manhuaPrevisRequestSchema.safeParse(raw.params);
  if (!parsed.success) return row;
  const input = parsed.data;
  const expectedId = `prv_${createHash("sha256").update(`${userId}:${input.requestId}`).digest("hex").slice(0, 48)}`;
  if (row.id !== expectedId) return row;
  const prefix = `gs://${d.bucket()}/post-prod/${userId}/previs/${input.requestId}/`;
  const read = async (name: string) => {
    const chunks: Buffer[] = [];
    await d.inspect({
      gcsUri: prefix + name,
      maxBytes: 4 * 1024 * 1024,
      timeoutMs: 15000,
      onChunk: chunk => chunks.push(Buffer.from(chunk)),
    });
    return Buffer.concat(chunks);
  };
  try {
    const manifest = manifestSchema.parse(
      JSON.parse((await read("result-evidence.json")).toString())
    );
    if (
      manifest.userId !== row.userId ||
      manifest.requestId !== input.requestId ||
      manifest.scopeId !== input.scopeId ||
      manifest.clipId !== input.clipId ||
      manifest.result.gcsUri !== prefix + "result.json"
    )
      return row;
    const bytes = await read("result.json");
    if (
      bytes.length !== manifest.result.bytes ||
      sha(bytes) !== manifest.result.sha256
    )
      return row;
    const result = resultSchema.parse(JSON.parse(bytes.toString()));
    if (
      result.userId !== row.userId ||
      result.requestId !== input.requestId ||
      result.scopeId !== input.scopeId ||
      result.clipId !== input.clipId ||
      JSON.stringify(result.spec) !== JSON.stringify(input.spec)
    )
      return row;
    for (const [field, name] of Object.entries({
      gcsUri: "preview.mp4",
      sceneGcsUri: "scene.blend",
      requestGcsUri: "request.json",
      reportGcsUri: "report.json",
      probeGcsUri: "probe.json",
    })) {
      if (result[field as keyof typeof result] !== prefix + name) return row;
    }
    if (result.requestSha256 !== sha(Buffer.from(JSON.stringify(input))))
      return row;
    for (const [name, hash] of [
      ["request.json", result.requestSha256],
      ["report.json", result.reportSha256],
      ["probe.json", result.probeSha256],
    ]) {
      const content = await read(name);
      if (sha(content) !== hash) return row;
      const value = JSON.parse(content.toString());
      if (name === "report.json" && !isDeepStrictEqual(value, result.report))
        return row;
      if (name === "probe.json") {
        const stream = value?.streams?.[0];
        if (
          value?.streams?.length !== 1 ||
          stream.width !== result.width ||
          stream.height !== result.height ||
          Number(stream.nb_read_frames) !== result.report.frames ||
          !Number.isFinite(Number(value?.format?.duration)) ||
          Math.abs(Number(value.format.duration) - input.spec.durationSec) >
            0.05
        )
          return row;
      }
    }
    const [width, height] =
      input.spec.aspect === "16:9" ? [960, 540] : [540, 960];
    if (
      result.width !== width ||
      result.height !== height ||
      result.durationSec !== input.spec.durationSec ||
      result.report.frames !== input.spec.durationSec * 24 ||
      result.report.actors.length !== input.spec.actors.length
    )
      return row;
    if (
      result.report.actors.some(
        (actor, i) =>
          actor.id !== input.spec.actors[i].id ||
          actor.nameZh !== input.spec.actors[i].nameZh ||
          actor.offscreenFrames.some(frame => frame > result.report.frames)
      )
    )
      return row;
    const video = await d.inspect({
      gcsUri: result.gcsUri,
      maxBytes: 64 * 1024 * 1024,
      timeoutMs: 30000,
    });
    if (video.byteLength !== result.bytes || video.sha256 !== result.sha256)
      return row;
    const scene = await d.inspect({
      gcsUri: result.sceneGcsUri,
      maxBytes: 64 * 1024 * 1024,
      timeoutMs: 30000,
    });
    if (scene.byteLength < 1000 || scene.sha256 !== result.sceneSha256)
      return row;
    return (await d.save(row, result)) ?? row;
  } catch {
    // 缺失、损坏或存储暂不可用时保留原失败；绝不再次购买或渲染。
    return row;
  }
}

export const previsRecoveryStorage = {
  bucket: getGcsBucketName,
  inspect: inspectGcsObjectBounded,
};

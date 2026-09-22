type PrevisMediaJob = {
  id: string;
  userId: string;
  type: string;
  provider: string | null;
  status: string;
  input: unknown;
  output: unknown;
};

export type ManhuaPrevisMediaAsset = "preview" | "layers";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * 白模媒体代理只接受本人已成功的 blender-previs 任务，并从落库回执选择固定对象。
 * 客户端不能提交任意 gs://，避免把 Fly 代理变成私有桶读取口。
 */
export function resolveManhuaPrevisMedia(
  job: PrevisMediaJob | null,
  userId: number,
  asset: ManhuaPrevisMediaAsset,
): { gcsUri: string; contentType: string; fileName: string } | null {
  if (
    !job
    || job.userId !== String(userId)
    || job.type !== "post_prod"
    || job.provider !== "blender-previs"
    || job.status !== "succeeded"
  ) return null;
  const input = record(job.input);
  if (input?.action !== "manhua_previs") return null;
  const output = record(job.output);
  if (!output) return null;
  if (asset === "preview") {
    const gcsUri = typeof output.gcsUri === "string" ? output.gcsUri : "";
    if (!/^gs:\/\/[^/]+\/post-prod\/\d+\/previs\/[^/]+\/preview\.mp4$/.test(gcsUri)) return null;
    return { gcsUri, contentType: "video/mp4", fileName: `动作白模-${job.id}.mp4` };
  }
  const bundle = record(output.layerBundle);
  const gcsUri = typeof bundle?.gcsUri === "string" ? bundle.gcsUri : "";
  if (
    bundle?.format !== "previs-layers-v1"
    || !/^gs:\/\/[^/]+\/post-prod\/\d+\/previs\/[^/]+\/layer-bundle\.zip$/.test(gcsUri)
  ) return null;
  return { gcsUri, contentType: "application/zip", fileName: `白模分层-${job.id}.zip` };
}

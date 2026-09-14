/**
 * 后期任务统一响应(getPostProdJob 与 listPostProdJobs 共用):
 * 产物有 gcsUri 时每次查询现签新的 7 天读链——旧签名链过期不影响取件。
 * 签名器可注入以便测试。
 */
import { signGsUriV4ReadUrl } from "./gcs.js";

export type PostProdJobRow = {
  id: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  provider: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
} | null;

export function buildPostProdJobResponse(
  job: PostProdJobRow,
  signUrl: (
    gsUri: string,
    expiresSeconds: number
  ) => string = signGsUriV4ReadUrl
) {
  if (!job) return null;

  const input =
    job.input && typeof job.input === "object" && !Array.isArray(job.input)
      ? (job.input as { action?: unknown })
      : {};

  const originalOutput =
    job.output && typeof job.output === "object" && !Array.isArray(job.output)
      ? (job.output as Record<string, unknown>)
      : null;

  let output = originalOutput;
  const gcsUri =
    typeof originalOutput?.gcsUri === "string" ? originalOutput.gcsUri : "";
  if (output && gcsUri.startsWith("gs://")) {
    // gcsUri 优先:读链按 gcsUri 现签,不依赖落库时的旧地址
    output = { ...output, url: signUrl(gcsUri, 7 * 24 * 3600) };
  }

  // 分层包只给已鉴权预演任务的同一对象前缀现签；不沿用旧URL。
  if (
    output &&
    input.action === "manhua_previs" &&
    job.provider === "blender-previs"
  ) {
    const bundle = output.layerBundle;
    if (bundle && typeof bundle === "object" && !Array.isArray(bundle)) {
      const { url: _oldUrl, ...layer } = bundle as Record<string, unknown>;
      const expected = gcsUri.startsWith("gs://")
        ? gcsUri.slice(0, gcsUri.lastIndexOf("/") + 1) + "layer-bundle.zip"
        : "";
      output = { ...output, layerBundle: layer };
      if (
        expected &&
        layer.gcsUri === expected &&
        layer.format === "previs-layers-v1" &&
        typeof layer.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(layer.sha256) &&
        typeof layer.bytes === "number" &&
        layer.bytes > 0 &&
        layer.bytes <= 64 * 1024 * 1024
      )
        output = {
          ...output,
          layerBundle: { ...layer, url: signUrl(expected, 7 * 24 * 3600) },
        };
    }
  }

  return {
    jobId: job.id,
    action: input.action,
    status: job.status,
    output,
    error: job.error,
    provider: job.provider,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

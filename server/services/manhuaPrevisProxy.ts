/** 白模代理证据：顶点数来自导出文件，不使用减面前的网格估数。 */
import { z } from "zod";
import { assertValidGlb2 } from "../../shared/glbValidation";
export const previsProxySchema = z.object({
  gcsUri: z.string().startsWith("gs://"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(20).max(64 * 1024 * 1024),
  vertices: z.number().int().min(100).max(50_000),
}).strict();
export type PrevisProxy = z.infer<typeof previsProxySchema>;
export function exportedProxyVertices(buffer: Buffer, maxVertices = 50_000): number {
  assertValidGlb2(buffer);
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  let count = 0;
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh?.primitives?.length || node.skin === undefined) throw Error("代理缺少带骨网格");
    for (const primitive of mesh.primitives) {
      const n = json.accessors?.[primitive.attributes?.POSITION]?.count;
      if (!Number.isSafeInteger(n) || n <= 0) throw Error("代理顶点回执无效");
      count += n;
    }
  }
  if (count < 100 || count > maxVertices) throw Error("导出网格顶点数超出预算");
  return count;
}

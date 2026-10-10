import { z } from "zod";
import {
  codeMotionProjectSchema,
  type CodeMotionProject,
} from "../../shared/codeMotion";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  listGcsObjectNamesByPrefix,
  statGcsObjectVersion,
  uploadBufferToGcs,
} from "./gcs";
const envelopeSchema = z
  .object({
    project: codeMotionProjectSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();
export type CodeMotionSaved = {
  project: CodeMotionProject;
  generation: string;
  updatedAt: string;
};
export function codeMotionObjectName(userId: string, projectId: string) {
  if (!/^[0-9]+$/.test(userId)) throw new Error("账号无法确认，请重新登录");
  z.string().uuid().parse(projectId);
  return `code-motion/u${userId}/projects/${projectId}.json`;
}
export type CodeMotionStoreDeps = {
  read(name: string): Promise<{ body: Buffer; generation: string } | null>;
  write(name: string, body: Buffer, generation: string): Promise<string>;
  list(prefix: string): Promise<string[]>;
};
const real: CodeMotionStoreDeps = {
  async read(name) {
    const gcsUri = `gs://${getGcsBucketName()}/${name}`;
    let meta;
    try {
      meta = await statGcsObjectVersion({
        gcsUri,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (e instanceof Error && e.message === "gcs_stat_failed:404")
        return null;
      throw e;
    }
    const chunks: Buffer[] = [];
    await inspectGcsObjectBounded({
      gcsUri,
      generation: meta.generation,
      maxBytes: 100_000,
      timeoutMs: 30_000,
      onChunk: b => chunks.push(Buffer.from(b)),
    });
    return { body: Buffer.concat(chunks), generation: meta.generation };
  },
  async write(name, body, generation) {
    try {
      const result = await uploadBufferToGcs({
        objectName: name,
        buffer: body,
        contentType: "application/json",
        ifGenerationMatch: generation,
        signal: AbortSignal.timeout(30_000),
      });
      if (!result.generation)
        throw new Error("保存回执未确认，请保留本页内容，再读取云端版本");
      return result.generation;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("gcs_upload_failed:412"))
        throw new Error(
          "另一处已修改这份作品。请先下载本页内容，再重新打开云端版本，避免覆盖"
        );
      throw e;
    }
  },
  list: prefix => listGcsObjectNamesByPrefix({ prefix, allPages: true }),
};
export async function loadCodeMotion(
  userId: string,
  projectId: string,
  deps = real
): Promise<CodeMotionSaved | null> {
  const object = await deps.read(codeMotionObjectName(userId, projectId));
  if (!object) return null;
  const value = envelopeSchema.parse(JSON.parse(object.body.toString("utf8")));
  if (value.project.id !== projectId) throw new Error("作品身份不一致，未加载");
  return { ...value, generation: object.generation };
}
export async function saveCodeMotion(
  userId: string,
  projectInput: unknown,
  expectedGeneration: string,
  deps = real
): Promise<CodeMotionSaved> {
  const project = codeMotionProjectSchema.parse(projectInput);
  z.string().regex(/^\d+$/).parse(expectedGeneration);
  const updatedAt = new Date().toISOString();
  const generation = await deps.write(
    codeMotionObjectName(userId, project.id),
    Buffer.from(JSON.stringify({ project, updatedAt })),
    expectedGeneration
  );
  return { project, generation, updatedAt };
}
export async function listCodeMotion(userId: string, deps = real) {
  codeMotionObjectName(userId, "00000000-0000-4000-8000-000000000000");
  const names = await deps.list(`code-motion/u${userId}/projects/`);
  const ids = names.flatMap(name => {
    const match = name.match(/\/projects\/([a-f0-9-]{36})\.json$/i);
    return match ? [match[1]] : [];
  });
  const rows = [];
  // 有界并发；逐个失败必须报告，不能把未加载作品当作已删除。
  for (const id of ids) {
    const row = await loadCodeMotion(userId, id, deps);
    if (row)
      rows.push({
        id,
        title: row.project.brief.title,
        updatedAt: row.updatedAt,
      });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

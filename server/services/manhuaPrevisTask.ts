/** 沿用单并发后期 worker；本入口只落幂等队列，不执行浏览器同步长请求。 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs } from "../../drizzle/schema";
import {
  manhuaPrevisRequestSchema,
  type ManhuaPrevisRequest,
} from "../../shared/manhuaPrevis";
import { getDb } from "../db";
import {
  buildPostProdJobResponse,
  type PostProdJobRow,
} from "./postProdJobResponse";
import { signGsUriV4ReadUrl } from "./gcs";

export function previsTaskId(userId: number, requestId: string) {
  return `prv_${createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 48)}`;
}
type RecordRow = NonNullable<PostProdJobRow> & { userId: string; type: string };
export type PrevisTaskDeps = {
  load: (id: string) => Promise<RecordRow | null>;
  insert: (
    id: string,
    userId: number,
    input: ManhuaPrevisRequest
  ) => Promise<void>;
  sign: (uri: string, seconds: number) => string;
};
async function database() {
  const db = await getDb();
  if (!db) throw new Error("白模任务记录暂不可用");
  return db;
}
const real: PrevisTaskDeps = {
  async load(id) {
    const db = await database();
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    return row ?? null;
  },
  async insert(id, userId, input) {
    const db = await database();
    await db
      .insert(jobs)
      .values({
        id,
        userId: String(userId),
        type: "post_prod",
        provider: "blender-previs",
        status: "queued",
        input: { action: "manhua_previs", params: input },
      })
      .onConflictDoNothing({ target: jobs.id });
  },
  sign: signGsUriV4ReadUrl,
};
function present(
  row: RecordRow,
  userId: number,
  d: Pick<PrevisTaskDeps, "sign">
) {
  const input = row.input as { action?: unknown; params?: unknown };
  if (
    row.userId !== String(userId) ||
    row.type !== "post_prod" ||
    input?.action !== "manhua_previs"
  )
    throw new Error("白模任务不存在");
  return {
    ...buildPostProdJobResponse(row, d.sign)!,
    params: manhuaPrevisRequestSchema.parse(input.params),
  };
}
export async function submitPrevisTask(
  userId: number,
  raw: ManhuaPrevisRequest,
  d: PrevisTaskDeps = real
) {
  if (!Number.isSafeInteger(userId) || userId <= 0)
    throw new Error("白模任务身份无效");
  const input = manhuaPrevisRequestSchema.parse(raw);
  const id = previsTaskId(userId, input.requestId);
  await d.insert(id, userId, input);
  const row = await d.load(id);
  if (!row) throw new Error("白模任务回执未确认，请查询原编号");
  const response = present(row, userId, d);
  if (JSON.stringify(response.params) !== JSON.stringify(input))
    throw new Error("同一请求编号不能用于不同配置");
  return response;
}
export async function getPrevisTask(
  userId: number,
  requestId: string,
  d: PrevisTaskDeps = real
) {
  const row = await d.load(previsTaskId(userId, requestId));
  return row ? present(row, userId, d) : null;
}
const cursorValueSchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().regex(/^prv_[a-f0-9]{48}$/),
  })
  .strict();
export function parsePrevisCursor(value: string) {
  return cursorValueSchema.parse(JSON.parse(value));
}
export const previsCursorSchema = z
  .string()
  .max(256)
  .refine(value => {
    try {
      parsePrevisCursor(value);
      return true;
    } catch {
      return false;
    }
  }, "白模历史游标无效");
export type PrevisListDeps = {
  list: (
    userId: number,
    scopeId: string,
    clipId: string,
    cursor?: z.infer<typeof cursorValueSchema>
  ) => Promise<RecordRow[]>;
  sign: PrevisTaskDeps["sign"];
};
const realList: PrevisListDeps = {
  sign: signGsUriV4ReadUrl,
  async list(userId, scopeId, clipId, cursor) {
    const db = await database();
    // Date 序列化只保留毫秒；SQL 排序与游标比较必须使用相同精度。
    const createdAtMs = sql`date_trunc('milliseconds', ${jobs.createdAt})`;
    return db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, String(userId)),
          eq(jobs.type, "post_prod"),
          sql`${jobs.input}::jsonb->>'action' = 'manhua_previs'`,
          sql`${jobs.input}::jsonb->'params'->>'scopeId' = ${scopeId}`,
          sql`${jobs.input}::jsonb->'params'->>'clipId' = ${clipId}`,
          cursor
            ? sql`(${createdAtMs}, ${jobs.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`
            : undefined
        )
      )
      .orderBy(desc(createdAtMs), desc(jobs.id))
      .limit(31);
  },
};
export async function listPrevisTasks(
  userId: number,
  scopeId: string,
  clipId: string,
  before?: string,
  d: PrevisListDeps = realList
) {
  const cursor =
    before === undefined
      ? undefined
      : parsePrevisCursor(previsCursorSchema.parse(before));
  const rows = await d.list(userId, scopeId, clipId, cursor);
  return {
    items: rows.slice(0, 30).map(row => present(row, userId, d)),
    nextCursor:
      rows.length > 30
        ? JSON.stringify({
            createdAt: new Date(rows[29].createdAt!).toISOString(),
            id: rows[29].id,
          })
        : null,
  };
}

/** 专用管理员入口；请求与候选在同一用户/来源/编号上闭合，失败不重排。 */
import { and, desc, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { jobs } from "../../drizzle/schema";
import {
  autoRigRequestSchema,
  type AutoRigRequest,
  type AutoRigView,
} from "../../shared/manhuaAutoRig";
import { getDb } from "../db";
import {
  getCompletedManhua3dSource,
  getManhua3dTask,
  importExistingManhua3dAsset,
} from "./manhua3dTask";
import { signGsUriV4ReadUrl } from "./gcs";
import {
  autoRigPrefix,
  autoRigResultSchema,
  autoRigSha,
  autoRigStorage,
  readRigCloud,
  validateAutoRigBindReport,
  type AutoRigResult,
} from "./manhuaAutoRigRender";

export type AutoRigRow = {
  id: string;
  userId: string;
  type: string;
  provider: string | null;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};
export type AutoRigTaskDeps = {
  bucket: () => string;
  load: (id: string) => Promise<AutoRigRow | null>;
  insert: (id: string, userId: number, input: AutoRigRequest) => Promise<void>;
  source: typeof getCompletedManhua3dSource;
  saveRecovered: (
    row: AutoRigRow,
    output: AutoRigResult
  ) => Promise<AutoRigRow>;
  sign: typeof signGsUriV4ReadUrl;
  readResult: (
    userId: number,
    input: AutoRigRequest
  ) => Promise<AutoRigResult | null>;
};
export const autoRigTaskId = (userId: number, requestId: string) =>
  `rig_${autoRigSha(`${userId}:${requestId}`).slice(0, 48)}`;
export class AutoRigInputError extends Error {}
async function database() {
  const db = await getDb();
  if (!db) throw Error("绑骨任务记录暂不可用");
  return db;
}
function inputOf(row: AutoRigRow, userId: number) {
  const raw = row.input as { action?: unknown; params?: unknown };
  if (
    row.userId !== String(userId) ||
    row.type !== "post_prod" ||
    row.provider !== "blender-auto-rig" ||
    raw?.action !== "manhua_auto_rig"
  )
    throw Error("绑骨任务不存在");
  const input = autoRigRequestSchema.parse(raw.params);
  if (row.id !== autoRigTaskId(userId, input.requestId))
    throw Error("绑骨任务编号不一致");
  return input;
}
export function checkRigResult(
  result: AutoRigResult,
  input: AutoRigRequest,
  bucket: string,
  userId: number
) {
  const prefix = `gs://${bucket}/${autoRigPrefix(String(userId), input.requestId)}`;
  if (
    result.requestId !== input.requestId ||
    result.sourceJobId !== input.sourceJobId ||
    result.assetRef !== input.assetRef ||
    result.stage !== input.stage ||
    result.requestSha256 !== autoRigSha(JSON.stringify(input)) ||
    result.gcsUri !==
      `gs://${bucket}/uploads/u${userId}/auto-rig/${input.requestId}/model.glb` ||
    result.reportGcsUri !== `${prefix}/raw/output/report.json` ||
    result.previews.some(
      (item, index) => item.gcsUri !== `${prefix}/preview-${index}.png`
    )
  )
    throw Error("绑骨结果身份或存储回执不一致");
  if (input.stage === "bind" && result.sourceDigest !== input.sourceDigest)
    throw Error("绑骨结果不是已确认模型");
  if (
    result.inspection &&
    (result.inspection.sourceSha256 !== result.sourceSha256 ||
      result.inspection.sourceDigest !== result.sourceDigest ||
      !isDeepStrictEqual(result.inspection.settings, input.settings))
  )
    throw Error("绑骨检查摘要不一致");
}
async function readStoredResult(
  userId: number,
  input: AutoRigRequest
): Promise<AutoRigResult | null> {
  try {
    const bucket = autoRigStorage.bucket();
    const data = await readRigCloud(
      `gs://${bucket}/${autoRigPrefix(String(userId), input.requestId)}/result.json`,
      4 * 1024 * 1024,
      autoRigStorage
    );
    const output = autoRigResultSchema.parse(JSON.parse(data.toString()));
    checkRigResult(output, input, bucket, userId);
    const source = await getCompletedManhua3dSource(
      input.sourceJobId,
      userId,
      input.assetRef
    );
    if (source.sha256 !== output.sourceSha256) return null;
    for (const proof of [
      { gcsUri: output.gcsUri, sha256: output.sha256, bytes: output.bytes },
      ...output.previews,
    ]) {
      const receipt = await autoRigStorage.inspect({
        gcsUri: proof.gcsUri,
        maxBytes: proof.bytes,
        timeoutMs: 30_000,
      });
      if (receipt.byteLength !== proof.bytes || receipt.sha256 !== proof.sha256)
        return null;
    }
    const report = await readRigCloud(
      output.reportGcsUri,
      4 * 1024 * 1024,
      autoRigStorage
    );
    if (autoRigSha(report) !== output.reportSha256) return null;
    if (input.stage === "bind")
      validateAutoRigBindReport(
        JSON.parse(report.toString()),
        input.sourceDigest,
        output.sha256
      );
    return output;
  } catch {
    return null;
  }
}
const real: AutoRigTaskDeps = {
  bucket: autoRigStorage.bucket,
  source: getCompletedManhua3dSource,
  sign: signGsUriV4ReadUrl,
  readResult: readStoredResult,
  async load(id) {
    const db = await database();
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    return row ?? null;
  },
  async insert(id, userId, input) {
    const db = await database();
    await db.transaction(async tx => {
      // 同一人物跨标签页提交串行核对；同编号重查不会触发第二个任务。
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`auto-rig:${userId}:${input.assetRef}`}))`
      );
      const [existing] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (existing) return;
      const active = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, String(userId)),
            eq(jobs.provider, "blender-auto-rig"),
            sql`${jobs.status} IN ('queued','running')`,
            sql`${jobs.input}::jsonb->'params'->>'assetRef' = ${input.assetRef}`
          )
        )
        .limit(1);
      if (active.length)
        throw new AutoRigInputError(
          "这个人物还有绑骨任务在处理，请先查询原任务"
        );
      await tx
        .insert(jobs)
        .values({
          id,
          userId: String(userId),
          type: "post_prod",
          provider: "blender-auto-rig",
          status: "queued",
          input: { action: "manhua_auto_rig", params: input },
        })
        .onConflictDoNothing({ target: jobs.id });
    });
  },
  async saveRecovered(previous, output) {
    const db = await database();
    const [saved] = await db
      .update(jobs)
      .set({ status: "succeeded", output, error: null, updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, previous.id),
          eq(jobs.userId, previous.userId),
          eq(jobs.status, "failed"),
          eq(jobs.provider, "blender-auto-rig"),
          sql`${jobs.input}::jsonb = ${JSON.stringify(previous.input)}::jsonb`,
          sql`${jobs.output}::jsonb IS NOT DISTINCT FROM ${previous.output == null ? null : JSON.stringify(previous.output)}::jsonb`
        )
      )
      .returning();
    return saved ?? (await real.load(previous.id)) ?? previous;
  },
};
async function recover(row: AutoRigRow, userId: number, d: AutoRigTaskDeps) {
  const input = inputOf(row, userId),
    envelope = row.input as Record<string, unknown>;
  if (
    row.status !== "failed" ||
    envelope.cancelRequestedAt ||
    envelope.hiddenAt ||
    (row.output &&
      typeof row.output === "object" &&
      Object.keys(row.output).some(key => key !== "postProdHeartbeatAt"))
  )
    return row;
  const output = await d.readResult(userId, input);
  return output ? d.saveRecovered(row, output) : row;
}
function present(
  row: AutoRigRow,
  userId: number,
  d: AutoRigTaskDeps
): AutoRigView {
  const input = inputOf(row, userId);
  let output: AutoRigView["output"] = null;
  if (row.status === "succeeded") {
    const value = autoRigResultSchema.parse(row.output);
    checkRigResult(value, input, d.bucket(), userId);
    output = {
      ...value,
      url: d.sign(value.gcsUri, 3600),
      previewUrls: value.previews.map(item => d.sign(item.gcsUri, 3600)),
    };
  }
  const failure =
    row.error && /^[\u4e00-\u9fff]/.test(row.error) && !/[\\/]/.test(row.error)
      ? row.error
      : "本次检查或绑骨未通过，原模型保留；请调整模型或关节点后明确创建新任务。";
  return {
    jobId: row.id,
    status: row.status,
    params: input,
    output,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    error:
      row.status === "failed"
        ? failure
        : row.status === "canceled"
          ? "任务已取消，原模型保留。"
          : null,
  };
}
export async function getAutoRigTask(
  userId: number,
  requestId: string,
  d: AutoRigTaskDeps = real
): Promise<AutoRigView | null> {
  const row = await d.load(autoRigTaskId(userId, requestId));
  return row ? present(await recover(row, userId, d), userId, d) : null;
}
export async function submitAutoRigTask(
  userId: number,
  raw: AutoRigRequest,
  d: AutoRigTaskDeps = real
) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw Error("绑骨身份无效");
  const input = autoRigRequestSchema.parse(raw),
    id = autoRigTaskId(userId, input.requestId);
  const previous = await d.load(id);
  if (previous) {
    if (!isDeepStrictEqual(inputOf(previous, userId), input))
      throw new AutoRigInputError("同一请求编号不能用于不同设置");
    return present(await recover(previous, userId, d), userId, d);
  }
  let source: Awaited<ReturnType<AutoRigTaskDeps["source"]>>;
  try {
    source = await d.source(input.sourceJobId, userId, input.assetRef);
  } catch {
    throw new AutoRigInputError("当前本人模型来源不可用，请重新读取模型后检查");
  }
  if (
    source.taskId !== input.sourceJobId ||
    source.assetRef !== input.assetRef ||
    source.bytes > 64 * 1024 * 1024 ||
    source.bytes < 20 ||
    !/^[a-f0-9]{64}$/.test(source.sha256)
  )
    throw new AutoRigInputError("模型不符合当前绑骨范围");
  if (input.stage === "bind") {
    const inspected = await getAutoRigTask(
      userId,
      input.inspectionRequestId,
      d
    );
    if (
      inspected?.status !== "succeeded" ||
      inspected.output?.stage !== "inspect" ||
      !inspected.output.inspection ||
      inspected.params.sourceJobId !== input.sourceJobId ||
      inspected.params.assetRef !== input.assetRef ||
      inspected.output.sourceSha256 !== source.sha256 ||
      inspected.output.sourceDigest !== input.sourceDigest ||
      !isDeepStrictEqual(inspected.params.settings, input.settings)
    )
      throw new AutoRigInputError("请先完成当前模型检查并重新确认关节点");
  }
  await d.insert(id, userId, input);
  const row = await d.load(id);
  if (!row || !isDeepStrictEqual(inputOf(row, userId), input))
    throw Error("请求回执未确认，请查询原编号，不要重复提交");
  return present(row, userId, d);
}
const cursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().regex(/^rig_[a-f0-9]{48}$/),
  })
  .strict();
export const autoRigCursorSchema = z
  .string()
  .max(256)
  .refine(value => {
    try {
      return cursorSchema.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  }, "历史分页位置无效");
export async function listAutoRigTasks(
  userId: number,
  assetRef: string,
  before?: string
) {
  const db = await database();
  const cursor = before ? cursorSchema.parse(JSON.parse(before)) : null;
  const time = sql`date_trunc('milliseconds',${jobs.createdAt})`;
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, String(userId)),
        eq(jobs.provider, "blender-auto-rig"),
        sql`${jobs.input}::jsonb->'params'->>'assetRef' = ${assetRef}`,
        cursor
          ? sql`(${time},${jobs.id}) < (${cursor.createdAt}::timestamptz,${cursor.id})`
          : undefined
      )
    )
    .orderBy(desc(time), desc(jobs.id))
    .limit(21);
  const items = rows.slice(0, 20).map(row => present(row, userId, real));
  return {
    items,
    nextCursor:
      rows.length > 20
        ? JSON.stringify({ createdAt: items[19].createdAt, id: rows[19].id })
        : null,
  };
}

export type AutoRigAdoptDeps = {
  get: typeof getAutoRigTask;
  source: typeof getCompletedManhua3dSource;
  original: typeof getManhua3dTask;
  inspect: typeof autoRigStorage.inspect;
  bucket: typeof autoRigStorage.bucket;
  importModel: typeof importExistingManhua3dAsset;
};
const adoptDeps: AutoRigAdoptDeps = {
  get: getAutoRigTask,
  source: getCompletedManhua3dSource,
  original: getManhua3dTask,
  inspect: autoRigStorage.inspect,
  bucket: autoRigStorage.bucket,
  importModel: importExistingManhua3dAsset,
};

/** 明确看过变形后才创建已有GLB导入记录；来源任务与原文件永久保留供恢复。 */
export async function adoptAutoRigTask(
  userId: number,
  requestId: string,
  expectedSha256: string,
  restoreSource = false,
  d: AutoRigAdoptDeps = adoptDeps
) {
  const task = await d.get(userId, requestId);
  if (
    task?.status !== "succeeded" ||
    task.params.stage !== "bind" ||
    task.output?.stage !== "bind" ||
    task.output.sha256 !== expectedSha256
  )
    throw Error("请先检查这次完整绑骨候选");
  const input = task.params;
  const source = await d.source(input.sourceJobId, userId, input.assetRef);
  if (source.sha256 !== task.output.sourceSha256)
    throw Error("原模型来源版本不一致");
  const original = await d.original(input.sourceJobId, userId);
  if (
    !original ||
    original.status !== "succeeded" ||
    original.assetRef !== input.assetRef
  )
    throw Error("原模型记录不可用");
  if (restoreSource) return original;
  const expected = `gs://${d.bucket()}/uploads/u${userId}/auto-rig/${requestId}/model.glb`;
  if (task.output.gcsUri !== expected) throw Error("绑骨候选来源不一致");
  const inspected = await d.inspect({
    gcsUri: expected,
    maxBytes: 64 * 1024 * 1024,
    timeoutMs: 30_000,
  });
  if (
    inspected.sha256 !== expectedSha256 ||
    inspected.byteLength !== task.output.bytes
  )
    throw Error("绑骨候选字节已变化，禁止采用");
  return d.importModel({
    userId,
    assetRef: input.assetRef,
    sourceVersion: original.sourceVersion,
    sourceImageUrl: original.sourceImageUrl,
    glbGcsUri: expected,
  });
}

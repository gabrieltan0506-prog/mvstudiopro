/** A single account/IP-limited production grant covers every costly step, before any provider call. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getUserPlan } from "../credits";
import { canUsePaidVideoByPlan } from "../../shared/paidVideoAccess";
import type { CodeMotionProject } from "../../shared/codeMotion";
import {
  codeMotionStorage,
  loadCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import { ensureInkFreeTable, type InkSource } from "./inkFreeQuota";

export const codeMotionProductionSlotSchema = z
  .object({
    projectId: z.string().uuid(),
    grantId: z.string().uuid(),
    kind: z.enum([
      "image",
      "video",
      "speech",
      "bgm",
      "export",
      "timing",
      "image_semantic",
    ]),
    index: z.number().int().min(0).max(5),
    requestId: z.string().min(1).max(160),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type CodeMotionProductionSlot = z.infer<
  typeof codeMotionProductionSlotSchema
>;
const grantSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().regex(/^[1-9]\d*$/),
    projectId: z.string().uuid(),
    generation: z.string(),
    tier: z.enum(["free", "paid"]),
    fingerprint: z.string(),
    sceneCount: z.number().int().min(4).max(6),
    duration: z.number().min(15).max(30),
    createdAt: z.string(),
    revision: z
      .object({
        rootProjectId: z.string().uuid(),
        rootGrantId: z.string().uuid(),
        parentProjectId: z.string().uuid(),
        number: z.number().int().min(1),
        sceneIndexes: z.array(z.number().int().min(0).max(5)).min(1).max(6),
        mode: z.enum(["code_only", "paid_video"]),
        quoteFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .optional(),
    slots: z.record(
      z.string(),
      z.object({ requestId: z.string(), digest: z.string() })
    ),
  })
  .strict();
export type CodeMotionProductionGrant = z.infer<typeof grantSchema>;
export type CodeMotionProductionGrantDeps = {
  storage: CodeMotionStoreDeps;
  plan: typeof getUserPlan;
  claim(userId: string, grantId: string, source: InkSource): Promise<void>;
};
const rows = <T>(r: unknown): T[] => (r as { rows?: T[] }).rows || [];
async function claim(userId: string, grantId: string, source: InkSource) {
  const db = await getDb();
  if (!db) throw new Error("免费名额暂时无法核对，未提交生成");
  await ensureInkFreeTable(db);
  const id = `ink_prod_${grantId}`;
  for (let attempt = 0; attempt < 11; attempt++) {
    const old = rows<{ jobId: string }>(
      await db.execute(
        sql`SELECT "jobId" FROM ink_free_claims WHERE "userId"=${userId}`
      )
    )[0];
    if (old) {
      if (old.jobId === id) return;
      throw new Error("本账号的免费制作名额已绑定其他作品，请恢复原作品");
    }
    await db.execute(
      sql`INSERT INTO ink_free_claims("userId",day,"ipHash",slot,"jobId",format) SELECT ${userId},${source.day}::date,${source.ipHash},s,${id},'mp4' FROM generate_series(1,10) s WHERE NOT EXISTS(SELECT 1 FROM ink_free_claims WHERE day=${source.day}::date AND slot=s) ORDER BY s LIMIT 1 ON CONFLICT DO NOTHING`
    );
    const own = rows<{ jobId: string }>(
      await db.execute(
        sql`SELECT "jobId" FROM ink_free_claims WHERE "userId"=${userId}`
      )
    )[0];
    if (own?.jobId === id) return;
    const sameIp = rows<{ n: number }>(
      await db.execute(
        sql`SELECT count(*)::int AS n FROM ink_free_claims WHERE day=${source.day}::date AND "ipHash"=${source.ipHash}`
      )
    )[0];
    if (sameIp?.n) throw new Error("本网络今天已有账号领取免费制作");
  }
  throw new Error("今天的新账号免费制作名额已用完");
}
const real: CodeMotionProductionGrantDeps = {
  storage: codeMotionStorage,
  plan: getUserPlan,
  claim,
};
export function codeMotionProductionId(value: string) {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function codeMotionProductionDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function codeMotionProductionFingerprint(project: CodeMotionProject) {
  if (!project.plan) throw new Error("请先保存分镜");
  return codeMotionProductionDigest({
    title: project.brief.title,
    request: project.brief.request,
    text: project.brief.text,
    duration: project.brief.duration,
    orientation: project.brief.orientation,
    scenes: project.plan.scenes.map(({ imageId, ...scene }) => ({
      ...scene,
      ...(scene.composition
        ? {
            composition: {
              ...scene.composition,
              elements: scene.composition.elements.filter(
                e => e.type !== "image"
              ),
            },
          }
        : {}),
    })),
  });
}
function path(userId: string, projectId: string) {
  z.string()
    .regex(/^[1-9]\d*$/)
    .parse(userId);
  z.string().uuid().parse(projectId);
  return `code-motion/u${userId}/production/${projectId}/grant.json`;
}
export async function getCodeMotionProductionGrant(
  userId: string,
  projectId: string,
  grantId?: string,
  deps: CodeMotionProductionGrantDeps = real
) {
  const file = await deps.storage.read(path(userId, projectId));
  if (!file) return null;
  const grant = grantSchema.parse(JSON.parse(file.body.toString()));
  if (
    grant.userId !== userId ||
    grant.projectId !== projectId ||
    (grantId && grant.id !== grantId)
  )
    throw new Error("制作授权与作品身份不一致");
  return grant;
}
export async function prepareCodeMotionProductionGrant(
  userId: string,
  input: { projectId: string; expectedGeneration: string },
  deps: CodeMotionProductionGrantDeps = real
) {
  const saved = await loadCodeMotion(userId, input.projectId, deps.storage);
  if (!saved || saved.generation !== input.expectedGeneration)
    throw new Error("作品版本已变化，请先保存后核对");
  const fingerprint = codeMotionProductionFingerprint(saved.project);
  const old = await getCodeMotionProductionGrant(
    userId,
    input.projectId,
    undefined,
    deps
  );
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw new Error("本制作已绑定已确认分镜，请恢复原分镜；不自动重复生成");
    return old;
  }
  const sceneCount = saved.project.plan!.scenes.length;
  if (sceneCount < 4 || sceneCount > 6 || saved.project.brief.duration > 30)
    throw new Error("本次一键制作限4–6镜、总时长不超过30秒");
  const speechLength = saved.project.plan!.scenes.reduce(
    (n, s) => n + (s.speech?.text.length || 0),
    0
  );
  if (speechLength > 300)
    throw new Error("本次短片旁白总计最多300字，请先精简");
  const tier = canUsePaidVideoByPlan(await deps.plan(Number(userId)))
    ? "paid"
    : "free";
  const id = codeMotionProductionId(
    `ink-production:${userId}:${input.projectId}`
  );
  const grant = grantSchema.parse({
    id,
    userId,
    projectId: input.projectId,
    generation: saved.generation,
    tier,
    fingerprint,
    sceneCount,
    duration: saved.project.brief.duration,
    createdAt: new Date().toISOString(),
    slots: {},
  });
  return grant;
}
export async function ensureCodeMotionProductionGrant(
  userId: string,
  input: { projectId: string; expectedGeneration: string; source: InkSource },
  deps: CodeMotionProductionGrantDeps = real
) {
  const grant = await prepareCodeMotionProductionGrant(userId, input, deps);
  const old = await getCodeMotionProductionGrant(
    userId,
    input.projectId,
    grant.id,
    deps
  );
  if (old) return old;
  if (grant.tier === "free") await deps.claim(userId, grant.id, input.source);
  try {
    await deps.storage.write(
      path(userId, input.projectId),
      Buffer.from(JSON.stringify(grant)),
      "0"
    );
    return grant;
  } catch (error) {
    const winner = await getCodeMotionProductionGrant(
      userId,
      input.projectId,
      grant.id,
      deps
    );
    if (winner && winner.fingerprint === grant.fingerprint) return winner;
    throw error;
  }
}

function validateSlot(
  grant: CodeMotionProductionGrant,
  input: CodeMotionProductionSlot
) {
  if (
    grant.revision &&
    input.kind !== "export" &&
    !(
      grant.revision.mode === "paid_video" &&
      grant.tier === "paid" &&
      input.kind === "video" &&
      grant.revision.sceneIndexes.length === 1 &&
      grant.revision.sceneIndexes[0] === input.index
    )
  )
    throw new Error(
      "此局部修改沿用现有素材；新增模型工具需先核对实际成本，尚未提交"
    );
  if (input.grantId !== grant.id || input.projectId !== grant.projectId)
    throw new Error("制作授权身份不一致");
  if (
    input.kind === "bgm" ||
    input.kind === "export" ||
    input.kind === "timing" ||
    input.kind === "image_semantic"
      ? input.index !== 0
      : input.index >= grant.sceneCount
  )
    throw new Error("制作步骤超过作品预算");
}
export async function reserveCodeMotionProductionSlot(
  userId: string,
  raw: CodeMotionProductionSlot,
  deps: CodeMotionProductionGrantDeps = real
) {
  const input = codeMotionProductionSlotSchema.parse(raw);
  for (let attempt = 0; attempt < 8; attempt++) {
    const file = await deps.storage.read(path(userId, input.projectId));
    if (!file) throw new Error("请先领取本作品制作名额");
    const grant = grantSchema.parse(JSON.parse(file.body.toString()));
    if (grant.userId !== userId) throw new Error("制作归属不一致");
    validateSlot(grant, input);
    const key = `${input.kind}:${input.index}`;
    const old = grant.slots[key];
    if (old) {
      if (old.requestId !== input.requestId || old.digest !== input.digest)
        throw new Error("此制作步骤已占用，请恢复原任务；不会重复付费提交");
      return grant;
    }
    if (
      grant.tier === "free" &&
      input.kind === "video" &&
      Object.keys(grant.slots).filter(k => k.startsWith("video:")).length >= 2
    )
      throw new Error(
        "免费作品最多生成2个各不超过5秒的动作镜头，请将其余镜头改为代码画面"
      );
    const saved = await loadCodeMotion(userId, input.projectId, deps.storage);
    if (
      !saved ||
      codeMotionProductionFingerprint(saved.project) !== grant.fingerprint
    )
      throw new Error("分镜已变化，未提交新生成");
    grant.slots[key] = { requestId: input.requestId, digest: input.digest };
    try {
      await deps.storage.write(
        path(userId, input.projectId),
        Buffer.from(JSON.stringify(grant)),
        file.generation
      );
      return grant;
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }
  throw new Error("制作步骤占位未确认");
}
export async function assertCodeMotionProductionSlot(
  userId: string,
  raw: CodeMotionProductionSlot,
  deps: CodeMotionProductionGrantDeps = real
) {
  const input = codeMotionProductionSlotSchema.parse(raw);
  const grant = await getCodeMotionProductionGrant(
    userId,
    input.projectId,
    input.grantId,
    deps
  );
  if (!grant) throw new Error("制作授权不存在");
  validateSlot(grant, input);
  const slot = grant.slots[`${input.kind}:${input.index}`];
  if (
    !slot ||
    slot.requestId !== input.requestId ||
    slot.digest !== input.digest
  )
    throw new Error("制作预算与请求回执不一致，未调用模型");
  return grant;
}

/** Export consumes the same grant. A failed export never refunds the spent upstream generation budget. */
export async function enqueueCodeMotionProductionExport(
  request: {
    id: string;
    userId: string;
    input: unknown;
    format: "mp4";
    provider: string;
    type: "post_prod";
  },
  slot: CodeMotionProductionSlot
) {
  const grant = await assertCodeMotionProductionSlot(request.userId, slot);
  if (
    slot.kind !== "export" ||
    slot.requestId !== request.id ||
    slot.digest !== codeMotionProductionDigest(request.input)
  )
    throw new Error("免费导出授权与任务不一致");
  const db = await getDb();
  if (!db) throw new Error("导出队列暂时不可用");
  if (grant.tier === "paid") {
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS ink_paid_production_exports ("userId" varchar(64) NOT NULL,"grantId" varchar(64) NOT NULL,"jobId" varchar(64) NOT NULL UNIQUE,PRIMARY KEY("userId","grantId"))`
    );
    const prior = rows<{
      id: string;
      userId: string;
      input: unknown;
      status: string;
    }>(
      await db.execute(
        sql`SELECT id,"userId",input,status FROM jobs WHERE id=${request.id}`
      )
    )[0];
    if (prior) {
      if (
        prior.userId !== request.userId ||
        codeMotionProductionDigest(prior.input) !==
          codeMotionProductionDigest(request.input)
      )
        throw new Error("导出任务内容不一致");
      return { jobId: prior.id, status: prior.status, cost: 0 as const };
    }
    await db.execute(
      sql`WITH bound AS (INSERT INTO ink_paid_production_exports("userId","grantId","jobId") VALUES(${request.userId},${grant.id},${request.id}) ON CONFLICT DO NOTHING RETURNING "jobId"), inserted AS (INSERT INTO jobs(id,"userId",type,provider,status,input,attempts) SELECT ${request.id},${request.userId},${request.type},${request.provider},'queued',${JSON.stringify(request.input)}::json,0 WHERE EXISTS(SELECT 1 FROM bound) OR EXISTS(SELECT 1 FROM ink_paid_production_exports WHERE "userId"=${request.userId} AND "grantId"=${grant.id} AND "jobId"=${request.id}) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted`
    );
    const saved = rows<{ id: string; status: string }>(
      await db.execute(
        sql`SELECT id,status FROM jobs WHERE id=${request.id} AND "userId"=${request.userId}`
      )
    )[0];
    if (!saved) throw new Error("导出占位未确认，请恢复原任务");
    return { jobId: saved.id, status: saved.status, cost: 0 as const };
  }
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS ink_free_production_exports ("userId" varchar(64) NOT NULL,"grantId" varchar(64) NOT NULL,"jobId" varchar(64) NOT NULL UNIQUE,PRIMARY KEY("userId","grantId"))`
  );
  await db.execute(
    sql`ALTER TABLE ink_free_production_exports ADD COLUMN IF NOT EXISTS "rootGrantId" varchar(64)`
  );
  const prior = rows<{
    id: string;
    userId: string;
    input: unknown;
    status: string;
  }>(
    await db.execute(
      sql`SELECT id,"userId",input,status FROM jobs WHERE id=${request.id}`
    )
  )[0];
  if (prior) {
    if (
      prior.userId !== request.userId ||
      codeMotionProductionDigest(prior.input) !==
        codeMotionProductionDigest(request.input)
    )
      throw new Error("导出任务内容不一致");
    return { jobId: prior.id, status: prior.status, cost: 0 as const };
  }
  await db.execute(
    sql`WITH bound AS (INSERT INTO ink_free_production_exports("userId","grantId","jobId","rootGrantId") SELECT ${request.userId},${grant.id},${request.id},${grant.revision?.rootGrantId || grant.id} WHERE EXISTS(SELECT 1 FROM ink_free_claims WHERE "userId"=${request.userId} AND "jobId"=${`ink_prod_${grant.revision?.rootGrantId || grant.id}`}) ON CONFLICT DO NOTHING RETURNING "jobId"), inserted AS (INSERT INTO jobs(id,"userId",type,provider,status,input,attempts) SELECT ${request.id},${request.userId},${request.type},${request.provider},'queued',${JSON.stringify(request.input)}::json,0 WHERE EXISTS(SELECT 1 FROM bound) OR EXISTS(SELECT 1 FROM ink_free_production_exports WHERE "userId"=${request.userId} AND "grantId"=${grant.id} AND "jobId"=${request.id}) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted`
  );
  const saved = rows<{ id: string; status: string }>(
    await db.execute(
      sql`SELECT id,status FROM jobs WHERE id=${request.id} AND "userId"=${request.userId}`
    )
  )[0];
  if (!saved) throw new Error("导出占位未确认，请恢复原任务");
  return { jobId: saved.id, status: saved.status, cost: 0 as const };
}

/** Only the server revision ledger may mint a child grant; no fresh lifetime free claim. */
export async function writeCodeMotionRevisionGrant(
  userId: string,
  project: CodeMotionProject,
  generation: string,
  parent: CodeMotionProductionGrant,
  revision: NonNullable<CodeMotionProductionGrant["revision"]>,
  storage: CodeMotionStoreDeps = codeMotionStorage
) {
  const grant = grantSchema.parse({
    ...parent,
    id: codeMotionProductionId(`ink-production:${userId}:${project.id}`),
    projectId: project.id,
    generation,
    fingerprint: codeMotionProductionFingerprint(project),
    createdAt: new Date().toISOString(),
    slots: {},
    revision,
  });
  try {
    await storage.write(
      path(userId, project.id),
      Buffer.from(JSON.stringify(grant)),
      "0"
    );
    return grant;
  } catch (error) {
    const old = await storage.read(path(userId, project.id));
    if (!old) throw error;
    const winner = grantSchema.parse(JSON.parse(old.body.toString()));
    if (
      winner.fingerprint !== grant.fingerprint ||
      JSON.stringify(winner.revision) !== JSON.stringify(revision)
    )
      throw error;
    return winner;
  }
}

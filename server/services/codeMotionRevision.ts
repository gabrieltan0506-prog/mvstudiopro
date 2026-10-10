import { z } from "zod";
import {
  codeMotionProjectSchema,
  type CodeMotionProject,
} from "../../shared/codeMotion";
import { reviseCodeMotionProject } from "../../shared/codeMotionRevision";
import {
  codeMotionStorage,
  loadCodeMotion,
  saveCodeMotion,
  type CodeMotionStoreDeps,
} from "./codeMotionStore";
import {
  codeMotionProductionDigest,
  codeMotionProductionId,
  getCodeMotionProductionGrant,
  writeCodeMotionRevisionGrant,
  type CodeMotionProductionGrant,
} from "./codeMotionProductionGrant";
import { getUserPlan } from "../credits";
import { canUsePaidVideoByPlan } from "../../shared/paidVideoAccess";
export const codeMotionRevisionInputSchema = z
  .object({
    projectId: z.string().uuid(),
    expectedGeneration: z.string().regex(/^\d+$/),
    requestId: z.string().uuid(),
    changes: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(5),
            heading: z.string().trim().min(1).max(48),
            body: z.string().trim().max(100),
            direction: z.string().trim().max(400).optional(),
          })
          .strict()
      )
      .min(1)
      .max(6),
  })
  .strict();
type Input = z.infer<typeof codeMotionRevisionInputSchema>;
type Entry = {
  requestId: string;
  digest: string;
  parentProjectId: string;
  number: number;
  project: CodeMotionProject;
  createdAt: string;
};
type Ledger = { rootProjectId: string; entries: Entry[] };
export type RevisionDeps = {
  storage: CodeMotionStoreDeps;
  grant: typeof getCodeMotionProductionGrant;
  plan: typeof getUserPlan;
  completed(userId: string, project: CodeMotionProject): Promise<boolean>;
  writeGrant: typeof writeCodeMotionRevisionGrant;
};
const real: RevisionDeps = {
  storage: codeMotionStorage,
  grant: getCodeMotionProductionGrant,
  plan: getUserPlan,
  writeGrant: writeCodeMotionRevisionGrant,
  async completed(userId, project) {
    const { findCodeMotionTask } = await import("./codeMotionTask");
    return (await findCodeMotionTask(userId, project))?.status === "succeeded";
  },
};
const ledgerName = (u: string, p: string) =>
  `code-motion/u${u}/revisions/${p}.json`;
async function context(userId: string, projectId: string, deps: RevisionDeps) {
  z.string()
    .regex(/^[1-9]\d*$/)
    .parse(userId);
  z.string().uuid().parse(projectId);
  const parent = await deps.grant(userId, projectId);
  if (!parent) throw new Error("此成片尚无可核对的制作授权，未开始局部修改");
  const rootProjectId = parent.revision?.rootProjectId || parent.projectId;
  const file = await deps.storage.read(ledgerName(userId, rootProjectId));
  const ledger: Ledger = file
    ? JSON.parse(file.body.toString())
    : { rootProjectId, entries: [] };
  if (ledger.rootProjectId !== rootProjectId)
    throw new Error("局部修改回执身份不符");
  const paid = canUsePaidVideoByPlan(await deps.plan(Number(userId)));
  return { parent, rootProjectId, file, ledger, paid };
}
export async function quoteCodeMotionRevision(
  userId: string,
  projectId: string,
  deps = real
) {
  const c = await context(userId, projectId, deps);
  const saved = await loadCodeMotion(userId, projectId, deps.storage);
  const completed = !!saved && (await deps.completed(userId, saved.project));
  return {
    tier: c.paid ? ("paid" as const) : ("free" as const),
    completed,
    used: c.ledger.entries.length,
    remaining: c.paid ? null : Math.max(0, 2 - c.ledger.entries.length),
    costCredits: 0,
    mode: "code_only" as const,
    message: c.paid
      ? "沿用素材的文字与代码画面修改不调用付费模型，工具成本为0。新增模型须另核实际工具成本×2。"
      : "每部成片可免费确认提交2次局部修改；预览不计次。",
  };
}
export async function submitCodeMotionRevision(
  userId: string,
  raw: Input,
  deps = real
) {
  const input = codeMotionRevisionInputSchema.parse(raw);
  if (new Set(input.changes.map(c => c.index)).size !== input.changes.length)
    throw new Error("同一镜头不能重复修改");
  const digest = codeMotionProductionDigest({
    projectId: input.projectId,
    expectedGeneration: input.expectedGeneration,
    changes: [...input.changes].sort((a, b) => a.index - b.index),
  });
  let winner: Entry | undefined;
  let ctx: Awaited<ReturnType<typeof context>> | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    ctx = await context(userId, input.projectId, deps);
    const old = ctx.ledger.entries.find(
      e => e.requestId === input.requestId || e.digest === digest
    );
    if (old) {
      if (old.digest !== digest)
        throw new Error("原修改编号已绑定其他内容，请恢复原修改");
      winner = old;
      break;
    }
    if (!ctx.paid && ctx.ledger.entries.length >= 2)
      throw new Error("本成片2次免费局部修改已用完，请充值升级后继续");
    const saved = await loadCodeMotion(userId, input.projectId, deps.storage);
    if (!saved || saved.generation !== input.expectedGeneration)
      throw new Error("作品版本已变化，请重新保存并核对");
    if (!(await deps.completed(userId, saved.project)))
      throw new Error("请先完成当前版本成片，再提交局部修改");
    if (
      !input.changes.some(change => {
        const scene = saved.project.plan?.scenes[change.index];
        return (
          scene &&
          (scene.heading !== change.heading ||
            scene.body !== change.body ||
            (change.direction !== undefined &&
              scene.direction !== change.direction) ||
            scene.production?.motion === "natural")
        );
      })
    )
      throw new Error("请先修改选定镜头内容，再确认提交");
    const id = codeMotionProductionId(
      `ink-revision:${userId}:${ctx.rootProjectId}:${input.requestId}`
    );
    const project = codeMotionProjectSchema.parse(
      reviseCodeMotionProject(saved.project, id, input.changes)
    );
    winner = {
      requestId: input.requestId,
      digest,
      parentProjectId: input.projectId,
      number: ctx.ledger.entries.length + 1,
      project,
      createdAt: new Date().toISOString(),
    };
    try {
      await deps.storage.write(
        ledgerName(userId, ctx.rootProjectId),
        Buffer.from(
          JSON.stringify({
            ...ctx.ledger,
            entries: [...ctx.ledger.entries, winner],
          })
        ),
        ctx.file?.generation || "0"
      );
      break;
    } catch (error) {
      winner = undefined;
      if (attempt === 7) throw error;
    }
  }
  if (!winner || !ctx) throw new Error("修改占位未确认，请恢复原编号");
  let saved = await loadCodeMotion(userId, winner.project.id, deps.storage);
  if (!saved) {
    try {
      saved = await saveCodeMotion(userId, winner.project, "0", deps.storage);
    } catch (error) {
      saved = await loadCodeMotion(userId, winner.project.id, deps.storage);
      if (!saved) throw error;
    }
  }
  const revision = {
    rootProjectId: ctx.rootProjectId,
    rootGrantId: ctx.parent.revision?.rootGrantId || ctx.parent.id,
    parentProjectId: winner.parentProjectId,
    number: winner.number,
    sceneIndexes: input.changes.map(c => c.index),
    mode: "code_only" as const,
  };
  const grant = await deps.writeGrant(
    userId,
    saved.project,
    saved.generation,
    { ...ctx.parent, tier: ctx.paid ? "paid" : "free" },
    revision,
    deps.storage
  );
  return { ...saved, grant, revisionNumber: winner.number };
}
/** Parent reuse is permitted only for assets present byte-for-byte in the confirmed revision snapshot. */
export async function codeMotionRevisionAssetParent(
  userId: string,
  projectId: string,
  kind: "audio" | "video",
  asset: unknown,
  storage = codeMotionStorage
): Promise<string | null> {
  const grant = await getCodeMotionProductionGrant(userId, projectId);
  if (!grant?.revision) return null;
  const file = await storage.read(
    ledgerName(userId, grant.revision.rootProjectId)
  );
  if (!file) return null;
  const ledger = JSON.parse(file.body.toString()) as Ledger;
  const entry = ledger.entries.find(e => e.project.id === projectId);
  const sources =
    kind === "audio"
      ? entry?.project.brief.audios
      : entry?.project.plan?.codeVideo?.assets;
  return sources?.some(
    s => codeMotionProductionDigest(s) === codeMotionProductionDigest(asset)
  )
    ? grant.revision.rootProjectId
    : null;
}

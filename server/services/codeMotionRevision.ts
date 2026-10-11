import { z } from "zod";
import {
  codeMotionProjectSchema,
  type CodeMotionProject,
} from "../../shared/codeMotion";
import {
  codeMotionRevisionChangeSchema,
  codeMotionRevisionUnsupportedVideoEdits,
  codeMotionRevisionVideoEditLimitation,
  reviseCodeMotionProject,
} from "../../shared/codeMotionRevision";
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
    confirmedQuote: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    changes: z.array(codeMotionRevisionChangeSchema).min(1).max(6),
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
  tier?: "free" | "paid";
  paidQuote?: import("./codeMotionRevisionPricing").CodeMotionRevisionPrice;
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
  const saved = await loadCodeMotion(userId, projectId, deps.storage);
  const paid = saved?.project.brief.generationTier !== "free" && canUsePaidVideoByPlan(await deps.plan(Number(userId)));
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
      ? "文字与代码画面修改工具成本为0；填写修改要求可编辑单镜原片，按实际工具用量×已公布单价×2结算积分。"
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
      if (old.paidQuote && old.paidQuote.fingerprint !== input.confirmedQuote)
        throw new Error("请恢复原确认报价");
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
    const unsupported = codeMotionRevisionUnsupportedVideoEdits(saved.project, input.changes);
    if (unsupported.length) throw new Error(codeMotionRevisionVideoEditLimitation(unsupported));
    if (
      !input.changes.some(change => {
        const scene = saved.project.plan?.scenes[change.index];
        return (
          scene &&
          (scene.heading !== change.heading ||
            scene.body !== change.body ||
            (change.direction !== undefined &&
              scene.direction !== change.direction) ||
            (change.composition !== undefined && JSON.stringify(scene.composition) !== JSON.stringify(change.composition)) ||
            scene.production?.motion === "natural" ||
            !!change.motionPrompt)
        );
      })
    )
      throw new Error("请先修改选定镜头内容，再确认提交");
    const motion = input.changes.filter(change => change.motionPrompt);
    let paidQuote:
      | import("./codeMotionRevisionPricing").CodeMotionRevisionPrice
      | undefined;
    if (motion.length) {
      if (motion.length !== 1 || input.changes.length !== 1)
        throw new Error("每次动作修改仅重做一个镜头");
      const { priceCodeMotionVideoEdit } = await import(
        "./codeMotionRevisionEdit"
      );
      paidQuote = await priceCodeMotionVideoEdit(
        userId,
        saved.project,
        motion[0],
        ctx.paid ? "paid" : "free",
        deps.storage
      );
      if (input.confirmedQuote !== paidQuote.fingerprint)
        throw new Error("请先核对并确认本次完整工具报价");
    }
    const id = codeMotionProductionId(
      `ink-revision:${userId}:${ctx.rootProjectId}:${input.requestId}`
    );
    const project = codeMotionProjectSchema.parse(
      reviseCodeMotionProject(
        saved.project,
        id,
        input.changes,
        !!paidQuote?.shot.editSource
      )
    );
    winner = {
      requestId: input.requestId,
      digest,
      parentProjectId: input.projectId,
      number: ctx.ledger.entries.length + 1,
      project,
      createdAt: new Date().toISOString(),
      tier:ctx.paid?"paid":"free",
      ...(paidQuote ? { paidQuote } : {}),
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
    mode: winner.paidQuote?.shot.editSource
      ? ("video_edit" as const)
      : winner.paidQuote
        ? ("paid_video" as const)
        : ("code_only" as const),
    ...(winner.paidQuote
      ? { quoteFingerprint: winner.paidQuote.fingerprint }
      : {}),
  };
  const previousGrant=await deps.grant(userId,saved.project.id);
  const confirmedTier=previousGrant?.tier || winner.tier || (winner.paidQuote ? (winner.paidQuote.shot.version==="2.0"?"free":"paid") : ctx.paid?"paid":"free");
  const grant = await deps.writeGrant(
    userId,
    saved.project,
    saved.generation,
    { ...ctx.parent, tier: confirmedTier },
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
  const permitted = sources?.some(
    s => codeMotionProductionDigest(s) === codeMotionProductionDigest(asset)
  );
  if (!permitted) return null;
  let parent = grant.revision.parentProjectId;
  for (let depth = 0; depth < 50; depth++) {
    const previous = ledger.entries.find(e => e.project.id === parent);
    if (!previous)
      return parent === grant.revision.rootProjectId ? parent : null;
    const original =
      kind === "audio"
        ? previous.project.brief.audios
        : previous.project.plan?.codeVideo?.assets;
    if (
      !original?.some(
        s => codeMotionProductionDigest(s) === codeMotionProductionDigest(asset)
      )
    )
      return parent;
    parent = previous.parentProjectId;
  }
  throw new Error("素材继承层级过深");
}

export async function prepareCodeMotionRevision(
  userId: string,
  raw: Input,
  deps = real
) {
  const input = codeMotionRevisionInputSchema.parse(raw),
    c = await context(userId, input.projectId, deps);
  const saved = await loadCodeMotion(userId, input.projectId, deps.storage);
  if (!saved || saved.generation !== input.expectedGeneration)
    throw new Error("作品版本已变化，请先保存");
  if (!(await deps.completed(userId, saved.project)))
    throw new Error("请先完成当前版本成片");
  if (input.changes.length !== 1 || !input.changes[0].motionPrompt)
    throw new Error("原片修改需要选择一个镜头并说明修改要求");
  if (!c.paid && c.ledger.entries.length >= 2)
    throw Error("本成片2次免费局部修改已用完，请充值升级后继续");
  const { priceCodeMotionVideoEdit } = await import("./codeMotionRevisionEdit");
  return priceCodeMotionVideoEdit(
    userId,
    saved.project,
    input.changes[0],
    c.paid ? "paid" : "free",
    deps.storage
  );
}
export async function getCodeMotionRevisionPrice(
  userId: string,
  projectId: string
) {
  const grant = await getCodeMotionProductionGrant(userId, projectId);
  if (
    !grant?.revision ||
    !["paid_video", "video_edit"].includes(grant.revision.mode)
  )
    return null;
  const file = await codeMotionStorage.read(
    ledgerName(userId, grant.revision.rootProjectId)
  );
  const ledger = file ? (JSON.parse(file.body.toString()) as Ledger) : null;
  const quote = ledger?.entries.find(
    e => e.project.id === projectId
  )?.paidQuote;
  if (!quote || quote.fingerprint !== grant.revision.quoteFingerprint)
    throw new Error("局部修改费用回执不完整");
  return quote;
}

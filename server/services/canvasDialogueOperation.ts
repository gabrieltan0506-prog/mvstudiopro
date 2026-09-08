/** 单句配音持久操作：数据库唯一占位先于上游；断线仅恢复已有音频与结算。 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs } from "../../drizzle/schema";
import { CANVAS_TTS_CREDITS_PER_LINE } from "../../shared/canvasGenerationPricing";
import { assertCanvasDialogueInputControls } from "../../shared/canvasDialogueControls";
import { getDb } from "../db";
import { getCredits } from "../credits";
import { settleCanvasDialogueCharge } from "./canvasDialogueCharge";
import { normalizeDialogueAudio } from "./postProduction";
import { synthesizeManhuaDialoguePreferred, type ManhuaDialogueTtsRouteResult } from "./manhuaDialogueTtsRoute";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs";
import { readBgmAudioWithLimit } from "./manhuaScoringRoom";

export const CANVAS_DIALOGUE_ACTION = "canvas_dialogue_line";
export const canvasDialogueInputSchema = z.object({
  billingRequestId: z.string().uuid(),
  input: z.string().trim().min(1).max(4000),
  voice: z.string().trim().min(1).max(80),
  speakerZh: z.string().trim().min(1).max(100),
  voiceStateZh: z.string().trim().max(200).default(""),
}).strict();
export type CanvasDialogueInput = z.output<typeof canvasDialogueInputSchema>;
export type CanvasDialogueResult = Pick<ManhuaDialogueTtsRouteResult, "gcsUri" | "bytes" | "voice" | "voiceGate" | "provider"> & { durationSec?: number };
export type CanvasDialogueRecord = {
  id: string; userId: string; input: { action: string; digest: string; params: CanvasDialogueInput };
  status: string; updatedAt: Date;
  output: { stage: string; upstream?: ManhuaDialogueTtsRouteResult; result?: CanvasDialogueResult } | null;
};
export type CanvasDialogueResponse = {
  jobId: string; billingRequestId: string;
  status: "running" | "succeeded" | "reconcile_manual";
  speakerZh: string; voiceStateZh: string; input: string; voice: string;
  creditsCost: number; message?: string;
  /** 仅显式原编号确认可恢复保存/结算；查询绝不扣费。 */
  canResumeSettlement: boolean;
  result?: CanvasDialogueResult & { audioUrl: string };
};
export class CanvasDialogueError extends Error {
  constructor(public kind: "conflict" | "payment" | "unavailable", message: string) { super(message); }
}
export function canvasDialogueJobId(userId: number, requestId: string): string {
  return `dlg_${createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 48)}`;
}
export function canvasDialogueDigest(input: CanvasDialogueInput): string {
  return createHash("sha256").update(JSON.stringify(canvasDialogueInputSchema.parse(input))).digest("hex");
}
export type CanvasDialogueDeps = {
  load: (id: string, userId: number) => Promise<CanvasDialogueRecord | null>;
  claim: (record: CanvasDialogueRecord) => Promise<boolean>;
  save: (id: string, userId: number, output: NonNullable<CanvasDialogueRecord["output"]>, succeeded?: boolean) => Promise<void>;
  balance: (userId: number) => Promise<number>;
  synthesize: typeof synthesizeManhuaDialoguePreferred;
  mirror: (result: ManhuaDialogueTtsRouteResult, userId: number, id: string) => Promise<CanvasDialogueResult>;
  charge: (userId: number, requestId: string) => Promise<void>;
  sign: (uri: string) => string;
};

async function database() {
  const db = await getDb();
  if (!db) throw new CanvasDialogueError("unavailable", "配音记录暂时不可用，请稍后查询原任务");
  return db;
}
const realDeps: CanvasDialogueDeps = {
  async load(id, userId) {
    const db = await database();
    const [row] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)),
      eq(jobs.type, "audio"), sql`${jobs.input}::jsonb->>'action' = ${CANVAS_DIALOGUE_ACTION}`));
    return row ? row as unknown as CanvasDialogueRecord : null;
  },
  async claim(record) {
    const db = await database();
    // 不进入 queued，通用 worker 不消费此同步操作；唯一索引即跨实例抢占门禁。
    const rows = await db.insert(jobs).values({ ...record, type: "audio", provider: "canvas-dialogue", attempts: 1 })
      .onConflictDoNothing({ target: jobs.id }).returning({ id: jobs.id });
    return rows.length === 1;
  },
  async save(id, userId, output, succeeded) {
    const db = await database();
    const rows = await db.update(jobs).set({ output, ...(succeeded ? { status: "succeeded" } : {}), updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), sql`${jobs.status} <> 'succeeded'`))
      .returning({ id: jobs.id });
    if (rows.length !== 1) {
      const [existing] = await db.select({ status: jobs.status }).from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId))));
      if (existing?.status !== "succeeded") throw new CanvasDialogueError("unavailable", "配音回执尚未保存，请查询原任务，勿重复生成");
    }
  },
  balance: async userId => (await getCredits(userId)).totalAvailable,
  synthesize: synthesizeManhuaDialoguePreferred,
  async mirror(upstream, userId, id) {
    // 地址来自本操作的服务端合成回执，绝不接受客户端提供的音频地址作为归属证据。
    if (!upstream.gcsUri.startsWith(`gs://${getGcsBucketName()}/`)) throw new Error("配音产物存储范围不一致");
    const signal = AbortSignal.timeout(60_000);
    const response = await fetch(signGsUriV4ReadUrl(upstream.gcsUri, 3600), { signal, redirect: "error" });
    if (!response.ok) throw new Error("配音产物读取未完成");
    const audio = await readBgmAudioWithLimit(response, { maxBytes: 32 * 1024 * 1024, abortSignal: signal });
    if (audio.length !== upstream.bytes) throw new Error("配音产物字节数不一致");
    const canonical = await normalizeDialogueAudio(audio, signal);
    const { gcsUri } = await uploadBufferToGcs({ objectName: `post-prod/${userId}/dialogue/${id}.wav`,
      buffer: canonical.buffer, contentType: "audio/wav", signal });
    return { gcsUri, bytes: canonical.buffer.length, durationSec: canonical.durationSec, voice: upstream.voice, voiceGate: upstream.voiceGate, provider: upstream.provider };
  },
  charge: settleCanvasDialogueCharge,
  sign: uri => signGsUriV4ReadUrl(uri, 7 * 24 * 3600),
};

function responseFor(row: CanvasDialogueRecord, deps: CanvasDialogueDeps): CanvasDialogueResponse {
  const params = row.input.params;
  const done = row.status === "succeeded" && row.output?.stage === "done" && row.output.result;
  const uncertain = !done && (row.output?.stage !== "generating" || Date.now() - new Date(row.updatedAt).getTime() > 5 * 60_000);
  return {
    jobId: row.id, billingRequestId: params.billingRequestId,
    status: done ? "succeeded" : uncertain ? "reconcile_manual" : "running",
    speakerZh: params.speakerZh, voiceStateZh: params.voiceStateZh, input: params.input, voice: params.voice,
    creditsCost: CANVAS_TTS_CREDITS_PER_LINE,
    canResumeSettlement: Boolean(!done && (row.output?.upstream || row.output?.result)),
    ...(done ? { result: { ...done, audioUrl: deps.sign(done.gcsUri) } }
      : { message: row.output?.upstream || row.output?.result
        ? "音频已保留，本次确认可继续保存与结算，不会重新合成"
        : uncertain ? "配音结果待核对，已保留原请求，请勿重新生成" : "本句正在处理，请查询原任务" }),
  };
}

export async function generateCanvasDialogue(userId: number, rawInput: CanvasDialogueInput, deps: CanvasDialogueDeps = realDeps): Promise<CanvasDialogueResponse> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new CanvasDialogueError("conflict", "登录身份无效");
  const input = canvasDialogueInputSchema.parse(rawInput);
  try { assertCanvasDialogueInputControls(input.input); }
  catch (error) { throw new CanvasDialogueError("conflict", error instanceof Error ? error.message : "语气标签不合法"); }
  const id = canvasDialogueJobId(userId, input.billingRequestId);
  const digest = canvasDialogueDigest(input);
  let row = await deps.load(id, userId);
  if (!row) {
    if (await deps.balance(userId) < CANVAS_TTS_CREDITS_PER_LINE) throw new CanvasDialogueError("payment", `本句配音需要 ${CANVAS_TTS_CREDITS_PER_LINE} 积分`);
    const fresh: CanvasDialogueRecord = { id, userId: String(userId), status: "running", updatedAt: new Date(),
      input: { action: CANVAS_DIALOGUE_ACTION, digest, params: input }, output: { stage: "generating" } };
    if (await deps.claim(fresh)) {
      let upstream: ManhuaDialogueTtsRouteResult;
      try {
        upstream = await deps.synthesize({ input: input.input, voice: input.voice, ownerUserId: userId, signal: AbortSignal.timeout(180_000) });
        if (!upstream.voiceGate.accepted || upstream.bytes <= 0) throw new Error("配音未通过验声");
      } catch {
        await deps.save(id, userId, { stage: "reconcile_manual" }).catch(() => {});
        row = await deps.load(id, userId);
        if (!row) throw new CanvasDialogueError("unavailable", "配音结果待核对，请查询原任务");
        return responseFor(row, deps);
      }
      // 保存失败只重试同一份回执，不覆盖可能已经落库的结果，更不重新调用 TTS。
      const output = { stage: "audio_received", upstream };
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
        try { await deps.save(id, userId, output); saved = true; } catch { /* 原音频仍保存在存储中。 */ }
      }
      if (!saved) throw new CanvasDialogueError("unavailable", "音频已生成但回执未能确认，请查询原任务，勿重新生成");
      row = { ...fresh, output };
    } else row = await deps.load(id, userId);
  }
  if (!row || row.userId !== String(userId) || row.input.digest !== digest) throw new CanvasDialogueError("conflict", "本次确认编号已用于其他配音内容，请核对原任务");
  if (row.status === "succeeded" || (!row.output?.upstream && !row.output?.result)) return responseFor(row, deps);
  try {
    const result = row.output.result ?? await deps.mirror(row.output.upstream!, userId, id);
    const output = { ...row.output, stage: "settlement_pending", result };
    await deps.save(id, userId, output);
    await deps.charge(userId, input.billingRequestId);
    await deps.save(id, userId, { ...output, stage: "done" }, true);
  } catch {
    // 结算结果未知时绝不显示“未扣费”；原素材与 chargeKey 留在同一任务中。
  }
  const current = await deps.load(id, userId);
  if (!current) throw new CanvasDialogueError("unavailable", "配音结果暂时无法读取，请稍后查询原任务");
  return responseFor(current, deps);
}

export async function getCanvasDialogue(userId: number, requestId: string, deps: CanvasDialogueDeps = realDeps): Promise<CanvasDialogueResponse | null> {
  const row = await deps.load(canvasDialogueJobId(userId, requestId), userId);
  return row && row.userId === String(userId) ? responseFor(row, deps) : null;
}
export async function listCanvasDialogue(userId: number, limit: number): Promise<CanvasDialogueResponse[]> {
  const db = await database();
  const rows = await db.select().from(jobs).where(and(eq(jobs.userId, String(userId)), eq(jobs.type, "audio"),
    sql`${jobs.input}::jsonb->>'action' = ${CANVAS_DIALOGUE_ACTION}`)).orderBy(desc(jobs.createdAt)).limit(limit);
  return rows.map(row => responseFor(row as unknown as CanvasDialogueRecord, realDeps));
}

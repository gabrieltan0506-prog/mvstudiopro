import { DESIGNED_VOICE_PREFIX, voiceDesignDefinitionSchema, assertDesignedVoiceText } from "../../shared/canvasVoiceDesign";
import { designedVoiceId, loadDesignedVoice, WavespeedVoicePendingError, WavespeedVoiceRejectedError } from "./wavespeedVoice";
import { assertCodeMotionProductionSlot, type CodeMotionProductionSlot } from "./codeMotionProductionGrant";
/** 单句配音持久操作：数据库唯一占位先于上游；断线仅恢复已有音频与结算。 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs } from "../../drizzle/schema";
import { CANVAS_TTS_CREDITS_PER_LINE, canvasTtsCreditsForDuration } from "../../shared/canvasGenerationPricing";
import { assertCanvasDialogueInputControls } from "../../shared/canvasDialogueControls";
import { getDb } from "../db";
import { getCredits } from "../credits";
import { settleCanvasDialogueCharge } from "./canvasDialogueCharge";
import { normalizeDialogueAudio } from "./postProduction";
import { synthesizeManhuaDialoguePreferred, type ManhuaDialogueTtsRouteResult } from "./manhuaDialogueTtsRoute";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs";
import { readBgmAudioWithLimit } from "./manhuaScoringRoom";
import { assertReferenceVoiceOwner } from "./canvasVoiceReference";
import { synthesizeQwenDialogue } from "./qwenDialogueTts";

export const CANVAS_DIALOGUE_ACTION = "canvas_dialogue_line";
export const canvasDialogueInputSchema = z.object({
  billingRequestId: z.string().uuid(),
  input: z.string().trim().min(1).max(4000),
  voice: z.string().trim().min(1).max(80),
  speakerZh: z.string().trim().min(1).max(100),
  speakerId: z.string().trim().min(1).max(120).optional(),
  voiceStateZh: z.string().trim().max(200).default(""),
}).strict();
const internalDialogueInputSchema = canvasDialogueInputSchema.extend({ voiceDesign: voiceDesignDefinitionSchema.optional() });
export type CanvasDialogueInput = z.output<typeof internalDialogueInputSchema>;
export type CanvasDialogueResult = Pick<ManhuaDialogueTtsRouteResult, "gcsUri" | "bytes" | "voice" | "voiceGate" | "provider"> & { durationSec?: number };
export type CanvasDialogueRecord = {
  id: string; userId: string; input: { action: string; digest: string; params: CanvasDialogueInput; pricingVersion?: "duration_v2"; productionSlot?: CodeMotionProductionSlot; sponsored?: boolean };
  status: string; updatedAt: Date;
  output: { stage: string; upstream?: ManhuaDialogueTtsRouteResult; result?: CanvasDialogueResult } | null;
};
export type CanvasDialogueResponse = {
  jobId: string; billingRequestId: string;
  status: "running" | "succeeded" | "reconcile_manual" | "failed";
  speakerZh: string; speakerId?: string; voiceStateZh: string; input: string; voice: string;
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
  return createHash("sha256").update(JSON.stringify(internalDialogueInputSchema.parse(input))).digest("hex");
}
export type CanvasDialogueDeps = {
  load: (id: string, userId: number) => Promise<CanvasDialogueRecord | null>;
  claim: (record: CanvasDialogueRecord) => Promise<boolean>;
  save: (id: string, userId: number, output: NonNullable<CanvasDialogueRecord["output"]>, succeeded?: boolean) => Promise<void>;
  balance: (userId: number) => Promise<number>;
  synthesize: typeof synthesizeManhuaDialoguePreferred;
  synthesizeProduction?: typeof synthesizeManhuaDialoguePreferred;
  mirror: (result: ManhuaDialogueTtsRouteResult, userId: number, id: string) => Promise<CanvasDialogueResult>;
  charge: (userId: number, requestId: string, creditsCost: number) => Promise<void>;
  sign: (uri: string) => string;
  checkVoiceOwner?: (userId: number, voice: string) => Promise<void>;
  productionGrant?: typeof assertCodeMotionProductionSlot;
};

async function database() {
  const db = await getDb();
  if (!db) throw new CanvasDialogueError("unavailable", "配音记录暂时不可用，请稍后查询原任务");
  return db;
}
const realDeps: CanvasDialogueDeps = {
  async synthesizeProduction(input) { return { ...await synthesizeQwenDialogue(input), provider: "openrouter" as const }; },
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
    // 并发轮询或写入回包丢失时，低阶段回执不能抹掉已保留的音频/结算结果。
    const receiptGuard = output.result ? undefined : output.upstream
      ? sql`${jobs.output}::jsonb->'result' IS NULL`
      : sql`${jobs.output}::jsonb->'upstream' IS NULL AND ${jobs.output}::jsonb->'result' IS NULL`;
    const rows = await db.update(jobs).set({ output, ...(succeeded ? { status: "succeeded" } : output.stage === "failed" ? { status: "failed" } : {}), updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), sql`${jobs.status} <> 'succeeded'`, receiptGuard))
      .returning({ id: jobs.id });
    if (rows.length !== 1) {
      const [existing] = await db.select({ status: jobs.status, output: jobs.output }).from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId))));
      const saved = existing?.output as CanvasDialogueRecord["output"];
      if (existing?.status !== "succeeded" && !saved?.result && !(saved?.upstream && !output.upstream)) throw new CanvasDialogueError("unavailable", "配音回执尚未保存，请查询原任务，勿重复生成");
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
  checkVoiceOwner: async (userId, voice) => {
    if (voice.startsWith(DESIGNED_VOICE_PREFIX)) { await loadDesignedVoice(userId, voice); return; }
    await assertReferenceVoiceOwner(userId, voice);
  },
};

export function canvasDialogueResponseFor(row: CanvasDialogueRecord, deps: CanvasDialogueDeps = realDeps): CanvasDialogueResponse {
  const params = row.input.params;
  const done = row.status === "succeeded" && row.output?.stage === "done" && row.output.result;
  const uncertain = !done && (!["generating", "provider_pending"].includes(row.output?.stage || "") || Date.now() - new Date(row.updatedAt).getTime() > 5 * 60_000);
  return {
    jobId: row.id, billingRequestId: params.billingRequestId,
    status: done ? "succeeded" : row.output?.stage === "failed" ? "failed" : uncertain ? "reconcile_manual" : "running",
    speakerZh: params.speakerZh, speakerId: params.speakerId, voiceStateZh: params.voiceStateZh, input: params.input, voice: params.voice,
    creditsCost: row.input.sponsored ? 0 : row.input.pricingVersion === "duration_v2" && Number.isFinite(row.output?.result?.durationSec) && (row.output?.result?.durationSec ?? 0) > 0
      ? canvasTtsCreditsForDuration(row.output!.result!.durationSec!) : row.input.pricingVersion === "duration_v2" ? 0 : CANVAS_TTS_CREDITS_PER_LINE,
    canResumeSettlement: Boolean(!done && row.output?.stage !== "failed" && (row.output?.upstream || row.output?.result || (params.voice.startsWith(DESIGNED_VOICE_PREFIX) && ["generating", "provider_pending"].includes(row.output?.stage || "")))),
    ...(done ? { result: { ...done, audioUrl: deps.sign(done.gcsUri) } }
      : { message: row.output?.stage === "failed" ? "声线生成被拒或产物未通过检查，本单没有可用音频；请核对输入后另行确认" : row.output?.upstream || row.output?.result
        ? "音频已保留，本次确认可继续保存与结算，不会重新合成"
        : row.output?.stage === "provider_pending" ? "原声线任务已提交，可继续查询与保存，不会重新合成" : uncertain ? "配音结果待核对，已保留原请求，请勿重新生成" : "本句正在处理，请查询原任务" }),
  };
}

export async function generateCanvasDialogue(userId: number, rawInput: CanvasDialogueInput, deps: CanvasDialogueDeps = realDeps, productionSlot?: CodeMotionProductionSlot): Promise<CanvasDialogueResponse> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new CanvasDialogueError("conflict", "登录身份无效");
  const input = internalDialogueInputSchema.parse(rawInput);
  if (input.voiceDesign) {
    if (input.voice !== designedVoiceId(canvasDialogueJobId(userId, input.billingRequestId))) throw new CanvasDialogueError("conflict", "设计声线编号不匹配");
  } else await (deps.checkVoiceOwner || assertReferenceVoiceOwner)(userId, input.voice);
  try { assertCanvasDialogueInputControls(input.input); if (input.voice.startsWith(DESIGNED_VOICE_PREFIX)) assertDesignedVoiceText(input.input); }
  catch (error) { throw new CanvasDialogueError("conflict", error instanceof Error ? error.message : "语气标签不合法"); }
  const id = canvasDialogueJobId(userId, input.billingRequestId);
  const digest = canvasDialogueDigest(input);
  let sponsored = false;
  if (productionSlot) {
    if (productionSlot.kind !== "speech" || productionSlot.requestId !== input.billingRequestId || productionSlot.digest !== digest) throw new CanvasDialogueError("conflict", "制作步骤与旁白请求不一致");
    const grant = await (deps.productionGrant ?? assertCodeMotionProductionSlot)(String(userId), productionSlot);
    sponsored = grant.tier === "free";
  }
  let row = await deps.load(id, userId);
  if (!row) {
    if (!sponsored && await deps.balance(userId) < 2) throw new CanvasDialogueError("payment", "配音按实测时长计费，账户至少需有 2 积分");
    const fresh: CanvasDialogueRecord = { id, userId: String(userId), status: "running", updatedAt: new Date(),
      input: { action: CANVAS_DIALOGUE_ACTION, digest, params: input, pricingVersion: "duration_v2", ...(productionSlot ? { productionSlot, sponsored } : {}) }, output: { stage: "generating" } };
    if (await deps.claim(fresh)) {
      let upstream: ManhuaDialogueTtsRouteResult;
      try {
        const synthesize = productionSlot && !input.voice.startsWith(DESIGNED_VOICE_PREFIX) ? (deps.synthesizeProduction ?? deps.synthesize) : deps.synthesize;
        upstream = await synthesize({ input: input.input, voice: input.voice, ownerUserId: userId, operationId: id, voiceDesign: input.voiceDesign, signal: AbortSignal.timeout(180_000) });
        if (!upstream.voiceGate.accepted || upstream.bytes <= 0 || (input.voice.startsWith(DESIGNED_VOICE_PREFIX) && upstream.voice !== input.voice)) throw new Error("配音未通过验声");
      } catch (error) {
        await deps.save(id, userId, { stage: error instanceof WavespeedVoicePendingError ? "provider_pending" : error instanceof WavespeedVoiceRejectedError ? "failed" : "reconcile_manual" }).catch(() => {});
        row = await deps.load(id, userId);
        if (!row) throw new CanvasDialogueError("unavailable", "配音结果待核对，请查询原任务");
        return canvasDialogueResponseFor(row, deps);
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
  if (["generating", "provider_pending"].includes(row.output?.stage || "") && input.voice.startsWith(DESIGNED_VOICE_PREFIX)) {
    try {
      const upstream = await deps.synthesize({ input: input.input, voice: input.voice, ownerUserId: userId, operationId: id, voiceDesign: input.voiceDesign, signal: AbortSignal.timeout(90_000) });
      if (!upstream.voiceGate.accepted || upstream.bytes <= 0 || (input.voice.startsWith(DESIGNED_VOICE_PREFIX) && upstream.voice !== input.voice)) throw new Error("配音未通过验声");
      await deps.save(id, userId, { stage: "audio_received", upstream });
      row = { ...row, output: { stage: "audio_received", upstream } };
    } catch (error) {
      if (!(error instanceof WavespeedVoicePendingError)) await deps.save(id, userId, { stage: error instanceof WavespeedVoiceRejectedError ? "failed" : "reconcile_manual" });
      const current = await deps.load(id, userId);
      return canvasDialogueResponseFor(current || row, deps);
    }
  }
  if (row.status === "succeeded" || (!row.output?.upstream && !row.output?.result)) return canvasDialogueResponseFor(row, deps);
  try {
    const result = row.output.result ?? await deps.mirror(row.output.upstream!, userId, id);
    if (input.voiceDesign && (!Number.isFinite(result.durationSec) || result.durationSec! < 3 || result.durationSec! > 15)) {
      await deps.save(id, userId, { ...row.output, stage: "failed" });
      const failed = await deps.load(id, userId);
      return canvasDialogueResponseFor(failed || { ...row, output: { ...row.output, stage: "failed" } }, deps);
    }
    const creditsCost = row.input.pricingVersion === "duration_v2"
      ? canvasTtsCreditsForDuration(result.durationSec ?? NaN) : CANVAS_TTS_CREDITS_PER_LINE;
    const output = { ...row.output, stage: "settlement_pending", result };
    await deps.save(id, userId, output);
    if (row.input.sponsored) {
      if (!row.input.productionSlot || (await (deps.productionGrant ?? assertCodeMotionProductionSlot)(String(userId), row.input.productionSlot)).tier !== "free") throw new Error("免费制作回执无法确认");
    } else await deps.charge(userId, input.billingRequestId, creditsCost);
    await deps.save(id, userId, { ...output, stage: "done" }, true);
  } catch {
    // 结算结果未知时绝不显示“未扣费”；原素材与 chargeKey 留在同一任务中。
  }
  const current = await deps.load(id, userId);
  if (!current) throw new CanvasDialogueError("unavailable", "配音结果暂时无法读取，请稍后查询原任务");
  return canvasDialogueResponseFor(current, deps);
}

export async function getCanvasDialogue(userId: number, requestId: string, deps: CanvasDialogueDeps = realDeps): Promise<CanvasDialogueResponse | null> {
  const row = await deps.load(canvasDialogueJobId(userId, requestId), userId);
  return row && row.userId === String(userId) ? canvasDialogueResponseFor(row, deps) : null;
}
export async function listCanvasDialogue(userId: number, limit: number): Promise<CanvasDialogueResponse[]> {
  const db = await database();
  const rows = await db.select().from(jobs).where(and(eq(jobs.userId, String(userId)), eq(jobs.type, "audio"),
    sql`${jobs.input}::jsonb->>'action' = ${CANVAS_DIALOGUE_ACTION}`, sql`${jobs.input}::jsonb->'params'->'voiceDesign' IS NULL`)).orderBy(desc(jobs.createdAt)).limit(limit);
  return rows.map(row => canvasDialogueResponseFor(row as unknown as CanvasDialogueRecord, realDeps));
}

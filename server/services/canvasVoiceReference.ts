/** 用户上传的录音只用于建立同模型 TTS 音色；绝不作为对白产物。 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getGcsBucketName, signGsUriV4ReadUrl } from "./gcs";
import { readBgmAudioWithLimit, assertBgmAudioPlayable } from "./manhuaScoringRoom";

export const REFERENCE_VOICE_MODEL = "qwen-audio-3.0-tts-plus";
export const REFERENCE_VOICE_PREFIX = "mvsref";
const ACTION = "canvas_reference_voice";
export const canvasVoiceReferenceInputSchema = z.object({
  requestId: z.string().uuid(),
  gcsUri: z.string().min(1).max(1000),
  labelZh: z.string().trim().min(1).max(80),
  consent: z.literal(true),
}).strict();
export type CanvasVoiceReferenceInput = z.output<typeof canvasVoiceReferenceInputSchema>;
type VoiceRow = { id: string; userId: string; status: string; input: { action: string; digest: string; params: CanvasVoiceReferenceInput }; output: null | { stage: string; voiceId?: string; durationSec?: number }; updatedAt: Date };
export type CanvasVoiceReferenceResponse = { requestId: string; status: "ready" | "processing" | "reconcile_manual"; labelZh: string; voiceId?: string; durationSec?: number; message?: string };

export function referenceVoiceObjectPrefix(userId: number): string {
  return `gs://${getGcsBucketName()}/uploads/u${userId}/`;
}
export function assertOwnedReference(userId: number, gcsUri: string): void {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !gcsUri.startsWith(referenceVoiceObjectPrefix(userId)) || !/\.(mp3|wav|m4a|aac)$/i.test(gcsUri))
    throw new Error("参考录音必须是本人上传的 MP3、WAV、M4A 或 AAC");
}

/** 仅接受已配置的阿里云业务空间域名，不能把密钥送往客户端或任意 URL。 */
export function resolveReferenceVoiceWorkspace(env: NodeJS.ProcessEnv = process.env): { customizationUrl: string; websocketUrl: string; apiKey: string } {
  const apiKey = String(env.DASHSCOPE_SG_API_KEY || "").trim();
  const configured = String(env.DASHSCOPE_SG_BASE || "").trim();
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("参考音色业务空间地址未配置"); }
  if (!apiKey || url.protocol !== "https:" || !/^[a-z0-9-]+\.ap-southeast-1\.maas\.aliyuncs\.com$/i.test(url.hostname))
    throw new Error("参考音色须配置新加坡百炼业务空间地址与对应服务端密钥");
  return {
    apiKey,
    customizationUrl: `${url.origin}/api/v1/services/audio/tts/customization`,
    websocketUrl: `wss://${url.hostname}/api-ws/v1/inference`,
  };
}

export async function assertReferenceVoiceOwner(userId: number, voiceId: string): Promise<void> {
  if (!voiceId.startsWith(`${REFERENCE_VOICE_MODEL}-${REFERENCE_VOICE_PREFIX}-`)) return;
  const db = await getDb();
  if (!db) throw new Error("音色资产记录暂时不可用");
  const [asset] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.userId, String(userId)), eq(jobs.type, "audio"), eq(jobs.status, "succeeded"),
    sql`${jobs.input}::jsonb->>'action' = ${ACTION}`, sql`${jobs.output}::jsonb->>'voiceId' = ${voiceId}`)).limit(1);
  if (!asset) throw new Error("此参考音色不属于当前账号或尚未建立");
}

function responseFor(row: VoiceRow): CanvasVoiceReferenceResponse {
  const ready = row.status === "succeeded" && row.output?.stage === "ready" && row.output.voiceId;
  const processing = row.status === "running" && (row.output?.stage === "deploying" || row.output?.stage === "creating" && Date.now() - new Date(row.updatedAt).getTime() < 120_000);
  return { requestId: row.input.params.requestId, labelZh: row.input.params.labelZh,
    status: ready ? "ready" : processing ? "processing" : "reconcile_manual",
    ...(ready ? { voiceId: row.output!.voiceId, durationSec: row.output!.durationSec } : { message: processing ? "正在建立参考音色，请查询原任务" : "结果待核对；请勿用同一录音立即重建" }) };
}

async function queryReferenceVoiceStatus(voiceId: string, signal: AbortSignal): Promise<"OK" | "DEPLOYING" | "UNDEPLOYED"> {
  const workspace = resolveReferenceVoiceWorkspace();
  const response = await fetch(workspace.customizationUrl, { method: "POST", signal,
    headers: { Authorization: `Bearer ${workspace.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voice-enrollment", input: { action: "query_voice", voice_id: voiceId } }) });
  if (!response.ok) throw new Error("参考音色状态暂不可查询");
  const payload = await response.json() as { output?: { status?: string; target_model?: string } };
  if (payload.output?.target_model !== REFERENCE_VOICE_MODEL) throw new Error("参考音色模型与TTS不一致");
  if (payload.output.status !== "OK" && payload.output.status !== "DEPLOYING" && payload.output.status !== "UNDEPLOYED") throw new Error("参考音色状态未知");
  return payload.output.status;
}

export async function listCanvasVoiceReferences(userId: number): Promise<CanvasVoiceReferenceResponse[]> {
  const db = await getDb();
  if (!db) throw new Error("音色资产记录暂时不可用");
  const rows = await db.select().from(jobs).where(and(eq(jobs.userId, String(userId)), eq(jobs.type, "audio"), sql`${jobs.input}::jsonb->>'action' = ${ACTION}`)).orderBy(desc(jobs.createdAt)).limit(50);
  for (const row of rows.slice(0, 5)) {
    const output = row.output as VoiceRow["output"];
    if (row.status !== "running" || (output?.stage !== "deploying" && output?.stage !== "reconcile_manual") || !output.voiceId) continue;
    try {
      const status = await queryReferenceVoiceStatus(output.voiceId, AbortSignal.timeout(10_000));
      if (status === "DEPLOYING") continue;
      const next = { ...output, stage: status === "OK" ? "ready" : "reconcile_manual" };
      await db.update(jobs).set({ output: next, status: status === "OK" ? "succeeded" : "failed", updatedAt: new Date() })
        .where(and(eq(jobs.id, row.id), eq(jobs.userId, String(userId)), eq(jobs.status, "running")));
      row.output = next;
      row.status = status === "OK" ? "succeeded" : "failed";
    } catch { /* 只查询同一 voiceId；状态未知时不重建。 */ }
  }
  return rows.map(row => responseFor(row as unknown as VoiceRow));
}

export async function createCanvasVoiceReference(userId: number, raw: CanvasVoiceReferenceInput): Promise<CanvasVoiceReferenceResponse> {
  const input = canvasVoiceReferenceInputSchema.parse(raw);
  assertOwnedReference(userId, input.gcsUri);
  const db = await getDb();
  if (!db) throw new Error("音色资产记录暂时不可用");
  const id = `vref_${createHash("sha256").update(`${userId}:${input.requestId}`).digest("hex").slice(0, 48)}`;
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const read = async () => {
    const [row] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)), eq(jobs.type, "audio")));
    return row as unknown as VoiceRow | undefined;
  };
  const existing = await read();
  if (existing) {
    if (existing.input.digest !== digest) throw new Error("参考音色请求编号已用于其他录音");
    return responseFor(existing);
  }
  // 在占位前验证真实音频，避免空对象占用任务编号；服务器只读本人上传对象。
  const signal = AbortSignal.timeout(60_000);
  const source = await fetch(signGsUriV4ReadUrl(input.gcsUri, 600), { signal, redirect: "error" });
  if (!source.ok) throw new Error("参考录音尚未上传完成");
  const audio = await readBgmAudioWithLimit(source, { maxBytes: 20 * 1024 * 1024, abortSignal: signal });
  const durationSec = await assertBgmAudioPlayable(audio, signal);
  if (durationSec < 3 || durationSec > 30) throw new Error("参考录音须为 3–30 秒清晰人声");
  const workspace = resolveReferenceVoiceWorkspace();
  const rows = await db.insert(jobs).values({ id, userId: String(userId), type: "audio", provider: "bailian-voice-enrollment", status: "running", attempts: 1,
    input: { action: ACTION, digest, params: input }, output: { stage: "creating", durationSec } }).onConflictDoNothing({ target: jobs.id }).returning({ id: jobs.id });
  if (!rows.length) {
    const row = await read();
    if (!row || row.input.digest !== digest) throw new Error("参考音色请求编号冲突");
    return responseFor(row);
  }
  let createdVoiceId: string | undefined;
  try {
    const response = await fetch(workspace.customizationUrl, {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${workspace.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voice-enrollment", input: { action: "create_voice", target_model: REFERENCE_VOICE_MODEL,
        prefix: REFERENCE_VOICE_PREFIX, url: signGsUriV4ReadUrl(input.gcsUri, 900), language_hints: ["zh"], max_prompt_audio_length: 30 } }),
    });
    const payload = await response.json() as { output?: { voice_id?: string }; code?: string };
    const voiceId = payload.output?.voice_id;
    if (!response.ok || !voiceId?.startsWith(`${REFERENCE_VOICE_MODEL}-${REFERENCE_VOICE_PREFIX}-`)) throw new Error(`参考音色建立未确认：${payload.code || response.status}`);
    createdVoiceId = voiceId;
    const result = { stage: "deploying", voiceId, durationSec };
    await db.update(jobs).set({ output: result, updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId))));
    // 创建回执只证明 ID 已存在；供应商审查 OK 后才允许TTS使用。
    const status = await queryReferenceVoiceStatus(voiceId, AbortSignal.timeout(10_000)).catch(() => "DEPLOYING" as const);
    if (status !== "DEPLOYING") {
      await db.update(jobs).set({ output: { ...result, stage: status === "OK" ? "ready" : "reconcile_manual" },
        status: status === "OK" ? "succeeded" : "failed", updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId))));
    }
  } catch {
    // 建声是否成功可能未知；保留原请求供人工核对，绝不自动重复创建。
    await db.update(jobs).set({ output: { stage: "reconcile_manual", durationSec, ...(createdVoiceId ? { voiceId: createdVoiceId } : {}) }, updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId)))).catch(() => {});
  }
  const result = await read();
  if (!result) throw new Error("参考音色回执暂时不可读取");
  return responseFor(result);
}

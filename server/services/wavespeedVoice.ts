/** 固定声样的设计/克隆；任务唯一占位与供应商回执先于轮询，绝不换声兜底。 */
import { SubmitRejectedError } from "./submitOutcomeErrors";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { DESIGNED_VOICE_PREFIX } from "../../shared/canvasVoiceDesign";
import { getDb } from "../db";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs";
import { submitWavespeedPredictionRequest, pollWavespeedWanOnce } from "./wavespeedWanVideo";
import { readBgmAudioWithLimit } from "./manhuaScoringRoom";
import { inspectTokenPlanDialogueAudio } from "./tokenPlanDialogueTts";
import { normalizeDialogueAudio } from "./postProduction";
import type { ManhuaDialogueTtsRouteInput, ManhuaDialogueTtsRouteResult } from "./manhuaDialogueTtsRoute";

export class WavespeedVoicePendingError extends Error {}
export class WavespeedVoiceRejectedError extends Error {}
const ACTION = "wavespeed_qwen_voice";
type Output = { stage: string; predictionId?: string; result?: ManhuaDialogueTtsRouteResult };
export function designedVoiceId(dialogueJobId: string): string {
  return `${DESIGNED_VOICE_PREFIX}${dialogueJobId.replace(/^dlg_/, "")}`;
}
export async function loadDesignedVoice(userId: number, voice: string): Promise<{ gcsUri: string; text: string }> {
  if (!/^wsqwen_[a-f0-9]{48}$/.test(voice)) throw new Error("设计声线编号无效");
  const db = await getDb();
  if (!db) throw new Error("声线资产暂不可读取");
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, `dlg_${voice.slice(DESIGNED_VOICE_PREFIX.length)}`),
    eq(jobs.userId, String(userId)), eq(jobs.status, "succeeded"), eq(jobs.type, "audio"),
    sql`${jobs.input}::jsonb->>'action' = 'canvas_dialogue_line'`));
  const input = row?.input as { params?: { voice?: string; input?: string; voiceDesign?: unknown } } | undefined;
  const output = row?.output as { stage?: string; result?: { gcsUri?: string; voice?: string; durationSec?: number } } | undefined;
  const result = output?.result;
  if (!input?.params?.voiceDesign || input.params.voice !== voice || output?.stage !== "done" || result?.voice !== voice ||
      !result.gcsUri?.startsWith(`gs://${getGcsBucketName()}/post-prod/${userId}/dialogue/`) ||
      !input.params.input || !(result.durationSec! >= 3 && result.durationSec! <= 15)) throw new Error("声线尚未就绪或不属于当前账号");
  return { gcsUri: result.gcsUri, text: input.params.input };
}

type VoiceTask = { digest: string; output: Output; updatedAt: Date };
export type WavespeedVoiceDeps = {
  load(id: string, userId: number): Promise<VoiceTask | null>;
  claim(id: string, userId: number, digest: string, operationId: string): Promise<boolean>;
  save(id: string, userId: number, output: Output): Promise<void>;
  reference: typeof loadDesignedVoice;
  submit: typeof submitWavespeedPredictionRequest;
  poll: typeof pollWavespeedWanOnce;
  readAudio(url: URL, signal: AbortSignal): Promise<Buffer>;
  inspect: typeof inspectTokenPlanDialogueAudio;
  normalize: typeof normalizeDialogueAudio;
  upload: typeof uploadBufferToGcs;
  sign(uri: string): string;
};
async function database() {
  const db = await getDb();
  if (!db) throw new Error("声线任务记录不可用");
  return db;
}
const taskWhere = (id: string, userId: number) => and(eq(jobs.id, id), eq(jobs.userId, String(userId)), sql`${jobs.input}::jsonb->>'action' = ${ACTION}`);
const realDeps: WavespeedVoiceDeps = {
  async load(id, userId) {
    const [row] = await (await database()).select().from(jobs).where(taskWhere(id, userId));
    return row ? { digest: (row.input as { digest: string }).digest, output: row.output as Output, updatedAt: row.updatedAt } : null;
  },
  async claim(id, userId, digest, operationId) {
    const rows = await (await database()).insert(jobs).values({ id, userId: String(userId), type: "audio", provider: "wavespeed-qwen3-tts", status: "running", attempts: 1,
      input: { action: ACTION, digest, operationId }, output: { stage: "submitting" } }).onConflictDoNothing({ target: jobs.id }).returning({ id: jobs.id });
    return rows.length === 1;
  },
  async save(id, userId, output) {
    const rows = await (await database()).update(jobs).set({ output, status: output.result ? "succeeded" : output.stage === "failed" ? "failed" : "running", updatedAt: new Date() })
      .where(and(taskWhere(id, userId), sql`${jobs.status} <> 'succeeded'`)).returning({ id: jobs.id });
    if (!rows.length && !(await this.load(id, userId))?.output.result) throw new Error("声线回执未保存");
  },
  reference: loadDesignedVoice, submit: submitWavespeedPredictionRequest, poll: pollWavespeedWanOnce,
  async readAudio(url, signal) {
    const response = await fetch(url, { signal, redirect: "error" });
    if (!response.ok) throw new Error("声线产物暂不可读取");
    return readBgmAudioWithLimit(response, { maxBytes: 32 * 1024 * 1024, abortSignal: signal });
  },
  inspect: inspectTokenPlanDialogueAudio, normalize: normalizeDialogueAudio, upload: uploadBufferToGcs,
  sign: uri => signGsUriV4ReadUrl(uri, 3600),
};
class VoiceQualityError extends WavespeedVoiceRejectedError {}
export function assertWavespeedVoiceOutputUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !(url.hostname === "d2h7xmz5gqybh9.cloudfront.net" || url.hostname === "wavespeed.ai" || url.hostname.endsWith(".wavespeed.ai"))) throw new VoiceQualityError("声线产物地址不在供应商范围");
  return url;
}
export async function synthesizeWavespeedVoice(input: ManhuaDialogueTtsRouteInput, deps: WavespeedVoiceDeps = realDeps): Promise<ManhuaDialogueTtsRouteResult> {
  if (!input.operationId) throw new Error("固定声线合成缺少持久请求编号");
  if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0) throw new Error("声线身份无效");
  // 归属检查发生在提交前，既有声样是唯一参考来源，客户端不能指定外部音频。
  const reference = input.voiceDesign ? null : await deps.reference(input.ownerUserId, input.voice);
  const body: Record<string, unknown> = input.voiceDesign
    ? { text: input.input, voice_description: input.voiceDesign.description, language: "Chinese" }
    : { text: input.input, audio: deps.sign(reference!.gcsUri), reference_text: reference!.text, language: "Chinese" };
  const digest = createHash("sha256").update(JSON.stringify({ text: input.input, voice: input.voice, design: input.voiceDesign, reference: reference?.gcsUri })).digest("hex");
  const id = `wsvoice_${createHash("sha256").update(`${input.ownerUserId}:${input.operationId}`).digest("hex").slice(0, 48)}`;
  const save = async (output: Output) => {
    for (let attempt = 0; ; attempt += 1) {
      try { await deps.save(id, input.ownerUserId, output); return; } catch (error) { if (attempt >= 2) throw error; }
    }
  };
  let row = await deps.load(id, input.ownerUserId);
  if (!row) {
    if (await deps.claim(id, input.ownerUserId, digest, input.operationId)) {
      let predictionId: string;
      try {
        ({ predictionId } = await deps.submit(`/api/v3/wavespeed-ai/qwen3-tts/${input.voiceDesign ? "voice-design" : "voice-clone"}`, body, "声线合成"));
      } catch (error) {
        if (error instanceof SubmitRejectedError) { await save({ stage: "failed" }); throw new WavespeedVoiceRejectedError("声线提交被明确拒绝，未取得可用声样"); }
        await save({ stage: "reconcile_manual" }).catch(() => {});
        throw new Error("声线提交回执待核对，请勿重新建立");
      }
      // 仅重试保存同一编号；绝不再次POST。
      await save({ stage: "polling", predictionId });
    }
    row = await deps.load(id, input.ownerUserId);
  }
  if (row?.digest !== digest) throw new Error("声线请求编号已用于不同内容");
  const output = row.output;
  if (output.result) return { ...output.result, audioUrl: deps.sign(output.result.gcsUri) };
  if (output.stage === "failed") throw new WavespeedVoiceRejectedError("原声线未通过生成或质量检查，请核对原任务");
  if (!output.predictionId) {
    if (output.stage === "submitting" && Date.now() - new Date(row.updatedAt).getTime() < 120_000) throw new WavespeedVoicePendingError("原声线任务正在提交");
    throw new Error("声线提交结果待人工核对，禁止重复提交");
  }
  const snapshot = await deps.poll(output.predictionId);
  if (snapshot.state === "running") throw new WavespeedVoicePendingError("声线仍在生成，请查询原任务");
  if (snapshot.state === "failed") {
    if (/查询被拒|通道暂不可用/.test(snapshot.error)) throw new WavespeedVoicePendingError("声线查询暂不可确认，请核对原任务");
    await save({ ...output, stage: "failed" });
    throw new WavespeedVoiceRejectedError("声线合成失败，原任务已保留");
  }
  try {
    const source = assertWavespeedVoiceOutputUrl(snapshot.sourceUrl);
    const signal = input.signal ?? AbortSignal.timeout(60_000);
    const audio = await deps.readAudio(source, signal);
    const voiceGate = await deps.inspect(audio);
    if (!voiceGate.accepted) throw new VoiceQualityError("声线音频为空或有效人声不足");
    const canonical = await deps.normalize(audio, signal);
    if (input.voiceDesign && (!Number.isFinite(canonical.durationSec) || canonical.durationSec < 3 || canonical.durationSec > 15)) throw new VoiceQualityError("声样须为3–15秒，当前产物不符合固定声线要求");
    const { gcsUri } = await deps.upload({ objectName: `manhua-dialogue-tts/${input.ownerUserId}/${id}.wav`, buffer: canonical.buffer, contentType: "audio/wav", signal });
    const result: ManhuaDialogueTtsRouteResult = { audioUrl: deps.sign(gcsUri), gcsUri, bytes: canonical.buffer.length,
      voice: input.voice, generationId: output.predictionId, provider: "wavespeed-qwen3", voiceGate };
    await save({ stage: "done", predictionId: output.predictionId, result });
    return result;
  } catch (error) {
    if (error instanceof VoiceQualityError) { await save({ ...output, stage: "failed" }); throw error; }
    throw new WavespeedVoicePendingError("声线已生成，原产物保存待恢复，不会重新合成");
  }
}

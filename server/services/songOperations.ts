/** 歌曲编辑的持久任务边界：确认后排队，单阶段只提交一次，先保存证据再消费。 */
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  songOperationPrepareSchema, songOperationConfirmSchema, songOperationReceiptSchema,
  songOperationDraftSchema, SONG_OPERATION_LABELS,
  type SongOperationDraft, type SongOperationKind, type SongOperationReceipt,
} from "../../shared/songOperations";
import { stableManhuaBgmJson } from "../jobs/manhuaBgmJobInput";
import { createJob, getJobByIdStrict, requeueJob } from "../jobs/repository";
import { deductCreditsAmount, getCredits } from "../credits";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcsIfAbsent, signGsUriV4ReadUrl } from "./gcs";
import { resolveSongOperationSource } from "./songOperationSource";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { assertBgmAudioPlayable, readBgmAudioWithLimit } from "./manhuaScoringRoom";
import { assertPublicManhuaSourceHost } from "./manhuaLearn0996Source";
import { isTtapiSunoReady, isTtapiSunoSubmissionUnknown, TtapiSunoRequestError, type TtapiSunoEvidenceSink } from "./ttapiSunoMusic";
import {
  buildTtapiSunoOperationRequest, submitTtapiSunoOperation, getTtapiSunoOperationTask,
  type TtapiSunoOperationRequest, type TtapiSunoOperationResult, type TtapiSunoOperationTask,
} from "./ttapiSunoOperations";

const uuid = z.string().uuid();
const hash = (v: unknown) => createHash("sha256").update(stableManhuaBgmJson(v)).digest("hex");
const root = (uid: number, id: string) => `song-operations/${uid}/${uuid.parse(id)}`;
export const songOperationJobId = (uid: number, id: string) => `songop_${uid}_${uuid.parse(id).replace(/-/g, "")}`;
const jobInput = (id: string) => ({action: "song_operation", params: {requestId: id}});
const error = (message: string) => new TRPCError({code: "PRECONDITION_FAILED", message});

/** 价格由用户确认后配置；未配置不是免费，任何角色都不能绕过。 */
export function configuredSongOperationPrice(operation: SongOperationKind): number | null {
  try {
    const prices = JSON.parse(process.env.SONG_OPERATION_CREDITS_JSON || "{}");
    const value = prices?.[operation];
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch { return null; }
}
async function readObject<T>(path: string): Promise<T | null> {
  try {
    const {buffer} = await downloadGcsObjectVersioned({gcsUri: `gs://${getGcsBucketName()}/${path}.json`});
    return JSON.parse(buffer.toString("utf8")) as T;
  } catch (e) {
    if (e instanceof Error && /^gcs_(?:stat|download)_failed:404(?:$|:)/.test(e.message)) return null;
    throw e;
  }
}
async function createObject(path: string, value: unknown): Promise<boolean> {
  const buffer = Buffer.from(JSON.stringify(value));
  return (await uploadBufferToGcsIfAbsent({objectName: `${path}.json`, buffer, contentType: "application/json"})).created;
}
async function fetchAudio(url: string, signal: AbortSignal): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw error("音频来源地址无效");
  await assertPublicManhuaSourceHost(parsed.hostname);
  const response = await fetch(parsed, {signal, redirect: "error"});
  if (!response.ok) throw error("音频暂时无法下载，原任务已保留");
  return readBgmAudioWithLimit(response, {abortSignal: signal, maxBytes: 128 * 1024 * 1024});
}
type OwnedSource = {gcsUri: string; musicId?: string; durationSec?: number};
type Prepared = {receipt: SongOperationReceipt; source: OwnedSource; personaId?: string};
type ResultContent = Pick<SongOperationReceipt, "variants" | "persona" | "alignment">;
export type SongOperationDeps = {
  read: <T>(path: string) => Promise<T | null>;
  create: (path: string, value: unknown) => Promise<boolean>;
  rawEvidence: (path: string, body: string) => Promise<void>;
  source: (uid: number, draft: SongOperationDraft) => Promise<OwnedSource>;
  duration: (gcsUri: string) => Promise<number>;
  price: (operation: SongOperationKind) => number | null;
  ready: () => boolean;
  sign: (gcsUri: string) => string;
  submit: typeof submitTtapiSunoOperation;
  poll: typeof getTtapiSunoOperationTask;
  mirror: (uid: number, id: string, stage: string, index: number, music: TtapiSunoOperationTask["musics"][number], signal: AbortSignal) => Promise<SongOperationReceipt["variants"][number]>;
  balance: (uid: number) => Promise<{totalAvailable: number}>;
  charge: (uid: number, cost: number, requestId: string, operation: SongOperationKind) => Promise<{success: boolean}>;
  job: typeof getJobByIdStrict;
  createJob: typeof createJob;
  requeue: typeof requeueJob;
  wait: (signal: AbortSignal) => Promise<void>;
};
export const mirrorSongOperationMedia: SongOperationDeps["mirror"] = async (uid, id, stage, index, music, signal) => {
    if (!music.audioUrl) throw error("服务未返回可用音频，原回执已保留");
    let buffer = await fetchAudio(music.audioUrl, signal);
    let durationSec = await assertBgmAudioPlayable(buffer, signal);
    if (durationSec > 3600) throw error("音频超过工作台支持的时长，原回执已保留");
    const objectName = `song-operation-media/${uid}/${id}/${stage}/${index}.mp3`;
    const saved = await uploadBufferToGcsIfAbsent({objectName, buffer, contentType: "audio/mpeg", signal});
    if (!saved.created) {
      // 已有对象不可覆盖：收据必须对应实际保存内容，不能套用此次重新下载的字节。
      buffer = (await downloadGcsObjectVersioned({gcsUri: `gs://${getGcsBucketName()}/${objectName}`})).buffer;
      durationSec = await assertBgmAudioPlayable(buffer, signal);
    }
    await createObject(`${root(uid, id)}/${stage}/media-${index}-evidence`, {objectName, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), durationSec, musicId: music.musicId});
    return {index, musicId: music.musicId, gcsUri: `gs://${getGcsBucketName()}/${objectName}`, durationSec, title: music.title, stem: music.stemType};
  };

const real: SongOperationDeps = {
  read: readObject, create: createObject,
  rawEvidence: async (path, body) => {
    await uploadBufferToGcsIfAbsent({objectName: `${path}.json`, buffer: Buffer.from(body), contentType: "application/json"});
  },
  source: async (uid, draft) => {
    const c = draft.source;
    if (c.musicJobId || /^bgm_[\w-]+:\d+$/.test(c.id)) return resolveSongOperationSource(uid, {candidateId: c.id, musicJobId: c.musicJobId, variantIndex: c.variantIndex, gcsUri: c.gcsUri});
    const gcsUri = await resolveRegisteredPostProdMediaSource({userId: String(uid), source: c.gcsUri || c.url});
    // 未登记供应商身份的上传音频只能走上传改编/续写，绝不相信客户端 musicId。
    return {gcsUri};
  },
  duration: async source => {
    const signal = AbortSignal.timeout(90_000);
    const buffer = await fetchAudio(source.startsWith("gs://") ? signGsUriV4ReadUrl(source, 600) : source, signal);
    return assertBgmAudioPlayable(buffer, signal);
  },
  price: configuredSongOperationPrice, ready: isTtapiSunoReady,
  sign: uri => signGsUriV4ReadUrl(uri, 3600), submit: submitTtapiSunoOperation, poll: getTtapiSunoOperationTask,
  mirror: mirrorSongOperationMedia,
  balance: getCredits,
  charge: (uid, cost, id, operation) => deductCreditsAmount(uid, cost, "songOperation", `歌曲${SONG_OPERATION_LABELS[operation]}`, {chargeKey: `songop:${uid}:${id}`}),
  job: getJobByIdStrict, createJob, requeue: requeueJob,
  wait: signal => delay(10_000, undefined, {signal}),
};
function canonicalDraft(draft: SongOperationDraft, sourceUri?: string) {
  const uri = sourceUri || draft.source.gcsUri || draft.source.url.split("?")[0];
  return {...draft, source: {...draft.source, url: uri, gcsUri: uri.startsWith("gs://") ? uri : draft.source.gcsUri}};
}
function refreshUrls(receipt: SongOperationReceipt, d: SongOperationDeps, source?: OwnedSource): SongOperationReceipt {
  const draft = source ? {...receipt.draft, source: {...receipt.draft.source,
    gcsUri: source.gcsUri.startsWith("gs://") ? source.gcsUri : undefined,
    url: source.gcsUri.startsWith("gs://") ? d.sign(source.gcsUri) : source.gcsUri}} : receipt.draft;
  return {...receipt, draft, variants: receipt.variants.map(v => ({...v, url: d.sign(v.gcsUri)}))};
}

/** 仅读本人的永久操作记录，不查询上游、不推进生成或扣费。 */
export async function getSavedSongOperation(uid: number, id: string, d: SongOperationDeps = real): Promise<SongOperationReceipt | null> {
  const prefix = root(uid, id);
  const prepared = await d.read<Prepared>(`${prefix}/prepared`);
  if (!prepared) return null;
  const result = await d.read<ResultContent>(`${prefix}/result`);
  if (result) {
    const settled = await d.read<{settled: boolean}>(`${prefix}/settled`);
    return refreshUrls(songOperationReceiptSchema.parse({...prepared.receipt, ...(settled?.settled ? result : {variants: []}), status: settled?.settled ? "succeeded" : "payment_pending"}), d, prepared.source);
  }
  const failure = await d.read<{status: "failed" | "reconcile_required"; error: string}>(`${prefix}/failure`);
  if (failure) return refreshUrls({...prepared.receipt, ...failure}, d, prepared.source);
  const approved = await d.read<{confirmed: boolean}>(`${prefix}/confirmed`);
  if (!approved) return refreshUrls(prepared.receipt, d, prepared.source);
  const job = await d.job(songOperationJobId(uid, id));
  if (!job || job.status === "failed") return refreshUrls({...prepared.receipt, status: "reconcile_required", error: "处理已中断，原任务和证据已保留；请恢复原任务，不要重复新建"}, d, prepared.source);
  return refreshUrls({...prepared.receipt, status: "pending"}, d, prepared.source);
}
export async function prepareSongOperation(uid: number, raw: z.input<typeof songOperationPrepareSchema>, d: SongOperationDeps = real) {
  const {requestId, draft} = songOperationPrepareSchema.parse(raw);
  const prefix = root(uid, requestId);
  const prior = await d.read<Prepared>(`${prefix}/prepared`);
  if (prior) {
    if (draft.source.gcsUri && draft.source.gcsUri !== prior.source.gcsUri) throw error("此确认编号的歌曲来源已改变");
    if (prior.receipt.inputDigest !== hash(canonicalDraft(draft, prior.source.gcsUri))) throw error("此确认编号已绑定另一份内容，请重新准备本次操作");
    return (await getSavedSongOperation(uid, requestId, d))!;
  }
  let source: OwnedSource;
  const sourceId = draft.sourceOperationId ?? draft.source.sourceOperationId;
  const sourceIndex = draft.sourceVariantIndex ?? draft.source.sourceVariantIndex;
  if ((draft.sourceOperationId && draft.source.sourceOperationId && draft.sourceOperationId !== draft.source.sourceOperationId) || (draft.sourceVariantIndex != null && draft.source.sourceVariantIndex != null && draft.sourceVariantIndex !== draft.source.sourceVariantIndex)) throw error("歌曲来源版本不一致");
  if (sourceId) {
    const sourceReceipt = await getSavedSongOperation(uid, sourceId, d);
    const variant = sourceReceipt?.variants.find(v => v.index === sourceIndex);
    if (sourceReceipt?.status !== "succeeded" || !variant || draft.source.id !== `songop_${sourceId}:${sourceIndex}` || variant.gcsUri !== draft.source.gcsUri) throw error("编辑来源尚未完成或与所选版本不一致");
    source = {gcsUri: variant.gcsUri, musicId: variant.musicId, durationSec: variant.durationSec};
  } else source = await d.source(uid, draft);
  source.durationSec ??= await d.duration(source.gcsUri);
  if (Math.abs(source.durationSec - draft.source.durationSec) > 0.1) throw error("所选音频时长与实际来源不一致，请重新载入");
  if (["replace", "persona", "align", "stems"].includes(draft.operation) && !source.musicId) throw error("此音频缺少原歌曲身份，请使用参考改编或上传续写功能");
  if (draft.operation === "extend" && !source.musicId && (draft.continueAt ?? 0) < 1) throw error("上传音频的续写位置须至少为1秒");
  let personaId: string | undefined;
  if (draft.personaRequestId) {
    if (!["cover", "extend"].includes(draft.operation)) throw error("本次操作不支持套用演唱风格");
    const persona = await getSavedSongOperation(uid, draft.personaRequestId, d);
    if (persona?.status !== "succeeded" || persona.operation !== "persona" || !persona.persona) throw error("演唱风格不存在或尚未保存成功");
    personaId = persona.persona.id;
  }
  const inputDigest = hash(canonicalDraft(draft, source.gcsUri));
  const receipt: SongOperationReceipt = {requestId, operation: draft.operation, sourceId: draft.source.id, draft, inputDigest, createdAt: new Date().toISOString(), status: "prepared", creditsCost: d.price(draft.operation), variants: []};
  const prepared: Prepared = {receipt, source, personaId};
  // 编译实际入参也在免费准备阶段检查，不能扣费后才发现合同不符。
  buildTtapiSunoOperationRequest(providerRequest(prepared, d));
  if (!await d.create(`${prefix}/prepared`, prepared)) return prepareSongOperation(uid, raw, d);
  return refreshUrls(receipt, d, source);
}
function providerRequest(p: Prepared, d: SongOperationDeps): TtapiSunoOperationRequest {
  const x = p.receipt.draft;
  const fields = {prompt: x.prompt, title: x.title, style: x.style, negativeTags: x.negativeTags, duration: x.duration, audioWeight: x.audioWeight, styleWeight: x.styleWeight, weirdnessConstraint: x.weirdnessConstraint, personaId: p.personaId};
  const audioUrl = () => p.source.gcsUri.startsWith("gs://") ? d.sign(p.source.gcsUri) : p.source.gcsUri;
  switch (x.operation) {
    case "cover": return {operation: "upload_cover", model: "suno-v6", audioUrl: audioUrl(), instrumental: x.instrumental ?? false, ...fields};
    case "extend": return p.source.musicId
      ? {operation: "extend", musicId: p.source.musicId, continueAt: x.continueAt!, ...fields}
      : {operation: "upload_extend", model: "suno-v6", audioUrl: audioUrl(), continueAt: x.continueAt!, ...fields};
    case "replace": return {operation: "replace_section", model: "suno-v6", musicId: p.source.musicId!, infillStartSec: x.startSec!, infillEndSec: x.endSec!, infillLyrics: x.prompt, title: x.title, style: x.style, negativeTags: x.negativeTags};
    case "persona": return {operation: "persona", musicId: p.source.musicId!, name: x.personaName!, description: x.personaDescription, vocalStartSec: x.startSec, vocalEndSec: x.endSec, style: x.style};
    case "align": return {operation: "aligned_lyrics", musicId: p.source.musicId!};
    case "stems": return {operation: "stems_all", musicId: p.source.musicId!};
  }
}
export async function submitSongOperation(uid: number, raw: z.input<typeof songOperationConfirmSchema>, d: SongOperationDeps = real) {
  const input = songOperationConfirmSchema.parse(raw), prefix = root(uid, input.requestId);
  const p = await d.read<Prepared>(`${prefix}/prepared`);
  if (!p || p.receipt.inputDigest !== input.inputDigest) throw error("实际发送内容未准备或已经改变，请重新核对");
  const saved = await getSavedSongOperation(uid, input.requestId, d);
  if (saved?.status === "succeeded") return saved;
  if (p.receipt.creditsCost == null || d.price(p.receipt.operation) !== p.receipt.creditsCost) throw error("本功能价格尚未确认或已变化，请稍后重新准备；未提交生成");
  if (!d.ready()) throw error("歌曲处理服务暂未就绪，未提交生成");
  if ((await d.balance(uid)).totalAvailable < p.receipt.creditsCost) throw error("积分不足，未提交本次操作");
  const id = songOperationJobId(uid, input.requestId);
  const prior = await d.job(id);
  const check = (job: NonNullable<typeof prior>) => {
    if (String(job.userId) !== String(uid) || job.type !== "audio" || stableManhuaBgmJson(job.input) !== stableManhuaBgmJson(jobInput(input.requestId))) throw error("原任务身份不一致");
  };
  if (prior) { check(prior); return saved!; }
  await d.create(`${prefix}/confirmed`, {confirmed: true, inputDigest: input.inputDigest, creditsCost: p.receipt.creditsCost, at: new Date().toISOString()});
  try { await d.createJob({id, userId: String(uid), type: "audio", provider: "song-operation", input: jobInput(input.requestId)}); }
  catch (e) { const existing = await d.job(id); if (!existing) throw e; check(existing); }
  return {...p.receipt, status: "pending" as const};
}

/** 只恢复已有确认和原任务，阶段 claim 保证不会重发未知的供应商提交。 */
export async function resumeSongOperation(uid: number, id: string, d: SongOperationDeps = real) {
  const prefix = root(uid, id);
  if (!await d.read(`${prefix}/confirmed`)) throw error("此任务尚未确认提交");
  if (await d.read(`${prefix}/failure`)) throw error("此任务需要核对原回执，不能自动重新提交");
  const jobId = songOperationJobId(uid, id), job = await d.job(jobId);
  if (!job) {
    const prepared = await d.read<Prepared>(`${prefix}/prepared`);
    if (!prepared) throw error("原任务准备记录不存在");
    // 确认落盘后队列写入失败：恢复原编号，仍复核原报价与服务状态。
    return submitSongOperation(uid, {requestId: id, inputDigest: prepared.receipt.inputDigest, confirmed: true}, d);
  }
  if (String(job.userId) !== String(uid) || job.type !== "audio" || stableManhuaBgmJson(job.input) !== stableManhuaBgmJson(jobInput(id))) throw error("原任务不存在或不属于本人");
  if (job.status === "failed") await d.requeue(jobId, "用户恢复原歌曲任务，仅继续已有阶段");
  const receipt = await getSavedSongOperation(uid, id, d);
  if (!receipt) throw error("原任务回执暂不可读取，请保留原编号");
  return receipt;
}

function formatSrt(words: NonNullable<SongOperationReceipt["alignment"]>["words"]): string {
  const stamp = (s: number) => {
    const ms = Math.round(s * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2,"0")}:${String(Math.floor(ms / 60000) % 60).padStart(2,"0")}:${String(Math.floor(ms / 1000) % 60).padStart(2,"0")},${String(ms % 1000).padStart(3,"0")}`;
  };
  return words.map((word, i) => `${i + 1}\n${stamp(word.startSec)} --> ${stamp(word.endSec)}\n${word.text}\n`).join("\n");
}
export async function runSongOperationJob(uid: number, id: string, options: {signal?: AbortSignal; onHeartbeat?: () => Promise<void> | void} = {}, d: SongOperationDeps = real): Promise<SongOperationReceipt> {
  const prefix = root(uid, id), signal = options.signal ?? new AbortController().signal;
  const p = await d.read<Prepared>(`${prefix}/prepared`);
  if (!p || !await d.read(`${prefix}/confirmed`) || p.receipt.creditsCost == null) throw error("任务缺少已确认的输入或价格，未提交");
  const fail = async (message: string, unknown = false) => {
    await d.create(`${prefix}/failure`, {status: unknown ? "reconcile_required" : "failed", error: message});
    return (await getSavedSongOperation(uid, id, d))!;
  };
  const priorFailure = await d.read(`${prefix}/failure`);
  if (priorFailure) return (await getSavedSongOperation(uid, id, d))!;
  const beat = async (phase: string) => {
    signal.throwIfAborted();
    await d.create(`${prefix}/heartbeats/${Date.now()}-${randomUUID()}`, {phase, at: new Date().toISOString()});
    await options.onHeartbeat?.();
  };
  const evidence = (stage: string): TtapiSunoEvidenceSink => {
    const callId = randomUUID();
    return async entry => {
      const path = `${prefix}/evidence/${stage}/${callId}-${entry.kind}`;
      const body = Buffer.from(entry.body);
      await d.rawEvidence(path, entry.body);
      await d.create(`${path}-receipt`, {path: `${path}.json`, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), requestPath: entry.path, httpStatus: entry.httpStatus, kind: entry.kind});
    };
  };
  const stage = async (name: string, request: TtapiSunoOperationRequest): Promise<TtapiSunoOperationResult | TtapiSunoOperationTask> => {
    const stageRoot = `${prefix}/stages/${name}`;
    const done = await d.read<TtapiSunoOperationTask>(`${stageRoot}/done`);
    if (done) return done;
    let submission = await d.read<TtapiSunoOperationResult>(`${stageRoot}/submission`);
    if (!submission) {
      signal.throwIfAborted();
      if (!await d.create(`${stageRoot}/claim`, {at: new Date().toISOString(), operation: request.operation})) throw error("原提交结果待核对，不能重复发送");
      await beat(`${name}:submitting`);
      try {
        submission = await d.submit(request, {evidence: evidence(name), abortSignal: AbortSignal.any([signal, AbortSignal.timeout(90_000)])});
        await d.create(`${stageRoot}/submission`, submission);
      } catch (e) {
        const knownRejected = e instanceof TtapiSunoRequestError && !isTtapiSunoSubmissionUnknown(e);
        await d.create(`${prefix}/failure`, {status: knownRejected ? "failed" : "reconcile_required", error: knownRejected ? "歌曲服务明确拒绝本次操作，未扣积分" : "提交结果尚待核对，原证据已保留，不会自动重提"});
        throw e;
      }
    }
    if (submission.kind !== "task") return submission;
    for (;;) {
      signal.throwIfAborted();
      const state = await d.poll(submission.taskId, {evidence: evidence(name), abortSignal: AbortSignal.any([signal, AbortSignal.timeout(60_000)])});
      await beat(`${name}:${state.status}`);
      if (state.status === "failed") {
        await d.create(`${prefix}/failure`, {status: "failed", error: "歌曲处理未成功，原任务已保留；未扣本次积分"});
        throw error("歌曲处理未成功，原任务已保留；未扣本次积分");
      }
      if (state.status === "completed") { await d.create(`${stageRoot}/done`, state); return state; }
      await d.wait(signal);
    }
  };
  const mirror = async (name: string, state: TtapiSunoOperationTask) => {
    const variants: SongOperationReceipt["variants"] = [];
    for (let index = 0; index < state.musics.length; index++) {
      const music = state.musics[index]!;
      const path = `${prefix}/stages/${name}/variant-${index}`;
      let variant = await d.read<SongOperationReceipt["variants"][number]>(path);
      if (!variant) {
        variant = await d.mirror(uid, id, name, index, music, AbortSignal.any([signal, AbortSignal.timeout(180_000)]));
        await d.create(path, variant);
      }
      variants.push(variant);
      await beat(`${name}:saved-${index}`);
    }
    return variants;
  };
  let result = await d.read<ResultContent>(`${prefix}/result`);
  if (!result) {
    try {
      const primary = await stage("primary", providerRequest(p, d));
      if ("kind" in primary) {
        if (primary.kind === "persona") result = {variants: [], persona: {id: primary.personaId, name: p.receipt.draft.personaName!, description: p.receipt.draft.personaDescription}};
        else if (primary.kind === "alignment") {
          if (primary.status !== "completed") return fail("歌词对齐尚未就绪，已保存原回执；未自动重复请求", true);
          let end = 0;
          for (const word of primary.words) {
            if (word.success === false || word.startSec < end || word.endSec <= word.startSec || word.endSec > p.source.durationSec!) return fail("歌词对齐存在失败词、时间重叠或越界，原回执保留，未采用");
            end = word.endSec;
          }
          const words = primary.words.map(({text, startSec, endSec}) => ({text, startSec, endSec}));
          result = {variants: [], alignment: {words, srt: formatSrt(words)}};
        } else throw error("歌曲任务结果尚未可用");
      } else {
        const initial = await mirror("primary", primary);
        if (["extend", "replace"].includes(p.receipt.operation)) {
          const full: SongOperationReceipt["variants"] = [];
          for (let index = 0; index < primary.musics.length; index++) {
            const music = primary.musics[index]!;
            const name = `concat-${index}`;
            const joined = await stage(name, {operation: "concat", musicId: music.musicId});
            if ("kind" in joined) throw error("完整歌曲衔接尚未返回音频");
            const joinedVariants = await mirror(name, joined);
            full.push(...joinedVariants.map(v => ({...v, index: full.length + v.index})));
          }
          result = {variants: full};
        } else result = {variants: initial};
      }
      songOperationReceiptSchema.parse({...p.receipt, ...result});
      await d.create(`${prefix}/result`, result);
    } catch (e) {
      if (signal.aborted) throw e;
      if (await d.read(`${prefix}/failure`)) return (await getSavedSongOperation(uid, id, d))!;
      // 下载、查询、持久化故障保留原句柄，允许用户恢复；不会改判为新的生成。
      throw e;
    }
  }
  signal.throwIfAborted();
  if (!await d.read(`${prefix}/settled`)) {
    const charged = await d.charge(uid, p.receipt.creditsCost, id, p.receipt.operation);
    if (!charged.success) return (await getSavedSongOperation(uid, id, d))!;
    await d.create(`${prefix}/settled`, {settled: true, creditsCost: p.receipt.creditsCost, at: new Date().toISOString()});
  }
  await beat("settled");
  return (await getSavedSongOperation(uid, id, d))!;
}

/** 当前集付费模板候选：先验完整正文并持久化，再按固定操作键扣点。 */
import { createHash } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { jobs, type InsertJob } from "../../drizzle/schema.js";
import { MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE } from "../../shared/manhuaWriterExpandPricing.js";
import { deductCreditsAmount, getCredits } from "../credits.js";
import { getDb } from "../db.js";
import { getJobByIdStrict } from "../jobs/repository.js";
import { runManhuaWriterExpand } from "./manhuaWriterExpandRun.js";
import { resolveViralTemplateForExpand } from "./manhuaViralTemplateStore.js";
import { formatManhuaViralTemplateWriterSkillFromCard } from "../../shared/manhuaViralTemplateBank.js";

const ACTION = "manhua_template_script_candidate";
const READY = "manhua_template_script_candidate_ready";
const DONE = "manhua_template_script_candidate_done";
const FAILED = "manhua_template_script_candidate_failed";
// 现有扩写主/备道各最多 5 分钟；回收门槛必须长于两道最慢总时长。
const STALE_MS = 12 * 60 * 1_000;
const COST = MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE.excellent;

export type TemplateCandidateInput = {
  userId: number;
  requestId: string;
  publicTemplateId: string;
  episodeNumber: number;
  sourceMarkdown: string;
  sourceSha256: string;
  confirmPaid: boolean;
};

export type TemplateCandidateResult = {
  requestId: string;
  episodeNumber: number;
  sourceSha256: string;
  originalBody: string;
  rewrittenBody: string;
  candidateMarkdown: string;
  changes: string[];
  publicTemplate: { publicId: string; nameZh: string };
  creditsCost: number;
  replayed: boolean;
};

export type TemplateCandidateHistoryItem = Pick<TemplateCandidateResult,
  "requestId" | "episodeNumber" | "sourceSha256" | "candidateMarkdown" | "changes" | "publicTemplate" | "creditsCost"
> & { createdAt: string };

type CandidatePayload = Pick<TemplateCandidateResult, "candidateMarkdown" | "changes" | "publicTemplate"> & {
  creditsCharged?: number;
};

export function sourceScriptSha256(sourceMarkdown: string): string {
  return createHash("sha256").update(sourceMarkdown, "utf8").digest("hex");
}

export function validateCompleteTemplateCandidate(source: string, candidate: string): void {
  const original = source.trim();
  const rewritten = candidate.trim();
  validateCompleteSourceScript(source);
  if (rewritten.length < Math.max(600, Math.ceil(original.length * 0.8)) || rewritten.length > 9000) {
    throw new Error("候选未达到完整单集剧本长度要求，本次不扣点");
  }
  const sourceDialogueCount = (original.match(/[：:][「“][^」”]{1,}/g) || []).length;
  const candidateDialogueCount = (rewritten.match(/[：:][「“][^」”]{1,}/g) || []).length;
  if (sourceDialogueCount >= 3 && candidateDialogueCount < Math.ceil(sourceDialogueCount * 0.5)) {
    throw new Error("候选缺少完整剧本的对白内容，本次不扣点");
  }
  const speakerNames = (original.match(/[\u4e00-\u9fa5A-Za-z]{1,8}[：:][「“]/g) || [])
    .map((match) => match.replace(/[：:][「“]$/, ""))
    .filter((name, index, names) => names.indexOf(name) === index);
  const retainedSpeakers = speakerNames.filter((name) => rewritten.includes(name));
  if (speakerNames.length >= 2 && retainedSpeakers.length < Math.ceil(speakerNames.length * 0.7)) {
    throw new Error("候选丢失原稿主要人物身份，本次不扣点");
  }
  if (rewritten === original) throw new Error("候选与原稿完全相同，本次不扣点");
  // 下游采用合同允许完整剧本文本 40–9000；这里从严，拒绝短梗概和输出上限截断。
}

export function validateCompleteSourceScript(source: string): void {
  const length = source.trim().length;
  if (length < 300 || length > 8000) {
    throw new Error("当前集须提供 300–8000 字符的完整剧本原文；短梗概不走付费候选");
  }
  const compact = source.replace(/\s+/g, "");
  const bigrams = new Set<string>();
  for (let i = 1; i < compact.length; i += 1) bigrams.add(compact.slice(i - 1, i + 1));
  if (bigrams.size < Math.min(100, Math.ceil(compact.length * 0.05))) {
    throw new Error("当前集原稿明显重复或缺少有效剧情，本次不发起付费候选");
  }
}

export function summarizeTemplateCandidateChanges(source: string, candidate: string): string[] {
  const left = source.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const right = candidate.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const changed: string[] = [];
  for (let index = 0; index < Math.max(left.length, right.length) && changed.length < 6; index += 1) {
    if (left[index] === right[index]) continue;
    const before = (left[index] || "（新增）").replace(/\s+/g, " ").slice(0, 170);
    const after = (right[index] || "（删减）").replace(/\s+/g, " ").slice(0, 300);
    changed.push(`第 ${index + 1} 段：${before} → ${after}`);
  }
  return changed.length ? changed : ["全篇措辞与节奏已调整，请逐段对照完整正文。"];
}

function fingerprint(input: TemplateCandidateInput): string {
  return createHash("sha256")
    .update(JSON.stringify([input.userId, input.publicTemplateId, input.episodeNumber, input.sourceSha256]))
    .digest("hex");
}

function jobId(input: TemplateCandidateInput): string {
  return `manhua_template_candidate_${createHash("sha256")
    // 同一用户、集次、原稿和模板只能结算一版；不同浏览器/请求编号也共用操作行。
    .update(fingerprint(input))
    .digest("hex")
    .slice(0, 36)}`;
}

function storedObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedPayload(output: unknown, action: string): CandidatePayload | null {
  const object = storedObject(output);
  if (object.action !== action) return null;
  const payload = storedObject(object.payload);
  const pub = storedObject(payload.publicTemplate);
  if (
    typeof payload.candidateMarkdown !== "string" ||
    !Array.isArray(payload.changes) ||
    payload.changes.length < 1 || payload.changes.length > 6 ||
    !payload.changes.every((x) => typeof x === "string" && x.length <= 800) ||
    typeof pub.publicId !== "string" ||
    typeof pub.nameZh !== "string" ||
    (payload.creditsCharged !== undefined &&
      (typeof payload.creditsCharged !== "number" || !Number.isInteger(payload.creditsCharged) || payload.creditsCharged < 0 || payload.creditsCharged > COST))
  ) return null;
  return {
    candidateMarkdown: payload.candidateMarkdown,
    changes: payload.changes as string[],
    publicTemplate: { publicId: pub.publicId, nameZh: pub.nameZh },
    creditsCharged: payload.creditsCharged as number | undefined,
  };
}

function result(input: TemplateCandidateInput, payload: CandidatePayload, replayed: boolean): TemplateCandidateResult {
  validateCompleteTemplateCandidate(input.sourceMarkdown, payload.candidateMarkdown);
  return {
    requestId: input.requestId,
    episodeNumber: input.episodeNumber,
    sourceSha256: input.sourceSha256,
    originalBody: input.sourceMarkdown,
    rewrittenBody: payload.candidateMarkdown,
    candidateMarkdown: payload.candidateMarkdown,
    changes: payload.changes,
    publicTemplate: payload.publicTemplate,
    creditsCost: payload.creditsCharged ?? COST,
    replayed,
  };
}

export async function generateManhuaTemplateCandidate(input: TemplateCandidateInput): Promise<TemplateCandidateResult> {
  if (sourceScriptSha256(input.sourceMarkdown) !== input.sourceSha256) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "原稿指纹不一致，请刷新当前集原稿后重试" });
  }
  try { validateCompleteSourceScript(input.sourceMarkdown); }
  catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: String((error as Error).message) }); }
  if (!input.confirmPaid) {
    throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `生成完整单集候选将扣除 ${COST} 积分/版，请确认后提交` });
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "剧本候选记录暂不可用，请稍后重试" });
  const id = jobId(input);
  const fp = fingerprint(input);
  const requestRows = await db.select({ input: jobs.input }).from(jobs).where(and(
    eq(jobs.userId, String(input.userId)),
    sql`${jobs.input}->>'action' = ${ACTION}`,
    sql`${jobs.input}->>'requestId' = ${input.requestId}`,
  )).orderBy(desc(jobs.createdAt)).limit(1);
  const priorRequest = requestRows.find(row => storedObject(row.input).requestId === input.requestId);
  if (priorRequest && storedObject(priorRequest.input).requestFingerprint !== fp) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "同一操作编号已绑定另一份原稿或模板，请新建候选请求" });
  }
  const inserted = await db.insert(jobs).values({
    id,
    userId: String(input.userId),
    type: "platform",
    provider: "openai",
    status: "running",
    attempts: 1,
    input: { action: ACTION, requestId: input.requestId, requestFingerprint: fp, sourceSha256: input.sourceSha256,
      publicTemplateId: input.publicTemplateId, episodeNumber: input.episodeNumber },
    output: null,
  } as InsertJob).onConflictDoNothing({ target: jobs.id }).returning({ id: jobs.id });
  const current = inserted.length ? null : await getJobByIdStrict(id);
  if (current) {
    if (current.userId !== String(input.userId) || storedObject(current.input).requestFingerprint !== fp) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "同一操作编号已绑定另一份原稿或模板，请新建候选请求" });
    }
    const done = storedPayload(current.output, DONE);
    if (current.status === "succeeded" && done) return result(input, done, true);
    if (current.status === "succeeded") {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "已结算候选记录不可读取，请联系支持核对原请求编号" });
    }
    if (current.status === "failed") {
      if (storedObject(current.input).requestId === input.requestId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "这次候选生成失败且未扣点，请新建候选请求" });
      }
      const restarted = await db.update(jobs).set({ status: "running", attempts: (current.attempts || 1) + 1,
        input: { ...storedObject(current.input), requestId: input.requestId }, output: null, error: null,
        updatedAt: new Date() })
        .where(and(eq(jobs.id, id), eq(jobs.status, "failed")))
        .returning({ id: jobs.id });
      if (!restarted.length) throw new TRPCError({ code: "CONFLICT", message: "同一模板候选正在重新生成，请稍后恢复原请求" });
    } else {
      const ready = storedPayload(current.output, READY);
      if (ready) {
        try { return await settleReadyCandidate(db, id, input, ready, true); }
        catch {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "候选已保存，结算结果待确认；请使用原请求编号重试" });
        }
      }
      const staleAt = new Date(Date.now() - STALE_MS);
      if (current.status !== "running" || !current.updatedAt || current.updatedAt >= staleAt) {
        throw new TRPCError({ code: "CONFLICT", message: "本次候选仍在生成，请稍后用同一请求编号查询" });
      }
      const reclaimed = await db.update(jobs).set({ attempts: (current.attempts || 1) + 1, updatedAt: new Date() })
        .where(and(eq(jobs.id, id), eq(jobs.status, "running"), lt(jobs.updatedAt, staleAt), sql`${jobs.output} IS NULL`))
        .returning({ id: jobs.id });
      if (!reclaimed.length) throw new TRPCError({ code: "CONFLICT", message: "本次候选仍在生成，请稍后重试" });
    }
  }

  try {
    const credits = await getCredits(input.userId);
    if (credits.totalAvailable < COST) {
      throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `积分不足，完整单集候选需要 ${COST} 点` });
    }
    const resolved = await resolveViralTemplateForExpand(input.publicTemplateId);
    if ("error" in resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "所选公开模板已下架或不可用，本次未扣点" });
    const skill = formatManhuaViralTemplateWriterSkillFromCard(resolved.card);
    if (!skill) throw new TRPCError({ code: "BAD_REQUEST", message: "模板内容不完整，本次未扣点" });
    const prompt = [
      "请依据以下已审核创作模板，把用户当前这一集的完整剧本改写成一版完整候选。",
      "只输出改写后这一集的完整 Markdown 剧本正文，不输出解释、摘要或对照表。",
      "保留本集核心人物身份、关键因果、段落与对白、结尾钩子；可按模板强化开场、冲突、反转和表演。",
      "不得改写其他集；不得凭空宣称已修改正式项目；原稿长时也必须完整写完，不得用省略号或‘同上’代替正文。",
      `【模板】\n${skill}`,
      `【第 ${input.episodeNumber} 集完整原稿】\n${input.sourceMarkdown}`,
    ].join("\n\n");
    const candidateMarkdown = (await runManhuaWriterExpand({ prompt, tier: "excellent", episodeCount: 1 })).trim();
    validateCompleteTemplateCandidate(input.sourceMarkdown, candidateMarkdown);
    const payload: CandidatePayload = {
      candidateMarkdown,
      changes: summarizeTemplateCandidateChanges(input.sourceMarkdown, candidateMarkdown),
      publicTemplate: resolved.appliedTemplate,
    };
    const saved = await db.update(jobs).set({ output: { action: READY, payload }, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.status, "running"), sql`${jobs.output} IS NULL`))
      .returning({ id: jobs.id });
    if (!saved.length) throw new Error("候选暂存冲突，请使用原请求编号查询；本次未扣点");
    return settleReadyCandidate(db, id, input, payload, false);
  } catch (error) {
    const row = await getJobByIdStrict(id).catch(() => null);
    if (row?.status === "running" && storedPayload(row.output, READY)) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "候选已保存，结算结果待确认；请使用原请求编号重试，系统不会重复扣点",
      });
    }
    if (row?.status === "running" && row.output === null) {
      const marked = await db.update(jobs).set({ status: "failed", output: { action: FAILED },
        error: error instanceof Error ? error.message.slice(0, 2000) : "生成失败", updatedAt: new Date() })
        .where(and(eq(jobs.id, id), eq(jobs.status, "running"), sql`${jobs.output} IS NULL`))
        .returning({ id: jobs.id });
      if (marked.length) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message:
          error instanceof TRPCError ? `${error.message}；该请求已结束且未扣点，请重新提交` :
            "完整候选未生成，该请求已结束且未扣点，请重新提交" });
      }
    }
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `完整候选未生成，本次未扣点：${error instanceof Error ? error.message : String(error)}` });
  }
}

/** 已完成且已结算的匿名候选；仅按当前登录用户、当前集、原稿指纹检索，不回传原稿或商业模板。 */
export async function listManhuaTemplateCandidateHistory(input: {
  userId: number;
  episodeNumber: number;
  sourceSha256: string;
}): Promise<{ candidates: TemplateCandidateHistoryItem[] }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "候选历史暂不可用，请稍后重试" });
  const rows = await db.select({
    userId: jobs.userId, status: jobs.status, input: jobs.input,
    output: jobs.output, createdAt: jobs.createdAt,
  }).from(jobs).where(and(
    eq(jobs.userId, String(input.userId)),
    eq(jobs.status, "succeeded"),
    sql`${jobs.input}->>'action' = ${ACTION}`,
    sql`${jobs.input}->>'sourceSha256' = ${input.sourceSha256}`,
    sql`${jobs.input}->>'episodeNumber' = ${String(input.episodeNumber)}`,
  )).orderBy(desc(jobs.createdAt)).limit(100);
  const candidates: TemplateCandidateHistoryItem[] = [];
  const seenTemplates = new Set<string>();
  for (const row of rows) {
    const details = storedObject(row.input);
    const requestId = String(details.requestId || "");
    const publicTemplateId = String(details.publicTemplateId || "");
    if (row.userId !== String(input.userId) || row.status !== "succeeded" ||
      details.action !== ACTION || details.sourceSha256 !== input.sourceSha256 ||
      Number(details.episodeNumber) !== input.episodeNumber ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
      !/^mt_[a-z0-9]{4,16}$/i.test(publicTemplateId)) continue;
    const expected = fingerprint({ ...input, requestId, publicTemplateId, sourceMarkdown: "", confirmPaid: true });
    if (details.requestFingerprint !== expected) continue;
    const payload = storedPayload(row.output, DONE);
    if (!payload || payload.publicTemplate.publicId !== publicTemplateId ||
      payload.candidateMarkdown.length < 600 || payload.candidateMarkdown.length > 9000) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "已付费候选记录无法读取，请联系支持核对原请求编号" });
    }
    if (seenTemplates.has(publicTemplateId)) continue;
    seenTemplates.add(publicTemplateId);
    candidates.push({
      requestId,
      episodeNumber: input.episodeNumber,
      sourceSha256: input.sourceSha256,
      candidateMarkdown: payload.candidateMarkdown,
      changes: payload.changes,
      publicTemplate: payload.publicTemplate,
      creditsCost: payload.creditsCharged ?? COST,
      createdAt: row.createdAt.toISOString(),
    });
    if (candidates.length === 2) break;
  }
  return { candidates };
}

async function settleReadyCandidate(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  id: string,
  input: TemplateCandidateInput,
  payload: CandidatePayload,
  replayed: boolean,
): Promise<TemplateCandidateResult> {
  // 候选先保存于 jobs；扣点与 chargeKey 日志原子提交。成功写终态失败时，同 ID 重试只结算已存候选。
  const chargeKey = `mt_candidate_${id}`.slice(0, 120);
  const receipt = await deductCreditsAmount(input.userId, COST, "manhuaWriterExpand", "公开模板·完整单集剧本候选", { chargeKey });
  if (!receipt.success) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "候选扣点未完成，请用原请求编号重试" });
  const settledPayload: CandidatePayload = { ...payload, creditsCharged: receipt.cost };
  const changed = await db.update(jobs).set({ status: "succeeded", output: { action: DONE, payload: settledPayload }, updatedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running"), sql`${jobs.output}->>'action' = ${READY}`))
    .returning({ id: jobs.id });
  if (!changed.length) {
    const row = await getJobByIdStrict(id);
    if (row?.status !== "succeeded" || !storedPayload(row.output, DONE)) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "候选已扣点但结果仍在恢复，请用原请求编号重试" });
    }
  }
  return result(input, settledPayload, replayed || Boolean("alreadyCharged" in receipt && receipt.alreadyCharged));
}

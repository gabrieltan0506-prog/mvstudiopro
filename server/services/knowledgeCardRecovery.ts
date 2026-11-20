import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { downloadGcsObjectVersioned, uploadBufferToGcs, getGcsBucketName, signGcsObjectPathV4ReadUrl } from "./gcs";
import { HandbookManuscriptError } from "./handbookManuscriptStage";

type Row = { id: string; userId: string; status: string; input: unknown; output: unknown; createdAt: Date };
const recordedModel = (params: Record<string, any>, output: Record<string, any>) =>
  String(output.knowledgeCardBillingModel || output.distillModel || params.distillModel || "");
const object = (v: unknown): Record<string, any> => { if (typeof v === "string") { try { return object(JSON.parse(v)); } catch { return {}; } } return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {}; };
export function recoveryDraft(row: Row) {
  const input = object(row.input), output = object(row.output), params = object(input.params);
  const markdown = input.action === "platform_composite_sheet_progress" && params.kind === "single_page_knowledge_card"
    ? String(params.scriptContext || "") : ["knowledge_card_distill", "knowledge_card_derive_level"].includes(input.action) ? String(output.distilledMarkdown || "") : "";
  if (row.status !== "succeeded" || !markdown.trim()) return null;
  const image = input.action === "platform_composite_sheet_progress";
  const settings = image ? [params.notePageTotal, recordedModel(params, output), params.subjectPosition, params.openaiImageVariant, params.infographicTemplateId].map(v => v ?? null) : [];
  return { markdown, input, output, params, image, key: createHash("sha256").update(JSON.stringify([markdown, settings])).digest("hex") };
}
/**
 * 1119 C4 双形态：大稿出图任务行只存 params.manuscriptDigest（不存全文）。这里按任务行所属用户取回已封存全文，
 * 补成与旧形态相同的 params.scriptContext 视图，之后的 recoveryDraft / 恢复键 / 组装逻辑与旧行完全一样。
 * 旧行（带 scriptContext）原样返回；确定取不回（未封存/内容不符）的行不参与恢复（不猜文本）；暂时读不到则整体报错，不报部分成功。
 */
const STAGED_DIGEST = /^[a-f0-9]{64}$/;
export type StagedManuscriptLoader = (userId: number, digest: string) => Promise<string>;
const defaultStagedLoader: StagedManuscriptLoader = async (userId, digest) =>
  (await import("./handbookManuscriptStage")).loadHandbookManuscript(userId, digest);
export async function hydrateStagedManuscriptRows<T extends Row>(rows: T[], load: StagedManuscriptLoader = defaultStagedLoader, strict = false): Promise<T[]> {
  const texts = new Map<string, Promise<string | null>>();
  return (await Promise.all(rows.map(async row => {
    const input = object(row.input), params = object(input.params);
    const digest = params.manuscriptDigest;
    if (input.action !== "platform_composite_sheet_progress" || params.kind !== "single_page_knowledge_card" || params.scriptContext || typeof digest !== "string" || !STAGED_DIGEST.test(digest)) return row;
    const key = `${row.userId}:${digest}`;
    // 非严格模式只跳过「确定取不回」的行（未封存/内容不符）；暂时读不到必须报错，不能把缺图的恢复结果当完整成功返回
    if (!texts.has(key)) texts.set(key, load(Number(row.userId), digest).catch(error => { if (strict || !stagedManuscriptGone(error)) throw error; return null; }));
    const text = await texts.get(key)!;
    if (text === null) return null;
    return { ...row, input: { ...input, params: { ...params, scriptContext: text } } };
  }))).filter((row): row is Awaited<T> => row !== null) as T[];
}
const stagedManuscriptGone = (error: unknown) =>
  error instanceof HandbookManuscriptError && (error.code === "NOT_FOUND" || error.code === "CONFLICT");
const stagedDigestOf = (markdown: string) => createHash("sha256").update(markdown, "utf8").digest("hex");

export function assembleRecovery(userId: string, anchor: Row, rows: Row[]) {
  if (anchor.userId !== userId) throw new Error("无法读取这份备份");
  const draft = recoveryDraft(anchor);
  if (!draft) throw new Error("这份任务没有可恢复的成品");
  const candidates = rows.filter(r => r.userId === userId).map(row => ({row,draft:recoveryDraft(row)})).filter(x => x.draft && (x.draft.markdown === draft.markdown || (!x.draft.image && x.draft.output.fullEditionMarkdown === draft.markdown)));
  // Text-only recovery must not silently pick a different layout/model. Image sets are separate choices.
  const imageRows = draft.image ? candidates.filter(x => x.draft?.image && x.draft.key === draft.key).sort((a,b) => +new Date(b.row.createdAt)- +new Date(a.row.createdAt) || b.row.id.localeCompare(a.row.id)) : [];
  const total = draft.image ? Number(draft.params.notePageTotal) : 0;
  if (!Number.isSafeInteger(total) || total < 0 || (draft.image && total < 1)) throw new Error("备份页码无效");
  const images: Array<{page:number;jobId:string;url:string}> = [];
  const seen = new Set<number>();
  for (const x of imageRows) {
    const page = Number(x.draft!.params.notePageIndex), url = String(x.draft!.output.compositeImageUrl || "");
    if (!Number.isSafeInteger(page) || page < 1 || page > total || !/^https:\/\//.test(url) || seen.has(page)) continue;
    seen.add(page); images.push({page, jobId:x.row.id, url});
  }
  images.sort((a,b)=>a.page-b.page);
  const textEntry = draft.image ? candidates.find(x=>!x.draft!.image) : {row:anchor,draft};
  const textSource=textEntry?.draft;
  const level = textSource?.output.detailLevel === "full" || (draft.image&&textSource?.output.fullEditionMarkdown===draft.markdown) ? "full" as const : "concise" as const;
  return { jobId:anchor.id, markdown:draft.markdown, detailLevel:level,
    fullMarkdown: String(textSource?.output.fullEditionMarkdown || "") || (textSource?.input.action === "knowledge_card_derive_level" ? String(textSource.params.fullMarkdown || "") || null : level === "full" ? draft.markdown : null),
    conciseMarkdown: typeof textSource?.output.fullEditionMarkdown=== "string" ? String(textSource.output.distilledMarkdown||"") : null,
    verificationJobId:textSource?.output.verificationProcessed===true?textEntry!.row.id:null,
    distillModel:recordedModel(draft.params, draft.output),
    subjectPosition:draft.params.subjectPosition === "center" ? "center" as const : "left" as const,
    infographicTemplateId:typeof draft.params.infographicTemplateId === "string" ? draft.params.infographicTemplateId : null,
    total, images };
}
async function database() { const db = await getDb(); if (!db) throw new Error("暂时无法读取云端备份，请稍后重试"); return db; }
const eligible = sql`(${jobs.input}->>'action' in ('knowledge_card_distill','knowledge_card_derive_level') or (${jobs.input}->>'action' = 'platform_composite_sheet_progress' and ${jobs.input}->'params'->>'kind' = 'single_page_knowledge_card'))`;
// 删除恢复入口使用本人备份指纹；原任务、计费凭证和已采用的图片不受影响。
const deletionPath=(userId:string,key:string)=>`knowledge-recovery/user-${userId}/deleted/${key}.json`;
const deletionStore={
  read:async(path:string)=>{try{await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${path}`});return true;}catch(e){if(e instanceof Error&&e.message==="gcs_stat_failed:404")return false;throw e;}},
  save:async(path:string)=>{await uploadBufferToGcs({objectName:path,buffer:Buffer.from(JSON.stringify({deletedAt:new Date().toISOString()})),contentType:"application/json"});},
};
export async function markKnowledgeRecoveryDeleted(userId:string,anchor:Row,store=deletionStore){
  if(anchor.userId!==userId)throw Error("无法删除这份备份");
  const draft=recoveryDraft(anchor);if(!draft)throw Error("这份任务没有可删除的备份");
  await store.save(deletionPath(userId,draft.key));return {key:draft.key};
}
export async function deleteKnowledgeCardRecovery(userId:string,jobId:string){
  const db=await database();
  const [rawAnchor]=await db.select().from(jobs).where(and(eq(jobs.id,jobId),eq(jobs.userId,userId))).limit(1);
  if(!rawAnchor)throw Error("无法删除这份备份");
  const [anchor]=await hydrateStagedManuscriptRows([rawAnchor],undefined,true);
  return markKnowledgeRecoveryDeleted(userId,anchor);
}
/** 续作沿用原单及其检查点。已领取的任务只跟踪；明确取消的任务保持终止。 */
async function latestVerification(userId: string, includeDraft=false) {
  const db = await database();
  const [last] = await db.select({
    id: jobs.id, status: jobs.status, attempts: jobs.attempts,
    manuscript: includeDraft ? sql<string | null>`case when ${jobs.status} <> 'succeeded' then ${jobs.input}->'params'->>'fullMarkdown' end` : sql<null>`null`,
    model: sql<string | null>`${jobs.input}->'params'->>'distillModel'`,
    action: sql<string>`${jobs.input}->>'action'`,
    cancelled: sql<string | null>`${jobs.input}->>'cancelRequestedAt'`,
  }).from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.type, "platform"),
    sql`${jobs.input}->>'action' in ('knowledge_card_distill', 'knowledge_card_derive_level')`
  )).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(1);
  if (!last || last.action !== "knowledge_card_derive_level") throw new Error("最近一次读档还没有可接续的核实任务");
  if (last.cancelled) throw new Error("原任务已手动终止");
  return last;
}

export async function getLastKnowledgeVerificationDraft(userId:string) {
  const last = await latestVerification(userId,true);
  if (last.status !== "succeeded" && !last.manuscript?.trim()) throw new Error("原任务没有可回填的正文");
  return {jobId:last.id, markdown:last.manuscript || "", model:last.model || "", finished:last.status==="succeeded"};
}

export async function resumeLastKnowledgeVerification(userId: string, expectedId?:string) {
  const db = await database();
  const last = await latestVerification(userId);
  if (expectedId && expectedId !== last.id) throw new Error("最近任务已变化，请重新选择续作");
  if (last.status !== "failed") return { jobId: last.id };
  const ownerAndId = and(eq(jobs.id,last.id),eq(jobs.userId,userId));
  const updated = await db.update(jobs).set({status:"queued",error:null,updatedAt:new Date()})
    .where(and(ownerAndId,eq(jobs.status,"failed"),eq(jobs.attempts,last.attempts),
      sql`coalesce(${jobs.input}->>'cancelRequestedAt','') = ''`,
      sql`(${jobs.error} like '%章节检查点保存或读取失败%' or (
        ${jobs.input}->'params'->>'editionVersion' = '2'
        and ${jobs.output}->>'distillStage' in ('verifying','revising','finishing')
        and ${jobs.error} ~ '^platform job timed out after [0-9]+ms（连续 [0-9]+ 分钟没有任何进度，判为卡死）$'
      ))`
    )).returning({id:jobs.id});
  if (!updated.length) {
    const [current] = await db.select({status:jobs.status}).from(jobs).where(ownerAndId);
    if (!current || current.status === "failed") throw new Error("原任务当前无法从核实检查点续作");
  }
  return { jobId:last.id };
}

export async function listKnowledgeCardRecovery(userId: string, cursor?: { at: string; id: string }) {
  const db = await database();
  const rows = await db.select({id:jobs.id,userId:jobs.userId,status:jobs.status,input:jobs.input,createdAt:jobs.createdAt,
    output:sql<unknown>`jsonb_build_object('distilledMarkdown',${jobs.output}->'distilledMarkdown','detailLevel',${jobs.output}->'detailLevel','fullEditionMarkdown',${jobs.output}->'fullEditionMarkdown','verificationProcessed',${jobs.output}->'verificationProcessed','distillModel',${jobs.output}->'distillModel','knowledgeCardBillingModel',${jobs.output}->'knowledgeCardBillingModel')`})
    .from(jobs).where(and(eq(jobs.userId,userId),eq(jobs.status,"succeeded"),eligible,
      ...(cursor ? [sql`(${jobs.createdAt},${jobs.id}) < (${new Date(cursor.at)},${cursor.id})`] : [])))
    .orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(41);
  const page=await hydrateStagedManuscriptRows(rows.slice(0,40)), seen=new Set<string>();
  const items=page.flatMap(row=>{const d=recoveryDraft(row);if(!d||seen.has(d.key))return [];seen.add(d.key);return [{jobId:row.id,key:d.key,title:d.markdown.split('\n').find(x=>x.trim()&&!/^\s*<!--/.test(x))?.replace(/^#+\s*/,"").slice(0,100)||"知识卡成品",createdAt:row.createdAt.toISOString(),kind:d.image?"图文成品":"正文备份",total:d.image?Number(d.params.notePageTotal)||0:0}];});
  const visible=await Promise.all(items.map(async item=>await deletionStore.read(deletionPath(userId,item.key))?null:item));
  const last=rows.slice(0,40).at(-1);return {items:visible.filter((item):item is typeof items[number]=>item!==null),nextCursor:rows.length>40&&last?{at:last.createdAt.toISOString(),id:last.id}:null};
}
export async function getKnowledgeCardRecovery(userId: string, jobId: string) {
  const db = await database();
  const [rawAnchor]=await db.select().from(jobs).where(and(eq(jobs.id,jobId),eq(jobs.userId,userId))).limit(1);
  if(!rawAnchor)throw new Error("无法读取这份备份");
  const [anchor]=await hydrateStagedManuscriptRows([rawAnchor],undefined,true);const draft=recoveryDraft(anchor);if(!draft)throw new Error("这份任务没有可恢复的成品");
  if(await deletionStore.read(deletionPath(userId,draft.key)))throw Error("这份备份已删除，不能恢复");
  const rows=await db.select({id:jobs.id,userId:jobs.userId,status:jobs.status,input:jobs.input,createdAt:jobs.createdAt,
    output:sql<unknown>`jsonb_build_object('distilledMarkdown',${jobs.output}->'distilledMarkdown','detailLevel',${jobs.output}->'detailLevel','fullEditionMarkdown',${jobs.output}->'fullEditionMarkdown','verificationProcessed',${jobs.output}->'verificationProcessed','distillModel',${jobs.output}->'distillModel','compositeImageUrl',${jobs.output}->'compositeImageUrl','knowledgeCardBillingModel',${jobs.output}->'knowledgeCardBillingModel')`})
    .from(jobs).where(and(eq(jobs.userId,userId),eq(jobs.status,"succeeded"),eligible,
      sql`(${jobs.input}->'params'->>'scriptContext' = ${draft.markdown} or ${jobs.input}->'params'->>'manuscriptDigest' = ${stagedDigestOf(draft.markdown)} or ${jobs.output}->>'distilledMarkdown' = ${draft.markdown} or ${jobs.output}->>'fullEditionMarkdown' = ${draft.markdown})`));
  const result=assembleRecovery(userId,anchor,await hydrateStagedManuscriptRows(rows));
  result.images=result.images.map(image=>{
    const u=new URL(image.url);const [bucket,...segments]=u.pathname.slice(1).split('/');
    if(u.hostname==='storage.googleapis.com' && bucket===getGcsBucketName()) return {...image,url:signGcsObjectPathV4ReadUrl(bucket,segments.map(decodeURIComponent).join('/'),7*24*3600)};
    return image;
  });return result;
}

import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getGcsBucketName, signGcsObjectPathV4ReadUrl } from "./gcs";

type Row = { id: string; userId: string; status: string; input: unknown; output: unknown; createdAt: Date };
const object = (v: unknown): Record<string, any> => { if (typeof v === "string") { try { return object(JSON.parse(v)); } catch { return {}; } } return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {}; };
export function recoveryDraft(row: Row) {
  const input = object(row.input), output = object(row.output), params = object(input.params);
  const markdown = input.action === "platform_composite_sheet_progress" && params.kind === "single_page_knowledge_card"
    ? String(params.scriptContext || "") : ["knowledge_card_distill", "knowledge_card_derive_level"].includes(input.action) ? String(output.distilledMarkdown || "") : "";
  if (row.status !== "succeeded" || !markdown.trim()) return null;
  const image = input.action === "platform_composite_sheet_progress";
  const settings = image ? [params.notePageTotal, params.distillModel, params.subjectPosition, params.openaiImageVariant, params.infographicTemplateId].map(v => v ?? null) : [];
  return { markdown, input, output, params, image, key: createHash("sha256").update(JSON.stringify([markdown, settings])).digest("hex") };
}
export function assembleRecovery(userId: string, anchor: Row, rows: Row[]) {
  if (anchor.userId !== userId) throw new Error("无法读取这份备份");
  const draft = recoveryDraft(anchor);
  if (!draft) throw new Error("这份任务没有可恢复的成品");
  const candidates = rows.filter(r => r.userId === userId).map(row => ({row,draft:recoveryDraft(row)})).filter(x => x.draft?.markdown === draft.markdown);
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
  const textSource = draft.image ? candidates.find(x=>!x.draft!.image)?.draft : draft;
  const level = textSource?.output.detailLevel === "full" ? "full" as const : "concise" as const;
  return { jobId:anchor.id, markdown:draft.markdown, detailLevel:level,
    fullMarkdown: textSource?.input.action === "knowledge_card_derive_level" ? String(textSource.params.fullMarkdown || "") || null : level === "full" ? draft.markdown : null,
    distillModel:String(draft.params.distillModel || draft.output.distillModel || ""),
    subjectPosition:draft.params.subjectPosition === "center" ? "center" as const : "left" as const,
    infographicTemplateId:typeof draft.params.infographicTemplateId === "string" ? draft.params.infographicTemplateId : null,
    total, images };
}
async function database() { const db = await getDb(); if (!db) throw new Error("暂时无法读取云端备份，请稍后重试"); return db; }
const eligible = sql`(${jobs.input}->>'action' in ('knowledge_card_distill','knowledge_card_derive_level') or (${jobs.input}->>'action' = 'platform_composite_sheet_progress' and ${jobs.input}->'params'->>'kind' = 'single_page_knowledge_card'))`;
export async function listKnowledgeCardRecovery(userId: string, cursor?: { at: string; id: string }) {
  const db = await database();
  const rows = await db.select({id:jobs.id,userId:jobs.userId,status:jobs.status,input:jobs.input,createdAt:jobs.createdAt,
    output:sql<unknown>`jsonb_build_object('distilledMarkdown',${jobs.output}->'distilledMarkdown','detailLevel',${jobs.output}->'detailLevel')`})
    .from(jobs).where(and(eq(jobs.userId,userId),eq(jobs.status,"succeeded"),eligible,
      ...(cursor ? [sql`(${jobs.createdAt},${jobs.id}) < (${new Date(cursor.at)},${cursor.id})`] : [])))
    .orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(41);
  const page=rows.slice(0,40), seen=new Set<string>();
  const items=page.flatMap(row=>{const d=recoveryDraft(row);if(!d||seen.has(d.key))return [];seen.add(d.key);return [{jobId:row.id,key:d.key,title:d.markdown.split('\n').find(x=>x.trim())?.replace(/^#+\s*/,"").slice(0,100)||"知识卡成品",createdAt:row.createdAt.toISOString(),kind:d.image?"图文成品":"正文备份",total:d.image?Number(d.params.notePageTotal)||0:0}];});
  const last=page.at(-1);return {items,nextCursor:rows.length>40&&last?{at:last.createdAt.toISOString(),id:last.id}:null};
}
export async function getKnowledgeCardRecovery(userId: string, jobId: string) {
  const db = await database();
  const [anchor]=await db.select().from(jobs).where(and(eq(jobs.id,jobId),eq(jobs.userId,userId))).limit(1);
  if(!anchor)throw new Error("无法读取这份备份");const draft=recoveryDraft(anchor);if(!draft)throw new Error("这份任务没有可恢复的成品");
  const rows=await db.select({id:jobs.id,userId:jobs.userId,status:jobs.status,input:jobs.input,createdAt:jobs.createdAt,
    output:sql<unknown>`jsonb_build_object('distilledMarkdown',${jobs.output}->'distilledMarkdown','detailLevel',${jobs.output}->'detailLevel','compositeImageUrl',${jobs.output}->'compositeImageUrl')`})
    .from(jobs).where(and(eq(jobs.userId,userId),eq(jobs.status,"succeeded"),eligible,
      sql`(${jobs.input}->'params'->>'scriptContext' = ${draft.markdown} or ${jobs.output}->>'distilledMarkdown' = ${draft.markdown})`));
  const result=assembleRecovery(userId,anchor,rows);
  result.images=result.images.map(image=>{
    const u=new URL(image.url);const [bucket,...segments]=u.pathname.slice(1).split('/');
    if(u.hostname==='storage.googleapis.com' && bucket===getGcsBucketName()) return {...image,url:signGcsObjectPathV4ReadUrl(bucket,segments.map(decodeURIComponent).join('/'),7*24*3600)};
    return image;
  });return result;
}

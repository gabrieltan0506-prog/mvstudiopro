import { createHash } from "node:crypto";
import type { EditableLayout, LayoutLibrary } from "../../shared/editableLayout";
import type { KnowledgeBookLayoutInput } from "../../shared/knowledgeBookLayout";
import { applyKnowledgeBookLayout, selectedKnowledgeBookLayout, validateKnowledgeBookLayoutPlan } from "../../shared/knowledgeBookLayout";
import { currentLayoutGeneration, readCanonicalLayoutLibrary } from "./editableLayoutStore";
import { loadKnowledgePublicationExport } from "./knowledgePublicationExport";
import { downloadGcsObjectVersioned, getGcsBucketName } from "./gcs";
import { KnowledgeTtlCache } from "./knowledgePublicationCache";

type Source = Awaited<ReturnType<typeof loadKnowledgePublicationExport>>;
type ExportDeps = NonNullable<Parameters<typeof loadKnowledgePublicationExport>[3]>;
const readReport = async (owner:number, documentId:string, requestId:string) => JSON.parse((await downloadGcsObjectVersioned({
  gcsUri:`gs://${getGcsBucketName()}/knowledge-publications/user-${owner}/${documentId}/conversation/${requestId}/report.json`,
})).buffer.toString("utf8"));
export type KnowledgeBookLayoutDeps = ExportDeps & { layoutReport?: typeof readReport };
/**
 * 排版输入 / 整册视图的进程内短时缓存（键 = 账号 | 稿件 | 云稿 generation | 种类）。
 * 1110 实测 bookLayoutPreview 22 秒、bookLayoutInput 8.5 秒：每次都重新解析 34 张配图任务、读审校回执与排版回执并核验，
 * 同一 generation 下结果完全相同。只有生产依赖（调用方显式 cache:true 且无注入依赖）才进缓存；generation 变化即换键。
 */
export const knowledgeBookLayoutCache = new KnowledgeTtlCache<unknown>(16, 3 * 60_000);
type CacheOption = { cache?: boolean };
async function cachedBookLayout<T>(enabled: boolean, key: () => string, load: () => Promise<T>): Promise<T> {
  if (!enabled) return load();
  // 调用方可能就地改动视图（如签名、重排），取出一律深拷贝。
  return structuredClone(await (knowledgeBookLayoutCache.get(key(), load) as Promise<T>));
}

/** 哈希不含签名有效期、聊天记录或采用状态，包含每段正文、原图身份和真实审校。 */
export function knowledgeBookLayoutInput(source:Source):KnowledgeBookLayoutInput {
  const {doc,review,receipt}=source;
  const value = {
    documentId:doc.id, title:doc.title, template:doc.publication?.infographicTemplateId,
    pages:doc.pages.map(p=>({id:p.id,headline:p.headline,body:p.body,imageUrl:p.imageUrl})),
    review, sourceImages:receipt.sourceImages,
  };
  const sourceDigest=createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const pages=doc.pages.map((p,i)=>({
    id:p.id,headline:p.headline,body:p.body,hasImage:!!p.imageUrl,
    imageDescription:review.pages[i].imageDescription,cautions:review.pages[i].cautions,
    imageStatus:review.pages[i].imageStatus,facts:review.pages[i].facts,
    previousDesign:review.pages[i].reading?.decoration?.design,
  }));
  const input={sourceDigest,title:doc.title,detailLevel:doc.publication?.source.detailLevel,pages};
  if(Buffer.byteLength(JSON.stringify(input),"utf8")>650000)throw Error("整册排版超出单次容量，未截断正文或提交请求");
  return input;
}
export async function loadKnowledgeBookLayoutInput(owner:number,documentId:string,overrides:KnowledgeBookLayoutDeps={},options:CacheOption={}) {
  const loaded=await (overrides.load||readCanonicalLayoutLibrary)(owner);
  const cache=options.cache===true&&Object.keys(overrides).length===0&&/^\d+$/.test(loaded.generation)&&loaded.generation!=="0";
  return cachedBookLayout(cache,()=>`${owner}|${documentId}|${loaded.generation}|input`,async()=>{
    const source=await loadKnowledgePublicationExport(owner,documentId,loaded.generation,{...overrides,load:async()=>loaded},true,true);
    return knowledgeBookLayoutInput(source);
  });
}
function selectedTurn(doc:EditableLayout) {
  const plan=selectedKnowledgeBookLayout(doc);
  if(!plan)throw Error("尚未采用顾问整册排版方案");
  const turn=doc.publication!.conversation!.find(t=>t.request.id===doc.publication!.layoutConversationId)!;
  return {turn,plan};
}
async function verifiedPlan(owner:number,doc:EditableLayout,input:KnowledgeBookLayoutInput,report:typeof readReport) {
  const {turn,plan}=selectedTurn(doc);
  if(turn.request.layoutSourceDigest!==input.sourceDigest||turn.request.manuscript!==doc.publication!.manuscript)
    throw Error("正文、配图或补充稿已变化，请让顾问重新排版；原方案保留");
  const saved=await report(owner,doc.id,turn.request.id);
  if(JSON.stringify(saved.answer)!==JSON.stringify(turn.response))throw Error("排版方案与顾问永久回执不一致");
  return validateKnowledgeBookLayoutPlan(plan,input);
}
/** 预览和PDF共用此视图；只重排副本，绝不覆盖原稿、原图和原审校。 */
export async function loadKnowledgeBookLayoutView(owner:number,documentId:string,generation:string,overrides:KnowledgeBookLayoutDeps={},options:CacheOption={}) {
  const cache=options.cache===true&&Object.keys(overrides).length===0&&/^\d+$/.test(generation)&&generation!=="0";
  // 命中缓存前仍核对云稿当前版本，保持「版本已变化不导出旧稿」的原语义（只取元数据，不下载整库）。
  if(cache&&await currentLayoutGeneration(owner)!==generation)throw new Error("云稿版本已变化，请先读取当前稿件；未导出旧稿");
  return cachedBookLayout(cache,()=>`${owner}|${documentId}|${generation}|view`,()=>loadKnowledgeBookLayoutViewUncached(owner,documentId,generation,overrides));
}
async function loadKnowledgeBookLayoutViewUncached(owner:number,documentId:string,generation:string,overrides:KnowledgeBookLayoutDeps) {
  const loaded=await (overrides.load||readCanonicalLayoutLibrary)(owner);
  const original=loaded.library?.documents.find(d=>d.id===documentId);
  const selected=!!original?.publication?.layoutConversationId;
  const source=await loadKnowledgePublicationExport(owner,documentId,generation,{...overrides,load:async()=>loaded},true,selected);
  if(!selected)return source;
  const input=knowledgeBookLayoutInput(source);
  const plan=await verifiedPlan(owner,source.doc,input,overrides.layoutReport||readReport);
  const ordered=applyKnowledgeBookLayout(source.doc,source.review,input,plan);
  const hash=createHash("sha256").update(JSON.stringify([source.prefix,plan])).digest("hex");
  return {...source,...ordered,prefix:`knowledge-publications/user-${owner}/${documentId}/exports/${hash}`};
}
/** 保存前复查完整父子稿与回执，防止客户端偷换排版、漏图或用旧方案覆盖新稿。 */
export async function validateKnowledgeBookLayoutTransition(owner:number,before:LayoutLibrary|undefined,after:LayoutLibrary,overrides:KnowledgeBookLayoutDeps={}) {
  for(const doc of after.documents){
    const pub=doc.publication;if(!pub)continue;
    const old=before?.documents.find(d=>d.id===doc.id)?.publication;
    const latest=pub.conversation?.at(-1);
    const addedLayout=latest?.request.action==="layout"&&!old?.conversation?.some(t=>t.request.id===latest.request.id);
    const adopted=!!pub.layoutConversationId&&pub.layoutConversationId!==old?.layoutConversationId;
    if(!addedLayout&&!adopted)continue;
    const load=async()=>({library:structuredClone(after),generation:"1",updatedAt:new Date().toISOString()});
    const source=await loadKnowledgePublicationExport(owner,doc.id,"1",{...overrides,load},true,true);
    const input=knowledgeBookLayoutInput(source);
    if(addedLayout&&latest!.request.layoutSourceDigest!==input.sourceDigest)throw Error("整册排版输入已变化，未保存过期请求");
    if(adopted)await verifiedPlan(owner,source.doc,input,overrides.layoutReport||readReport);
  }
}

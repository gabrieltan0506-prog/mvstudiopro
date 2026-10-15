import { createHash } from "node:crypto";
import { downloadGcsObjectVersioned, getGcsBucketName, listGcsObjectVersions, uploadBufferToGcsIfAbsent } from "./gcs";
import { creativeLearningTargetSchema, creativeLearningReportSchema, creativeLibraryEntrySchema, type CreativeLibraryEntry } from "../../shared/creativeGenerationLibrary";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const real = {read: downloadGcsObjectVersioned, list: listGcsObjectVersions, upload: uploadBufferToGcsIfAbsent, bucket:getGcsBucketName, now:()=>new Date().toISOString()};
const prefix = (userId:number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw Error("创意生成库缺少用户身份");
  return `creative-generation-library/users/${userId}/entries/`;
};
/** 只能收藏当前用户服务端已保存且通过审阅的学习结果，不能由客户端上传自称已审核的正文。 */
export async function saveCreativeLibraryEntry(userId:number, evidenceId:string, deps=real):Promise<CreativeLibraryEntry> {
  const root=prefix(userId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(evidenceId)) throw Error("学习证据编号无效");
  const sourceName=`canvas-music-mv/advisor/${userId}/${evidenceId}/accepted.json`;
  const read=await deps.read({gcsUri:`gs://${deps.bucket()}/${sourceName}`});
  const saved=JSON.parse(read.buffer.toString());
  const report=creativeLearningReportSchema.parse(saved.proposal);
  const source=creativeLearningTargetSchema.parse(saved.target);
  if (report.evidenceId!==evidenceId || report.sourceKey!==source.sourceKey || report.review?.verdict!=="approved") throw Error("学习结果未通过审阅或版本不一致，不能入库");
  const id=`cg_${sha(`${evidenceId}:${sha(read.buffer)}`).slice(0,32)}`;
  const entry=creativeLibraryEntrySchema.parse({version:1,id,ownerId:userId,savedAt:deps.now(),state:"user_confirmed",source,report,evidence:{objectName:sourceName,sha256:sha(read.buffer)}});
  const objectName=`${root}${id}.json`;
  const result=await deps.upload({objectName,buffer:Buffer.from(JSON.stringify(entry)),contentType:"application/json"});
  if (!result.created) {
    const old=creativeLibraryEntrySchema.parse(JSON.parse((await deps.read({gcsUri:`gs://${deps.bucket()}/${objectName}`})).buffer.toString()));
    if(old.ownerId!==userId || old.evidence.sha256!==entry.evidence.sha256 || old.id!==id)throw Error("已有创意条目身份冲突，未覆盖");
    return old;
  }
  return entry;
}
/** 仅枚举本人前缀；任何读取/结构失败明确失败，不以空库掩盖。 */
export async function listCreativeLibraryEntries(userId:number,deps=real):Promise<CreativeLibraryEntry[]> {
  const root=prefix(userId), objects=await deps.list(root), entries:CreativeLibraryEntry[]=[];
  for(const object of objects){
    if(!object.name.startsWith(root)||!/^cg_[a-f0-9]{32}\.json$/.test(object.name.slice(root.length)))throw Error("创意库目录身份异常");
    const read=await deps.read({gcsUri:`gs://${deps.bucket()}/${object.name}`});
    if(read.generation!==object.generation)throw Error("创意库读取期间版本变化，请重新读取");
    const entry=creativeLibraryEntrySchema.parse(JSON.parse(read.buffer.toString()));
    if(entry.ownerId!==userId || object.name!==`${root}${entry.id}.json`)throw Error("创意库用户或条目身份不一致");
    entries.push(entry);
  }
  return entries.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
}

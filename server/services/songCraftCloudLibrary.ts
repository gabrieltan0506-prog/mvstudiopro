import {z} from "zod";
import {downloadGcsObjectVersioned,getGcsBucketName,listGcsObjectVersions} from "./gcs";
const text=z.string().min(1);
const cardSchema=z.object({id:text,title:text,contributor:text,basis:z.enum(["interview","native_audio"]),highlights:z.array(text).min(1),lyricPrompt:text,stylePrompt:text,mvPrompt:text,sources:z.array(z.object({title:text,url:z.string().url()})).min(1),evidence:z.object({taskId:text,actualModel:text,durationSec:z.number().positive().optional(),auditNotes:z.array(text)}).optional()});
const schema=z.object({version:z.literal(1),publishedAt:z.string().datetime(),cards:z.array(cardSchema).min(1)});
const prefix="creative-generation-library/curated/songcraft/catalogs/";
const real={list:listGcsObjectVersions,read:downloadGcsObjectVersioned,bucket:getGcsBucketName};
/** 正式库仅在Fly端读取GCS；前端拿正文，不暴露签名GCS地址，也不依赖开发电脑。 */
export async function readSongCraftCloudLibrary(deps=real){
 const versions=(await deps.list(prefix)).filter(x=>/^\d{8}T\d{6}Z-[a-f0-9]{12}\.json$/.test(x.name.slice(prefix.length))).sort((a,b)=>b.name.localeCompare(a.name));
 const latest=versions[0];if(!latest)throw Error("云端歌曲模板库尚未发布，请稍后重试");
 const file=await deps.read({gcsUri:`gs://${deps.bucket()}/${latest.name}`});
 if(file.generation!==latest.generation)throw Error("模板库版本读取冲突，请重新读取");
 const catalog=schema.parse(JSON.parse(file.buffer.toString()));
 if(new Set(catalog.cards.map(x=>x.id)).size!==catalog.cards.length)throw Error("云端模板编号重复");
 return {...catalog,revision:latest.name.slice(prefix.length),retrievedAt:new Date().toISOString()};
}

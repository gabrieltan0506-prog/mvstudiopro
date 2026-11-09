/**
 * 只读计时：用服务端真实记录（任务行 createdAt/updatedAt、回执对象 timeCreated）还原各阶段起止，
 * 区分排队与计算。不调用模型、不写业务数据；只输出计数与时间戳（经加密回传）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {and,eq,gte,inArray,lte,sql} from 'drizzle-orm';
import {getDb} from '../server/db';
import {users} from '../drizzle/schema';
import {jobs} from '../drizzle/schema-jobs';
import {getJobByIdStrict} from '../server/jobs/repository';
import {getGcsBucketName,downloadGcsObjectVersioned} from '../server/services/gcs';
import {getVertexAccessToken} from '../server/utils/vertex';
import {knowledgeCardPageJobId} from '../server/jobs/knowledgeCardPageTask';

const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const root=path.dirname(process.argv[2]);
const write=(name:string,value:unknown)=>fs.writeFile(path.join(root,name),JSON.stringify({at:new Date().toISOString(),...(value as object)}));
try{
  const db=await getDb();if(!db)throw Error('数据库不可用');
  const ownerJob=await getJobByIdStrict(config.ownerJobId);if(!ownerJob)throw Error('缺少所有者证据任务');
  const [user]=await db.select().from(users).where(eq(users.id,Number(ownerJob.userId))).limit(1);
  const owner=String(user!.id);
  const runState=config.runDir?JSON.parse(await fs.readFile(path.join('/app/isolated',String(config.runDir).replace(/[^a-z0-9-]/g,''),'state.json'),'utf8').catch(()=>'null')):null;
  const ids={distill:config.distillRequestId&&knowledgeCardPageJobId(owner,'knowledge_card_distill',config.distillRequestId),
    derive:config.deriveRequestId&&knowledgeCardPageJobId(owner,'knowledge_card_derive_level',config.deriveRequestId)};
  const rowIds=[ids.distill,ids.derive,...(runState?.imageJobIds||[])].filter(Boolean) as string[];
  const rows=rowIds.length?await db.select({id:jobs.id,status:jobs.status,createdAt:jobs.createdAt,updatedAt:jobs.updatedAt}).from(jobs).where(inArray(jobs.id,rowIds)):[];
  const row=(id?:string)=>rows.find(r=>r.id===id);
  const fmt=(r?:typeof rows[number])=>r?{status:r.status,created:r.createdAt.toISOString(),updated:r.updatedAt.toISOString(),seconds:Math.round((+r.updatedAt-+r.createdAt)/1000)}:null;
  const images=(runState?.imageJobIds||[]).map((id:string,i:number)=>({page:i+1,...fmt(row(id))}));
  // 运行目录丢失（重启）时，按时间窗列出本人任务行，按类型/动作分组给出各行起止（只含计数与时间）。
  let windowJobs:any[]=[];
  if(config.windowFrom&&config.windowTo){
    const list=await db.select({id:jobs.id,type:jobs.type,status:jobs.status,createdAt:jobs.createdAt,updatedAt:jobs.updatedAt,action:sql<string>`coalesce(${jobs.input}::jsonb->>'action', ${jobs.input}::jsonb->'params'->>'kind', '')`})
      .from(jobs).where(and(eq(jobs.userId,owner),gte(jobs.createdAt,new Date(config.windowFrom)),lte(jobs.createdAt,new Date(config.windowTo))));
    windowJobs=list.sort((a,b)=>+a.createdAt-+b.createdAt).map(r=>({type:r.type,action:r.action,status:r.status,created:r.createdAt.toISOString(),updated:r.updatedAt.toISOString(),seconds:Math.round((+r.updatedAt-+r.createdAt)/1000)}));
  }
  // 列出回执对象（名称只用于分组，不外传路径中的业务内容）
  const token=await getVertexAccessToken();
  async function list(prefix:string){
    const out:{name:string;created:string}[]=[];let pageToken='';
    do{
      const url=new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(getGcsBucketName())}/o`);
      url.searchParams.set('prefix',prefix);url.searchParams.set('fields','items(name,timeCreated),nextPageToken');url.searchParams.set('maxResults','1000');
      if(pageToken)url.searchParams.set('pageToken',pageToken);
      const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!res.ok)throw Error(`列举失败${res.status}`);
      const body:any=await res.json();for(const item of body.items||[])out.push({name:item.name.slice(prefix.length),created:item.timeCreated});pageToken=body.nextPageToken||'';
    }while(pageToken);
    return out;
  }
  // 分组：哈希/UUID/数字段折叠为 *，保留前两层目录，得到各阶段回执的数量与首末时间。
  const groupOf=(name:string)=>name.split('/').slice(0,-1).slice(0,2).map(s=>s.replace(/[0-9a-f]{8,}(-[0-9a-f]{4,})*/gi,'*').replace(/\d+/g,'#')).join('/')||'(root)';
  function groups(items:{name:string;created:string}[]){
    const g=new Map<string,{count:number;first:string;last:string}>();
    for(const it of items){const k=groupOf(it.name);const v=g.get(k)||{count:0,first:it.created,last:it.created};v.count++;if(it.created<v.first)v.first=it.created;if(it.created>v.last)v.last=it.created;g.set(k,v);}
    return Array.from(g.entries()).map(([group,v])=>({group,...v})).sort((a,b)=>a.first.localeCompare(b.first));
  }
  const derivePrefix=ids.derive?`knowledge-editions/user-${owner}/${ids.derive}/`:'';
  const docPrefix=(config.documentId||runState?.documentId)?`knowledge-publications/user-${owner}/${config.documentId||runState.documentId}/`:'';
  const out={distill:fmt(row(ids.distill)),derive:fmt(row(ids.derive)),images,windowJobs,
    deriveReceipts:derivePrefix?groups(await list(derivePrefix)):[],
    publicationReceipts:docPrefix?groups(await list(docPrefix)):[],
    runStartedAt:runState?.createdAt||null};
  await fs.writeFile(path.join(root,'timing.json'),JSON.stringify(out,null,1));
  // 主题命题回执原样带回（请求、原始回包、解析结果、失败记录），供本地零调用重放；只读。
  if(config.fetchTitleReceipts&&derivePrefix){
    const items=(await list(`${derivePrefix}topic-titles/`)).filter(i=>i.name.endsWith('.json'));
    const receipts:Record<string,unknown>={};
    for(const item of items){
      const object=await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${derivePrefix}topic-titles/${item.name}`});
      receipts[item.name]=JSON.parse(object.buffer.toString('utf8'));
    }
    await fs.writeFile(path.join(root,'title-receipts.json'),JSON.stringify(receipts));
  }
  await write('live.json',{stage:'diagnosed',images:images.length,deriveGroups:out.deriveReceipts.length,publicationGroups:out.publicationReceipts.length});
}catch(error){
  await write('live.json',{stage:'failed',error:String((error as Error).message).replace(/(?:https?|gs):\/\/[^\s"']+/g,'[地址]').slice(0,400)});
  process.exitCode=1;
}

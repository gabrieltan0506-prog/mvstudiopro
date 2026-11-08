/**
 * 只读诊断：定位出版批次失败根因。读取原稿该批的原始路由回执，用当前解析器重放，输出错误位置附近原文
 * （结果经加密回传，不进公开日志）以及对应顾问事务状态。不调用模型、不写业务数据。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {eq} from 'drizzle-orm';
import {appRouter} from '../server/routers';
import {getDb} from '../server/db';
import {users} from '../drizzle/schema';
import {getJobByIdStrict} from '../server/jobs/repository';
import {listGcsObjectNamesByPrefix,downloadGcsObjectVersioned,getGcsBucketName} from '../server/services/gcs';
import {knowledgeEvidencePrefix} from '../server/services/knowledgePublicationAdvisor';
import {knowledgeBatchRequestId} from '../shared/knowledgePublication';
import {manhuaAdvisorOperationId} from '../server/services/manhuaAdvisorOperation';
import {parseKnowledgeModelJson} from '../server/services/knowledgeModelJson';

const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const root=path.dirname(process.argv[2]);
const db=await getDb();if(!db)throw Error('数据库不可用');
const ownerJob=await getJobByIdStrict(config.ownerJobId);
const [user]=await db.select().from(users).where(eq(users.id,Number(ownerJob!.userId))).limit(1);
const caller=appRouter.createCaller({req:{headers:{}},res:{},user,clientDisconnected:new AbortController().signal} as any);
const saved=await caller.editableLayout.get();
const doc=saved.library!.documents.find(d=>d.id===config.documentId)!;
const pub=doc.publication!;
const prefix=knowledgeEvidencePrefix(user.id,doc.id,pub.requestId);
const read=async(name:string)=>JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${name}`})).buffer.toString('utf8'));
const out:any={documentId:doc.id,completedBatches:pub.completedBatches,attempts:pub.attempts,batches:[]};
for(const batchIndex of config.batchIndexes as number[]){
  const entry:any={batchIndex,jobs:[],receipts:[]};
  for(let attempt=0;attempt<=(pub.attempts?.[String(batchIndex)]||0)+1;attempt++){
    const requestId=knowledgeBatchRequestId(pub.requestId,batchIndex,attempt);
    const job=await getJobByIdStrict(manhuaAdvisorOperationId(user.id,requestId));
    if(job)entry.jobs.push({attempt,status:job.status,action:(job.output as any)?.action,refunded:(job.output as any)?.creditsRefunded,error:String(job.error||'').slice(0,600)});
  }
  const names=await listGcsObjectNamesByPrefix({prefix:`${prefix}/batch-${batchIndex}/`,allPages:true});
  entry.objects=names.map(n=>n.slice(prefix.length));
  for(const name of names.filter(n=>/route-[^/]+\.json$|raw-\d+\.json$/.test(n))){
    let r:any;try{r=await read(name);}catch(e){entry.receipts.push({name:name.slice(prefix.length),readError:String(e)});continue;}
    const text=r.response?.text??r.text;
    const rec:any={name:name.slice(prefix.length),state:r.state,status:r.response?.status??r.status,model:r.model};
    try{
      const env=JSON.parse(text);
      const content=env.choices?.[0]?.message?.content??env.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('');
      rec.finish=env.choices?.[0]?.finish_reason??env.candidates?.[0]?.finishReason;
      if(typeof content==='string'){
        rec.contentChars=content.length;
        try{const p=parseKnowledgeModelJson(content);rec.parseOk=true;rec.repairs=p.repairs.map(x=>({position:x.position,reason:x.reason}));}
        catch(e){
          rec.parseOk=false;rec.error=String((e as Error).message);
          const pos=Number(/position (\d+)/.exec(rec.error)?.[1]);
          if(Number.isInteger(pos))rec.context=JSON.stringify(content.slice(Math.max(0,pos-160),pos+160));
        }
      }
    }catch(e){rec.envelopeError=String(e).slice(0,200);}
    entry.receipts.push(rec);
  }
  out.batches.push(entry);
}
await fs.writeFile(path.join(root,'diagnose.json'),JSON.stringify(out,null,2));
await fs.writeFile(path.join(root,'live.json'),JSON.stringify({at:new Date().toISOString(),stage:'diagnosed',batches:out.batches.length}));
process.exit(0);

/** 真实集成入口：只建立本次隔离任务并调用正式worker，不复制模型/分页/保存逻辑。 */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runClaimedJob} from '../server/jobs/runner';
import {getJobByIdStrict} from '../server/jobs/repository';
import {knowledgeCardPageJobId} from '../server/jobs/knowledgeCardPageTask';
import {getDb} from '../server/db';
import {jobs} from '../drizzle/schema';
import {downloadGcsObjectVersioned,getGcsBucketName} from '../server/services/gcs';

if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('真实集成测试只能在隔离工作机运行');
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const original=await getJobByIdStrict(config.ownerSourceJobId);
if(!original)throw Error('缺少原任务所有权证据');
const owner=String(original.userId),db=await getDb();if(!db)throw Error('数据库不可用');
const sourceUri=`gs://${getGcsBucketName()}/${config.sourceObject}`;
const source=await downloadGcsObjectVersioned({gcsUri:sourceUri});
if(createHash('sha256').update(source.buffer).digest('hex')!==config.sourceSha256)throw Error('原文件指纹不符');
const ids={distill:knowledgeCardPageJobId(owner,'knowledge_card_distill',config.distillRequestId),derive:knowledgeCardPageJobId(owner,'knowledge_card_derive_level',config.deriveRequestId)};
await writeFile(config.statusPath,JSON.stringify({at:new Date().toISOString(),head:config.head,status:'running',ids}));
async function execute(id:string,action:string,params:Record<string,unknown>){
 const existing=await getJobByIdStrict(id);
 if(existing){
  if(existing.status==='succeeded')return existing.output as Record<string,any>;
  throw Error(`原任务${id}状态${existing.status}，只查询，不重新提交`);
 }
 // 任务直接由本次隔离worker持有，避免生产worker抢到尚未发布的测试版本。
 await db!.insert(jobs).values({id,userId:owner,type:'platform',provider:'evolink',status:'running',attempts:1,input:{action,params}});
 const job=await getJobByIdStrict(id);if(!job)throw Error('任务未持久化');
 await runClaimedJob(job);
 const done=await getJobByIdStrict(id);if(done?.status!=='succeeded')throw Error(`正式任务${id}未成功：${done?.error||done?.status}`);
 return done.output as Record<string,any>;
}
try{
 const extracted=await execute(ids.distill,'knowledge_card_distill',{files:[{gcsUri:sourceUri,mimeType:'application/epub+zip',fileName:config.fileName}],distillModel:'deepseek-v4.1-flash-1017',detailLevel:'full',billingPolicy:'interior-pages-v1',chargeDistillFee:false});
 const derived=await execute(ids.derive,'knowledge_card_derive_level',{fullMarkdown:extracted.distilledMarkdown,distillModel:'deepseek-v4.1-flash-1017',editionVersion:2});
 await writeFile(config.statusPath,JSON.stringify({at:new Date().toISOString(),head:config.head,status:derived.verificationProcessed?'returned':'partial',ids,issues:derived.editionIssues||[],counts:derived.editionPageCounts,sourceChars:extracted.sourceChars}));
}catch(error){await writeFile(config.statusPath,JSON.stringify({at:new Date().toISOString(),head:config.head,status:'failed',ids,error:String((error as Error).message).replace(/(?:https?|gs):\/\/[^\s]+/g,'[地址]')}));process.exitCode=1;}

import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canRenderManhuaVfx} from './server/jobs/workerRole.ts';
import {quoteManhuaVfxCredits} from './shared/manhuaVfxPricing.ts';
import {renderManhuaVfx} from './server/services/manhuaVfxRender.ts';
import {processPostProdJob} from './server/jobs/postProdJob.ts';
const machine=process.env.FLY_MACHINE_ID;
assert.equal(machine,'7812595b294778');
const envs=[];
for(const pid of await readdir('/proc')){if(!/^\d+$/.test(pid))continue;try{const raw=await readFile(`/proc/${pid}/environ`,'utf8');const env=Object.fromEntries(raw.split('\0').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));if(env.JOB_WORKER_ROLE==='rig')envs.push({pid,...Object.fromEntries(['JOB_WORKER_ROLE','FLY_MACHINE_ID','MANHUA_HEAVY_MACHINE_ID','MANHUA_RIG_WORKER_SPLIT'].map(k=>[k,env[k]]))});}catch{}}
assert.ok(envs.some(e=>canRenderManhuaVfx(e)));
const fingerprints={};for(const p of ['server/jobs/workerRole.ts','server/jobs/repository.ts','server/jobs/postProdJob.ts','server/services/manhuaVfxRender.ts','shared/manhuaVfxPricing.ts','shared/manhuaVfx.ts'])fingerprints[p]=createHash('sha256').update(await readFile(p)).digest('hex');
const quotes=[15,30,31,45,46].map(t=>({seconds:t,...quoteManhuaVfxCredits(['sword_trail','liquid_mirror'],t)}));assert.deepEqual(quotes.map(q=>q.credits),[16,32,40,48,56]);
let sideEffects=0;const blocked=async()=>{sideEffects++;throw new Error('UNEXPECTED_SIDE_EFFECT')};
globalThis.fetch=blocked;
Object.assign(process.env,{JOB_WORKER_ROLE:'app',MANHUA_HEAVY_MACHINE_ID:machine,MANHUA_RIG_WORKER_SPLIT:'0'});
const input={action:'manhua_vfx',scopeKey:'test-scope',requestId:'00000000-0000-4000-8000-000000000001',params:{sourceKey:'test-source',videoUri:'gs://test/no-read.mp4',composition:{version:1,seed:1,effects:[{id:'probe',kind:'sword_trail',startSec:0,durationSec:1,color:'#ffffff',scale:1,intensity:1,anchor:{space:'screen',position:[0.5,0.5]}}]}}};
const rejection=[];
for(const execute of [()=>renderManhuaVfx(input,'test-user',new AbortController().signal,{fetch:blocked,upload:blocked,runMedia:blocked,runBlender:blocked,uploadResult:blocked}),()=>processPostProdJob(input,'test-user')]){
try{await execute();assert.fail('unexpected success')}catch(e){assert.match(e.message,/特效渲染只能在指定工作机执行，不回退生产机/);rejection.push(e.message)}}
assert.equal(sideEffects,0);
const result={at:new Date().toISOString(),platform:process.platform,node:process.version,machine,workerProcesses:envs,fingerprints,quotes,guardRejected:rejection.length,sideEffects,mediaSubmissions:0,modelCalls:0,scope:'Linux模块导入与纯函数/入口防守；非线上媒体验收'};
await writeFile('result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

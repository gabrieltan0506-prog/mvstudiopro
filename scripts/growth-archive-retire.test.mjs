import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync,spawnSync} from 'node:child_process';
import {retirePublishedArchives} from './growth-archive-retire.mjs';
import {verifyCleanupEvidence} from './growth-archive-cleanup.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'growth-retire-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=path.join(root,'store'),temp=path.join(root,'tmp'),evidence=path.join(root,'receipts');
 fs.mkdirSync(temp);const dir='2026-10-01-00',tag='growth-cold-store-2026-10-01';
 for(const name of [dir,'2026-10-02-00','2026-10-03-00'])fs.mkdirSync(path.join(store,'archive',name),{recursive:true});
 const files=['bilibili-feed+bilibili_ranking.json.gz','douyin-keep.json.gz'].map((name,i)=>{
  const raw=gzipSync(JSON.stringify({items:i?[{id:'keep'}]:[]}));fs.writeFileSync(path.join(store,'archive',dir,name),raw);
  return {path:name,bytes:raw.length,sha256:sha(raw),items:i};
 });
 const original=new Map(files.map(row=>[row.path,sha(fs.readFileSync(path.join(store,'archive',dir,row.path)))]));
 const bundle=path.join(root,'bundle.tar.gz');execFileSync('tar',['-czf',bundle,'-C',path.join(store,'archive'),dir],{env:{...process.env,COPYFILE_DISABLE:'1'}});
 const raw=fs.readFileSync(bundle),archiveName=`archive-${dir}.tar.gz`,remote=new Map();
 const parts=[raw.subarray(0,Math.floor(raw.length/2)),raw.subarray(Math.floor(raw.length/2))].map((data,index)=>{
  const assetName=`${archiveName}.part-${String(index).padStart(4,'0')}`;remote.set(assetName,data);return {assetName,index,bytes:data.length,sha256:sha(data)};
 });
 const manifest={schemaVersion:1,dir,sourceFingerprint:sha(JSON.stringify(files)),inventory:files,archive:{assetName:archiveName,bytes:raw.length,sha256:sha(raw)},parts};
 const name=`archive-${dir}.manifest.json`;remote.set(name,Buffer.from(JSON.stringify(manifest,null,2)));
 const input={batch:{schemaVersion:3,batchId:'77-1',archives:[{dir,releaseTag:tag,sourceFingerprint:manifest.sourceFingerprint}]},
  publication:{batchId:'77-1',uploaded:[{dir,releaseTag:tag}]},manifests:{[name]:remote.get(name).toString('base64')}};
 const calls=[];const gh=args=>{calls.push(args);
  if(args[0]==='repo')return JSON.stringify({nameWithOwner:'gabrieltan0506-prog/mvstudiopro-growth-data',isPrivate:true});
  assert.equal(args[0],'api');if(args.at(-1).endsWith('releases?per_page=100'))return JSON.stringify([[{tag_name:tag,id:1}]]);
  return JSON.stringify([[...remote].map(([name,data])=>({name,state:'uploaded',size:data.length,digest:`sha256:${sha(data)}`}))]);
 };
 const options={root:store,rootScope:'bilibili-archives',allowRemoteDownload:true,receiptsRoot:evidence,temporaryRoot:temp,gh,
  fetchAsset:async(release,name)=>{assert.equal(release,tag);calls.push(['download',name]);return remote.has(name)?new Response(remote.get(name)):new Response(null,{status:404});},
  verifyEvidence:receipt=>verifyCleanupEvidence(receipt,gh)};
 return {root,store,temp,evidence,dir,files,original,remote,calls,input,options};
}
const present=f=>f.files.every(row=>fs.existsSync(path.join(f.store,'archive',f.dir,row.path)));

test('自动串联真实多片还原和B站逐文件清理，保留其他平台与远端备份、持久回执',async t=>{
 const f=fixture(t),before=new Map([...f.remote].map(([k,v])=>[k,sha(v)]));let samples=0;
 const result=await retirePublishedArchives(f.input,{...f.options,statfs:async()=>({bsize:4096n,bavail:BigInt(++samples===1?100:102)})});
 assert.equal(result.completed,true);assert.equal(result.removed.length,1);assert.equal(result.removedLogicalBytes,f.files[0].bytes);
 assert.equal(result.filesystem.observedAvailableBytesDelta,'8192');assert.notEqual(result.removedLogicalBytes,8192);
 assert.equal(result.remoteRestoreVerified,true);assert(fs.existsSync(path.join(f.store,'archive',f.dir,f.files[1].path)));
 assert.deepEqual(new Map([...f.remote].map(([k,v])=>[k,sha(v)])),before);
 for(const name of ['input.json','cleanup-receipt.json','authorization.json','cleanup-journal.jsonl','result.json'])assert(fs.existsSync(path.join(result.evidenceDirectory,name)));
 const journal=fs.readFileSync(path.join(result.evidenceDirectory,'cleanup-journal.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(journal.at(-1).event,'completed');assert.deepEqual(fs.readdirSync(f.temp),[]);
});
test('损坏远端分片时不删任何来源，保存失败清单且清自己临时下载',async t=>{
 const f=fixture(t);f.remote.set([...f.remote.keys()][0],Buffer.from('broken'));
 await assert.rejects(retirePublishedArchives(f.input,f.options),/part_mismatch/);
 assert(present(f));assert.deepEqual(fs.readdirSync(f.temp),[]);
 const folder=path.join(f.evidence,fs.readdirSync(f.evidence)[0]);
 assert(fs.existsSync(path.join(folder,'failure.json')));assert(fs.existsSync(path.join(folder,'input.json')));
 assert(!fs.existsSync(path.join(folder,'cleanup-journal.jsonl')));
});
test('恢复后来源变动不得删除，失败journal保留',async t=>{
 const f=fixture(t);
 await assert.rejects(retirePublishedArchives(f.input,{...f.options,verifyEvidence:receipt=>{
  const proof=verifyCleanupEvidence(receipt,f.options.gh);fs.writeFileSync(path.join(f.store,'archive',f.dir,f.files[0].path),'changed');return proof;
 }}),/source_changed/);
 assert(present(f));assert.deepEqual(fs.readdirSync(f.temp),[]);
 const folder=path.join(f.evidence,fs.readdirSync(f.evidence)[0]);assert(fs.existsSync(path.join(folder,'cleanup-receipt.json')));
 const journal=fs.readFileSync(path.join(folder,'cleanup-journal.jsonl'),'utf8');assert(journal.includes('stopped'));
});
test('最新两桶保护不能被自动入口绕过',async t=>{
 const f=fixture(t);fs.rmdirSync(path.join(f.store,'archive','2026-10-03-00'));
 await assert.rejects(retirePublishedArchives(f.input,f.options),/latest_bucket_protected/);
 assert(present(f));assert.deepEqual(fs.readdirSync(f.temp),[]);
});
test('缺少明确B站范围或下载授权时零网络零删除',async t=>{
 const f=fixture(t);
 await assert.rejects(retirePublishedArchives(f.input,{...f.options,rootScope:'all'}),/bilibili_scope_required/);
 await assert.rejects(retirePublishedArchives(f.input,{...f.options,allowRemoteDownload:false}),/authorization_required/);
 assert(present(f));assert.equal(f.calls.length,0);assert.deepEqual(fs.readdirSync(f.temp),[]);
});
test('证据目录禁止落回待清理store内部',async t=>{
 const f=fixture(t);
 await assert.rejects(retirePublishedArchives(f.input,{...f.options,receiptsRoot:path.join(f.store,'receipts')}),/outside_store/);
 assert(present(f));assert.equal(f.calls.length,0);
});
test('CLI在非Fly环境拒绝启动，不读取正式备份',t=>{
 const run=spawnSync(process.execPath,['scripts/growth-archive-retire.mjs','--scope=bilibili-archives','--allow-remote-download'],{env:{...process.env,FLY_APP_NAME:''},encoding:'utf8',input:'{}'});
 assert.equal(run.status,1);assert.match(run.stderr,/fly_store_required/);
});


test('混合桶删B后下一轮快照隔离退役桶，不能发布缺B的子集',async t=>{
 const f=fixture(t);const result=await retirePublishedArchives(f.input,f.options);
 const marker=JSON.parse(fs.readFileSync(path.join(f.store,'.growth-archive-retired',f.dir+'.json'),'utf8'));
 assert.equal(marker.dir,f.dir);assert.equal(marker.platform,'bilibili');assert.equal(marker.restore.dir,f.dir);
 const run=spawnSync('sh',['scripts/growth-archive-offload-remote.sh','prepare','78-1'],{env:{...process.env,GROWTH_STORE_DIR:f.store,GROWTH_INTERACTIVE_FALLBACK_DIR:path.join(f.root,'unused')},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.match(run.stderr,/GROWTH_ARCHIVE_RETIRED/);
 const snapshot=path.join(f.store,'backups/archive-offload/78-1');
 assert(!fs.existsSync(path.join(snapshot,'archive',f.dir)));
 const retired=fs.readFileSync(path.join(snapshot,'retired.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(retired,[{dir:f.dir,state:'retired',reason:'complete-cold-backup-retained'}]);
 assert(fs.existsSync(path.join(f.store,'archive',f.dir,f.files[1].path)));
});

test('复用旧备份支持非格式化原始manifest字节并实际还原',async t=>{
 const f=fixture(t),name=Object.keys(f.input.manifests)[0];
 const bytes=Buffer.from(JSON.stringify(JSON.parse(f.remote.get(name).toString()))+'\n');
 f.remote.set(name,bytes);f.input.manifests[name]=bytes.toString('base64');
 f.input.publication.reused=f.input.publication.uploaded;delete f.input.publication.uploaded;
 const result=await retirePublishedArchives(f.input,f.options);
 assert.equal(result.completed,true);assert.equal(result.removed.length,1);assert.equal(result.remoteRestoreVerified,true);
});

// 2026-11-18 用户授权：冷备核验后同桶非B站归档来源也退役（verified-archives）；bilibili-archives 行为不变。
const verified=f=>({...f.options,rootScope:'verified-archives'});
test('旧范围仍只删B站并逐桶回报完成状态',async t=>{
 const f=fixture(t);const result=await retirePublishedArchives(f.input,f.options);
 assert.deepEqual(result.removed,[`archive/${f.dir}/${f.files[0].path}`]);
 assert(fs.existsSync(path.join(f.store,'archive',f.dir,f.files[1].path)));
 assert.deepEqual(result.buckets,[{dir:f.dir,state:'retired',retirementCompleted:true,candidateFiles:1,removedFiles:1,removedLogicalBytes:f.files[0].bytes}]);
 const receipt=JSON.parse(fs.readFileSync(path.join(result.evidenceDirectory,'cleanup-receipt.json'),'utf8'));
 assert.equal('scope' in receipt,false);
});
test('verified-archives 真实还原核验后删同桶全部已发布平台来源，保留快手与远端备份',async t=>{
 const f=fixture(t),before=new Map([...f.remote].map(([k,v])=>[k,sha(v)]));
 const kuaishou=path.join(f.store,'archive',f.dir,'kuaishou-keep.json.gz');fs.writeFileSync(kuaishou,gzipSync('{"items":[]}'));
 const result=await retirePublishedArchives(f.input,verified(f));
 assert.equal(result.completed,true);assert.equal(result.remoteRestoreVerified,true);
 assert.deepEqual(result.removed.sort(),f.files.map(row=>`archive/${f.dir}/${row.path}`).sort());
 assert.equal(result.removedLogicalBytes,f.files.reduce((n,row)=>n+row.bytes,0));
 assert(!f.files.some(row=>fs.existsSync(path.join(f.store,'archive',f.dir,row.path))));assert(fs.existsSync(kuaishou));
 assert.deepEqual(result.buckets,[{dir:f.dir,state:'retired',retirementCompleted:true,candidateFiles:2,removedFiles:2,
  removedLogicalBytes:result.removedLogicalBytes}]);
 assert.deepEqual(new Map([...f.remote].map(([k,v])=>[k,sha(v)])),before);
 const receipt=JSON.parse(fs.readFileSync(path.join(result.evidenceDirectory,'cleanup-receipt.json'),'utf8'));
 assert.equal(receipt.scope,'verified-archives');
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.evidenceDirectory,'authorization.json'),'utf8')).policy,'verified-published-archive-sources');
 const marker=JSON.parse(fs.readFileSync(path.join(f.store,'.growth-archive-retired',f.dir+'.json'),'utf8'));
 assert.equal(marker.platform,'verified-archives');assert.equal(marker.restore.dir,f.dir);
 assert.deepEqual(fs.readdirSync(f.temp),[]);
});
test('verified-archives 冷备后新写入的未核验来源使整批保留并逐桶报未完成',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.store,'archive',f.dir,'douyin-late.json.gz'),gzipSync('{"items":[]}'));
 const error=await retirePublishedArchives(f.input,verified(f)).then(()=>null,e=>e);
 assert.match(error?.message||'',/unverified_source_present/);assert(present(f));
 assert.deepEqual(error.retirementBuckets,[{dir:f.dir,state:'failed',retirementCompleted:false,candidateFiles:2,removedFiles:0,removedLogicalBytes:0}]);
 const folder=path.join(f.evidence,fs.readdirSync(f.evidence)[0]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'failure.json'),'utf8')).buckets[0].retirementCompleted,false);
 assert(!fs.existsSync(path.join(f.store,'.growth-archive-retired')));
});
test('verified-archives 远端损坏、来源变动、最新桶时一律不删',async t=>{
 const a=fixture(t);a.remote.set([...a.remote.keys()][0],Buffer.from('broken'));
 await assert.rejects(retirePublishedArchives(a.input,verified(a)),/part_mismatch/);assert(present(a));
 const b=fixture(t);
 await assert.rejects(retirePublishedArchives(b.input,{...verified(b),verifyEvidence:receipt=>{
  const proof=verifyCleanupEvidence(receipt,b.options.gh);fs.writeFileSync(path.join(b.store,'archive',b.dir,b.files[1].path),'changed');return proof;
 }}),/source_changed/);assert(present(b));
 const c=fixture(t);fs.rmdirSync(path.join(c.store,'archive','2026-10-03-00'));
 await assert.rejects(retirePublishedArchives(c.input,verified(c)),/latest_bucket_protected/);assert(present(c));
});

// 2026-11-18 用户授权（验快照即可）：旧范围已退B站的桶，剩余来源只比对旧标记中已核验的冷备清单，不再下载还原。
import {retireLegacyMarkedArchives} from './growth-archive-retire.mjs';
async function legacyFixture(t){
 const f=fixture(t);await retirePublishedArchives(f.input,f.options);
 const markerFile=path.join(f.store,'.growth-archive-retired',f.dir+'.json');
 const oldMarker=JSON.parse(fs.readFileSync(markerFile,'utf8'));assert.equal(oldMarker.platform,'bilibili');
 const downloadsBefore=f.calls.filter(c=>c[0]==='download').length;
 const run=(extra={})=>retireLegacyMarkedArchives({schemaVersion:1,mode:'legacy-retired-markers',batchId:'90-1'},
  {root:f.store,receiptsRoot:f.evidence,repository:'gabrieltan0506-prog/mvstudiopro-growth-data',
   verifyEvidence:receipt=>verifyCleanupEvidence(receipt,f.options.gh),...extra});
 const downloads=()=>f.calls.filter(c=>c[0]==='download').length-downloadsBefore;
 const douyin=path.join(f.store,'archive',f.dir,f.files[1].path);
 return {...f,markerFile,oldMarker,run,downloads,douyin};
}
test('旧B站标记桶：剩余来源与已核验清单一致即逐文件删除，升级标记保留B站历史，不下载、快手不动、不重复处理',async t=>{
 const f=await legacyFixture(t);const kuaishou=path.join(f.store,'archive',f.dir,'kuaishou-keep.json.gz');fs.writeFileSync(kuaishou,'x');
 const evidenceBefore=fs.readdirSync(f.evidence).length;
 const result=await f.run();
 assert.equal(result.completed,true);assert.equal(f.downloads(),0);
 assert.deepEqual(result.buckets.map(({evidenceDirectory,...row})=>row),[{dir:f.dir,state:'retired',retirementCompleted:true,removedFiles:1,
  removedLogicalBytes:f.files[1].bytes,keptFiles:0,keptBytes:0}]);
 assert(!fs.existsSync(f.douyin));assert(fs.existsSync(kuaishou));
 const marker=JSON.parse(fs.readFileSync(f.markerFile,'utf8'));
 assert.equal(marker.platform,'verified-archives');assert.deepEqual(marker.previous,f.oldMarker);assert.deepEqual(marker.restore,f.oldMarker.restore);
 assert.equal(fs.readdirSync(f.evidence).filter(n=>n!=="legacy-retired-cursor.json").length,evidenceBefore+1);
 const journal=fs.readFileSync(path.join(result.buckets[0].evidenceDirectory,'cleanup-journal.jsonl'),'utf8');
 assert(journal.includes('marker-upgraded'));assert(journal.includes('"completed"'));
 const again=await f.run();assert.deepEqual(again.buckets,[]);assert.equal(fs.readdirSync(f.evidence).filter(n=>n!=="legacy-retired-cursor.json").length,evidenceBefore+1);
 const run=spawnSync('sh',['scripts/growth-archive-offload-remote.sh','prepare','91-1'],{env:{...process.env,GROWTH_STORE_DIR:f.store,GROWTH_INTERACTIVE_FALLBACK_DIR:path.join(f.root,'unused')},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const retired=fs.readFileSync(path.join(f.store,'backups/archive-offload/91-1/retired.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(retired,[{dir:f.dir,state:'retired',reason:'complete-cold-backup-retained'}]);
});
test('旧B站标记桶：未列出或内容不同的文件逐文件保留并报数量字节，不阻塞同桶一致文件与其他桶',async t=>{
 const f=await legacyFixture(t);
 const late=path.join(f.store,'archive',f.dir,'xiaohongshu-late.json.gz');fs.writeFileSync(late,'late-bytes');
 const other='2026-09-30-00';fs.mkdirSync(path.join(f.store,'archive',other));
 fs.writeFileSync(path.join(f.store,'archive',other,'douyin-x.json.gz'),'abc');
 fs.writeFileSync(path.join(f.store,'.growth-archive-retired',other+'.json'),JSON.stringify({schemaVersion:1,dir:other,platform:'bilibili',receiptSha256:'a'.repeat(64),restore:{dir:other}}));
 const result=await f.run();
 const rows=Object.fromEntries(result.buckets.map(({evidenceDirectory,...row})=>[row.dir,row]));
 assert.deepEqual(rows[other],{dir:other,state:'marker-evidence-unusable',retirementCompleted:false,removedFiles:0,removedLogicalBytes:0,keptFiles:1,keptBytes:3});
 assert.deepEqual(rows[f.dir],{dir:f.dir,state:'retired-partially-kept',retirementCompleted:false,removedFiles:1,removedLogicalBytes:f.files[1].bytes,keptFiles:1,keptBytes:10});
 assert.equal(result.keptFiles,2);assert.equal(result.keptBytes,13);
 assert(!fs.existsSync(f.douyin));assert(fs.existsSync(late));assert(fs.existsSync(path.join(f.store,'archive',other,'douyin-x.json.gz')));
 assert.equal(JSON.parse(fs.readFileSync(f.markerFile,'utf8')).platform,'bilibili');
 const again=await f.run();
 assert.equal(again.buckets.find(row=>row.dir===f.dir).state,'kept-not-in-verified-backup');assert(fs.existsSync(late));
});
test('旧B站标记桶：同大小不同内容不删；最新两桶不碰；每班额度外延后',async t=>{
 const a=await legacyFixture(t);const raw=fs.readFileSync(a.douyin);raw[raw.length-1]^=1;fs.writeFileSync(a.douyin,raw);
 const r1=await a.run();assert.equal(r1.buckets[0].state,'kept-not-in-verified-backup');assert.equal(r1.buckets[0].keptBytes,raw.length);assert(fs.existsSync(a.douyin));
 const b=await legacyFixture(t);fs.rmdirSync(path.join(b.store,'archive','2026-10-03-00'));
 const r2=await b.run();assert.equal(r2.buckets[0].state,'latest-bucket-protected');assert(fs.existsSync(b.douyin));
 const c=await legacyFixture(t);
 const r3=await c.run({maxBuckets:0});assert.equal(r3.deferred,1);assert.deepEqual(r3.buckets,[]);assert(fs.existsSync(c.douyin));
 assert.equal(JSON.parse(fs.readFileSync(c.markerFile,'utf8')).platform,'bilibili');
});
test('旧标记桶远端备份元数据已变时不删',async t=>{
 const f=await legacyFixture(t);const name=[...f.remote.keys()][0];f.remote.set(name,Buffer.from('changed-remote'));
 const result=await f.run();assert.equal(result.completed,false);assert.equal(result.buckets[0].state,'failed');
 assert.match(result.buckets[0].error,/remote_asset_changed/);assert(fs.existsSync(f.douyin));
});

// [P1] 删除中断：标记 pending 冻结整桶、轮转不算完成，下一班按原回执续删后标记 completed。
async function interrupted(t,when){
 const f=await legacyFixture(t);
 // legacyFixture 已以旧范围退役B站；改用一个全新 verified 桶：恢复B站文件并清掉旧标记，模拟新范围运行。
 fs.rmSync(path.join(f.store,'.growth-archive-retired'),{recursive:true});
 const bili=path.join(f.store,'archive',f.dir,f.files[0].path);fs.writeFileSync(bili,gzipSync(JSON.stringify({items:[]})));
 assert.equal(sha(fs.readFileSync(bili)),f.files[0].sha256);
 let seen=0;
 await assert.rejects(retirePublishedArchives(f.input,{...f.options,rootScope:'verified-archives',onJournal:entry=>{
  if(entry.event===when && ++seen===1)throw Error('simulated_crash');}}),/simulated_crash/);
 const marker=JSON.parse(fs.readFileSync(f.markerFile,'utf8'));
 assert.equal(marker.state,'pending');assert.equal(marker.platform,'verified-archives');assert.equal(marker.files.length,2);
 return {...f,bili,marker};
}
const cursorRun=(f,batch)=>{
 const env={...process.env,GROWTH_STORE_DIR:f.store,GROWTH_INTERACTIVE_FALLBACK_DIR:path.join(f.root,'unused')};
 const prep=spawnSync('sh',['scripts/growth-archive-offload-remote.sh','prepare',batch],{env,encoding:'utf8'});assert.equal(prep.status,0,prep.stderr);
 const commit=spawnSync('sh',['scripts/growth-archive-offload-remote.sh','commit-cursor',batch,''],{env,encoding:'utf8'});assert.equal(commit.status,0,commit.stderr);
 const retired=fs.readFileSync(path.join(f.store,'backups/archive-offload',batch,'retired.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 return {retired,cursor:JSON.parse(fs.readFileSync(path.join(f.store,'backups/archive-offload/.rotation-cursor.json'),'utf8')),
  republished:fs.existsSync(path.join(f.store,'backups/archive-offload',batch,'archive',f.dir))};
};
test('删除前中断：pending 不发布、轮转不算完成；续删按原回执删完并标记完成',async t=>{
 const f=await interrupted(t,'preflight');
 assert(fs.existsSync(f.bili) && fs.existsSync(f.douyin));
 const c1=cursorRun(f,'95-1');
 assert.deepEqual(c1.retired,[{dir:f.dir,state:'retirement-pending',reason:'resume-required'}]);assert.equal(c1.republished,false);
 assert.equal(c1.cursor.attempts[f.dir],1);
 const d0=f.downloads(),result=await f.run();assert.equal(f.downloads(),d0);
 assert.equal(result.buckets[0].state,'resumed');assert.equal(result.buckets[0].retirementCompleted,true);assert.equal(result.buckets[0].removedFiles,2);
 assert(!fs.existsSync(f.bili) && !fs.existsSync(f.douyin));
 const marker=JSON.parse(fs.readFileSync(f.markerFile,'utf8'));
 assert.equal(marker.state,'completed');assert.equal(marker.receiptSha256,f.marker.receiptSha256);assert.deepEqual(marker.files,f.marker.files);
 assert.match(marker.resumedReceiptSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual((await f.run()).buckets,[]);
 const c2=cursorRun(f,'96-1');assert.equal(c2.retired[0].state,'retired');assert.equal(c2.cursor.attempts[f.dir],undefined);
});
test('删除中途中断：已删部分不重复，剩余续删完成',async t=>{
 const f=await interrupted(t,'unlinked');
 assert.equal([f.bili,f.douyin].filter(file=>fs.existsSync(file)).length,1);
 const result=await f.run();
 assert.equal(result.buckets[0].state,'resumed');assert.equal(result.buckets[0].removedFiles,1);
 assert(!fs.existsSync(f.bili) && !fs.existsSync(f.douyin));
 assert.equal(JSON.parse(fs.readFileSync(f.markerFile,'utf8')).state,'completed');
});
test('续删时文件已变：该文件保留并报告，桶保持 pending，一致文件照删',async t=>{
 const f=await interrupted(t,'preflight');
 const raw=fs.readFileSync(f.douyin);raw[raw.length-1]^=1;fs.writeFileSync(f.douyin,raw);
 const result=await f.run();
 assert.equal(result.buckets[0].state,'resumed-partially-kept');assert.equal(result.buckets[0].retirementCompleted,false);
 assert.equal(result.buckets[0].keptFiles,1);assert.equal(result.buckets[0].keptBytes,raw.length);
 assert(!fs.existsSync(f.bili));assert(fs.existsSync(f.douyin));
 assert.equal(JSON.parse(fs.readFileSync(f.markerFile,'utf8')).state,'pending');
 const again=await f.run();assert.equal(again.buckets[0].state,'resume-kept');assert(fs.existsSync(f.douyin));
 assert.equal(cursorRun(f,'97-1').retired[0].state,'retirement-pending');
});
test('旧格式（无 state）verified 标记：仍有授权来源时按标记还原清单改为 pending 续删；无剩余视为完成',async t=>{
 const f=await interrupted(t,'preflight');
 const old={...f.marker};delete old.state;delete old.files;delete old.scope;fs.writeFileSync(f.markerFile,JSON.stringify(old));
 const result=await f.run();
 assert.equal(result.buckets[0].state,'resumed');assert(!fs.existsSync(f.bili) && !fs.existsSync(f.douyin));
 const marker=JSON.parse(fs.readFileSync(f.markerFile,'utf8'));assert.equal(marker.state,'completed');assert.equal(marker.files.length,2);
 fs.writeFileSync(f.markerFile,JSON.stringify(old));
 assert.deepEqual((await f.run()).buckets,[]);assert.equal(JSON.parse(fs.readFileSync(f.markerFile,'utf8')).state,undefined);
});

// [P2] 每班从上次消耗额度处之后轮转：8 个持续不一致的前排桶不能让后排可删桶永远延后。
test('8个不一致桶+1个可删桶：两班内可删桶完成，不一致桶照常报告',async t=>{
 const f=await legacyFixture(t);
 const bad=Array.from({length:8},(_,i)=>`2026-09-0${i+1}-00`);
 for(const dir of bad) {
  fs.mkdirSync(path.join(f.store,'archive',dir));fs.writeFileSync(path.join(f.store,'archive',dir,'douyin-x.json.gz'),'abd');
  const tar=Buffer.from('tar-'+dir),archive={assetName:`archive-${dir}.tar.gz`,bytes:tar.length,sha256:sha(tar)};
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,dir,archive,parts:[{...archive,index:0}],inventory:[{path:'douyin-x.json.gz',bytes:3,sha256:sha('abc'),items:0}]}));
  fs.writeFileSync(path.join(f.store,'.growth-archive-retired',dir+'.json'),JSON.stringify({schemaVersion:1,dir,platform:'bilibili',receiptSha256:sha(dir),
   restore:{dir,releaseTag:'growth-cold-store-2026-09-01',manifestSha256:sha(manifest),archiveSha256:archive.sha256,manifestBase64:manifest.toString('base64'),
    manifest:JSON.parse(manifest),inventory:[{path:'douyin-x.json.gz',bytes:3,sha256:sha('abc'),items:0}]}}));
 }
 const s1=await f.run();
 assert.equal(s1.deferred,1);assert(fs.existsSync(f.douyin));
 assert.deepEqual(s1.buckets.map(b=>[b.dir,b.state,b.keptFiles,b.keptBytes]),bad.map(dir=>[dir,'kept-not-in-verified-backup',1,3]));
 const s2=await f.run();
 assert.equal(s2.buckets[0].dir,f.dir);assert.equal(s2.buckets[0].state,'retired');assert(!fs.existsSync(f.douyin));
 assert.equal(s2.buckets.filter(b=>b.state==='kept-not-in-verified-backup').length,7);
 const s3=await f.run();assert(s3.buckets.some(b=>b.dir==='2026-09-08-00' && b.keptBytes===3));
 fs.writeFileSync(path.join(f.evidence,'legacy-retired-cursor.json'),'{broken');
 const s4=await f.run();assert.equal(s4.buckets.length,8);
});
// [复审] 0 字节/无法解析的标记：来源保留，但必须明确报告该桶未完成（completed=false），其余桶照常处理。
test('无法解析的退役标记：来源保留、该桶报 marker-invalid 且本班不算完成，不阻塞其他桶',async t=>{
 const f=await legacyFixture(t);
 const broken='2026-08-01-00',src=path.join(f.store,'archive',broken,'douyin-x.json.gz');
 fs.mkdirSync(path.join(f.store,'archive',broken));fs.writeFileSync(src,'abc');
 fs.writeFileSync(path.join(f.store,'.growth-archive-retired',broken+'.json'),'');
 const result=await f.run();
 assert.equal(result.completed,false);assert.deepEqual(result.invalidMarkers,[broken]);
 const row=result.buckets.find(b=>b.dir===broken);
 assert.equal(row.state,'marker-invalid');assert.equal(row.retirementCompleted,false);
 assert(fs.existsSync(src));assert.equal(fs.statSync(path.join(f.store,'.growth-archive-retired',broken+'.json')).size,0);
 assert.equal(result.buckets.find(b=>b.dir===f.dir).state,'retired');assert(!fs.existsSync(f.douyin));
});
// [复审] pending 标记可解析但续删凭据损坏：来源保留，该桶计为失败并点名损坏字段，本班不算完成。
for(const [label,damage,field] of [
 ['移除 files',m=>{delete m.files;},'files'],
 ['破坏恢复清单',m=>{m.restore.manifestBase64=Buffer.from('{"broken":true}').toString('base64');},'restore'],
 ['清单摘要不符',m=>{m.restore.manifestSha256='0'.repeat(64);},'restore.manifestSha256'],
])test(`pending 标记续删凭据损坏（${label}）：来源保留、桶报 failed 并点名字段、completed=false`,async t=>{
 const f=await legacyFixture(t);
 const m=JSON.parse(fs.readFileSync(f.markerFile,'utf8'));
 Object.assign(m,{platform:'verified-archives',state:'pending',scope:'verified-archives',
  files:[{path:`archive/${f.dir}/${f.files[1].path}`,bytes:f.files[1].bytes,sha256:f.files[1].sha256}]});
 damage(m);fs.writeFileSync(f.markerFile,JSON.stringify(m));
 for(const shift of [1,2]) {
  const result=await f.run();
  assert.equal(result.completed,false,`shift ${shift}`);
  const row=result.buckets.find(b=>b.dir===f.dir);
  assert.equal(row.state,'failed');assert.equal(row.retirementCompleted,false);
  assert.match(row.error,new RegExp(`^retirement_marker_evidence_unusable:${field.replace('.','\\.')}`));
  assert(row.keptFiles>=1);assert(fs.existsSync(f.douyin));
 }
});

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

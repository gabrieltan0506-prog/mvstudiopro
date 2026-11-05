import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {deleteVerifiedArchive} from './growth-archive-delete-verified.mjs';
import {buildCleanupReceipt,verifyCleanupEvidence} from './growth-archive-cleanup.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'growth-cleanup-proof-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir='2026-10-01-00',releaseTag='growth-cold-store-2026-10-01',source=path.join(root,'source');
 fs.mkdirSync(path.join(source,dir),{recursive:true});fs.mkdirSync(path.join(root,'assets'));
 const files=['bilibili-feed+bilibili_popular+bilibili_ranking.json.gz','douyin-good.json.gz'].map((name,i)=>{
  const b=gzipSync(JSON.stringify({items:i?[{id:'one'}]:[]}));fs.writeFileSync(path.join(source,dir,name),b);return {path:name,bytes:b.length,sha256:sha(b),items:i};
 });
 const bundle=path.join(root,'bundle.tar.gz');execFileSync('tar',['-czf',bundle,'-C',source,dir],{env:{...process.env,COPYFILE_DISABLE:'1'}});
 const b=fs.readFileSync(bundle),archiveName=`archive-${dir}.tar.gz`,remote=new Map();
 const parts=[b.subarray(0,Math.floor(b.length/2)),b.subarray(Math.floor(b.length/2))].map((raw,index)=>{
  const assetName=`${archiveName}.part-${String(index).padStart(4,'0')}`;remote.set(assetName,raw);return{assetName,index,bytes:raw.length,sha256:sha(raw)};
 });
 const manifest={schemaVersion:1,dir,sourceFingerprint:sha(JSON.stringify(files)),inventory:files,archive:{assetName:archiveName,bytes:b.length,sha256:sha(b)},parts};
 const name=`archive-${dir}.manifest.json`,raw=Buffer.from(JSON.stringify(manifest));remote.set(name,raw);fs.writeFileSync(path.join(root,'assets',name),raw);
 fs.writeFileSync(path.join(root,'offload-manifest.json'),JSON.stringify({schemaVersion:3,batchId:'77-1',archives:[{dir,releaseTag,sourceFingerprint:manifest.sourceFingerprint}]}));
 fs.writeFileSync(path.join(root,'publication-result.json'),JSON.stringify({batchId:'77-1',uploaded:[{dir,releaseTag}]}));
 const calls=[];
 const gh=args=>{calls.push(args);if(args[0]==='repo')return JSON.stringify({nameWithOwner:'gabrieltan0506-prog/mvstudiopro-growth-data',isPrivate:true});
  assert.equal(args[0],'api');assert(!args.includes('download'));
  if(args.at(-1).endsWith('releases?per_page=100'))return JSON.stringify([[{tag_name:releaseTag,id:1}]]);
  return JSON.stringify([[...remote].map(([name,b])=>({name,state:'uploaded',size:b.length,digest:`sha256:${sha(b)}`}))]);};
 return{root,source,dir,remote,gh,calls,options:{root,cacheRoot:path.join(root,'cache'),allowRemoteDownload:true,gh,fetchAsset:async(tag,name)=>{
   assert.equal(tag,releaseTag);return remote.has(name)?new Response(remote.get(name)):new Response(null,{status:404});}}};
}
test('requires separate authorization before any download',async t=>{const f=fixture(t);await assert.rejects(buildCleanupReceipt({...f.options,allowRemoteDownload:false}),/authorization/);assert.equal(f.calls.length,0);});
test('real multipart restore yields exact Bilibili files, legal empty items, source unchanged',async t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.source,f.dir,'bilibili-feed+bilibili_popular+bilibili_ranking.json.gz'));
 const result=await buildCleanupReceipt(f.options);assert.equal(result.receipt.files.length,1);assert.match(result.receipt.files[0].path,/bilibili-feed\+bilibili_popular\+bilibili_ranking/);
 assert.equal(result.sourceDeletionAuthorized,false);assert.equal(result.receipt.backup.restores[0].inventory.length,2);
 assert.deepEqual(fs.readFileSync(path.join(f.source,f.dir,'bilibili-feed+bilibili_popular+bilibili_ranking.json.gz')),before);
 assert.equal(verifyCleanupEvidence(result.receipt,f.gh).verified,true);
 assert(!f.calls.some(a=>a[0]==='release'));
});
test('interrupted or missing remote part cannot produce a cleanup receipt',async t=>{
 const f=fixture(t);f.remote.delete([...f.remote.keys()].find(k=>k.endsWith('part-0001')));
 await assert.rejects(buildCleanupReceipt(f.options),/part_missing/);
});
test('changed remote part cannot pass local restore',async t=>{
 const f=fixture(t);f.remote.set([...f.remote.keys()].find(k=>k.endsWith('part-0000')),Buffer.from('broken'));
 await assert.rejects(buildCleanupReceipt(f.options),/part_mismatch/);
});
test('metadata must still match at cleanup time; hashes alone do not claim a new restore',async t=>{
 const f=fixture(t),{receipt}=await buildCleanupReceipt(f.options);f.remote.set([...f.remote.keys()][0],Buffer.from('replaced'));
 assert.throws(()=>verifyCleanupEvidence(receipt,f.gh),/remote_asset_changed/);
});
test('forged file scope, incomplete restores and unbound inventory fail closed',async t=>{
 const f=fixture(t),{receipt}=await buildCleanupReceipt(f.options);
 const edit=change=>{const copy=structuredClone(receipt);change(copy);return copy;};
 assert.throws(()=>verifyCleanupEvidence(edit(r=>r.files[0].path=r.files[0].path.replace('bilibili','douyin')),f.gh),/not_restored/);
 assert.throws(()=>verifyCleanupEvidence(edit(r=>r.backup.restores=[]),f.gh),/incomplete/);
 assert.throws(()=>verifyCleanupEvidence(edit(r=>r.backup.restores[0].inventory[0].sha256='f'.repeat(64)),f.gh),/manifest_mismatch/);
});

test('真实多片还原回执接入逐文件清理，原备份和混合平台不动',async t=>{
 const f=fixture(t), result=await buildCleanupReceipt(f.options);
 const store=path.join(f.root,'store');fs.mkdirSync(path.join(store,'archive'),{recursive:true});
 fs.cpSync(path.join(f.source,f.dir),path.join(store,'archive',f.dir),{recursive:true});
 for(const d of ['2026-10-02-00','2026-10-03-00'])fs.mkdirSync(path.join(store,'archive',d));
 const before=new Map([...f.remote].map(([k,v])=>[k,sha(v)]));
 const run=await deleteVerifiedArchive({root:store,receipt:result.receipt,
  apply:true,approveSha256:result.receiptSha256,journalPath:path.join(f.root,'cleanup-journal.jsonl'),
  verifyEvidence:receipt=>verifyCleanupEvidence(receipt,f.gh)});
 assert.equal(run.removed.length,1);assert.equal(run.completed,true);
 assert(fs.existsSync(path.join(store,'archive',f.dir,'douyin-good.json.gz')));
 assert(fs.existsSync(path.join(f.source,f.dir,'bilibili-feed+bilibili_popular+bilibili_ranking.json.gz')));
 assert.deepEqual(new Map([...f.remote].map(([k,v])=>[k,sha(v)])),before);
});

test('Fly 清理元数据读取不需要 gh，不下载备份内容或转发凭证',async t=>{
 const f=fixture(t),{receipt}=await buildCleanupReceipt(f.options);
 const {verifyCleanupEvidenceOnFly}=await import('./growth-archive-cleanup.mjs');
 const calls=[];const env={FLY_APP_NAME:'fixture',GROWTH_BACKUP_REPOSITORY:receipt.repository,GROWTH_BACKUP_GITHUB_TOKEN:'test-token'};
 const deps={env,fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.method,'GET');
  assert.equal(options.headers.Accept,'application/vnd.github+json');assert.equal(options.headers.Authorization,'Bearer test-token');
  const pathname=new URL(url).pathname;
  if(pathname.endsWith('/'+receipt.repository))return Response.json({private:true,full_name:receipt.repository});
  if(pathname.includes('/tags/'))return Response.json({id:1,tag_name:receipt.backup.assets[0].releaseTag});
  assert(url.endsWith('/releases/1/assets?per_page=100&page=1'));
  return Response.json([...f.remote].map(([name,raw])=>({name,state:'uploaded',size:raw.length,digest:`sha256:${sha(raw)}`})));
 }};
 assert.equal((await verifyCleanupEvidenceOnFly(receipt,deps)).verified,true);
 assert.equal(calls.length,3);
 await assert.rejects(verifyCleanupEvidenceOnFly(receipt,{...deps,env:{...env,FLY_APP_NAME:''}}),/fly_repository_required/);
 await assert.rejects(verifyCleanupEvidenceOnFly(receipt,{...deps,env:{...env,GROWTH_BACKUP_GITHUB_TOKEN:''}}),/fly_token_required/);
 assert.equal(calls.length,3);
});

 test('取消的还原不读远端也不产生成功回执',async t=>{
  const f=fixture(t), controller=new AbortController();
  controller.abort(Error('cancelled-before-restore'));
  await assert.rejects(buildCleanupReceipt({...f.options,signal:controller.signal}),/cancelled-before-restore/);
  assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.root,'cache')),false);
 });

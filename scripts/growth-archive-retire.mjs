#!/usr/bin/env node
// 自动回收仅适用于已授权范围：bilibili-archives（B站旧策略）或 verified-archives（2026-11-18 用户授权，
// 冷备核验后退役同桶全部已发布平台来源）；实际还原与逐文件证明不可省略。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {buildCleanupReceipt, verifyCleanupEvidenceOnFly} from './growth-archive-cleanup.mjs';
import {deleteVerifiedArchive,RETIREMENT_SCOPES} from './growth-archive-delete-verified.mjs';

const SCOPES = Object.keys(RETIREMENT_SCOPES);
const POLICIES = {'bilibili-archives':'verified-published-bilibili-only','verified-archives':'verified-published-archive-sources'};
const validDir = value => /^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(value || '');
async function durableBytes(file, value) {
  const handle = await fs.open(file,'wx',0o600);
  try { await handle.writeFile(value); await handle.sync(); }
  finally { await handle.close(); }
  const parent = await fs.open(path.dirname(file),'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
async function durable(file,value) { return durableBytes(file,JSON.stringify(value,null,2)); }
async function realDirectory(directory) {
  const st=await fs.lstat(directory);
  if(!st.isDirectory() || st.isSymbolicLink())throw Error('growth_retire_directory_invalid');
  return fs.realpath(directory);
}
// 逐桶退役状态：供轮转游标判断；retirementCompleted=true 仅表示该桶本范围内已无待退役来源。
function bucketStates(dirs, selected, receiptFiles, removed) {
  return dirs.map(dir=>{
    if(!selected.includes(dir))return {dir,state:'no-eligible-sources',retirementCompleted:true,candidateFiles:0,removedFiles:0,removedLogicalBytes:0};
    const own=row=>row.path.startsWith(`archive/${dir}/`);
    const candidates=receiptFiles?receiptFiles.filter(own):null;
    const gone=(removed?.removed || []).filter(file=>file.startsWith(`archive/${dir}/`));
    const bytes=(removed?.files || []).filter(row=>own(row) && gone.includes(row.path)).reduce((n,row)=>n+row.bytes,0);
    const done=removed?.completed===true && candidates!==null && gone.length===candidates.length;
    return {dir,state:done?'retired':gone.length?'partial':'failed',retirementCompleted:done,
      candidateFiles:candidates?candidates.length:null,removedFiles:gone.length,removedLogicalBytes:bytes};
  });
}
function observation(stat) {
  const bsize=BigInt(stat.bsize), available=BigInt(stat.bavail);
  return {blockBytes:String(bsize),availableBlocks:String(available),availableBytes:String(bsize*available)};
}

/** 测试仅注入传输边界；生产依然调用相同的还原器与双锁逐文件删除器。 */
export async function retirePublishedArchives(input, {root,rootScope,allowRemoteDownload=false,
    receiptsRoot='/data/growth-cleanup-receipts',temporaryRoot=os.tmpdir(),
    gh,fetchAsset,verifyEvidence=verifyCleanupEvidenceOnFly,statfs=directory=>fs.statfs(directory,{bigint:true}),
    signal}={}) {
  if(!SCOPES.includes(rootScope))throw Error('growth_retire_bilibili_scope_required');
  const {member}=RETIREMENT_SCOPES[rootScope];
  if(!allowRemoteDownload)throw Error('growth_retire_remote_restore_authorization_required');
  if(typeof root!=='string' || !root)throw Error('growth_retire_store_required');
  const store=await realDirectory(path.resolve(root));
  const {batch,publication,manifests}=input || {};
  if(batch?.schemaVersion!==3 || !/^\d+-\d+(?:-backup)?$/.test(batch.batchId || '')
      || publication?.batchId!==batch.batchId || !Array.isArray(batch.archives)
      || (!Array.isArray(publication.uploaded) && !Array.isArray(publication.reused)) || !manifests || typeof manifests!=='object' || Array.isArray(manifests))
    throw Error('growth_retire_input_invalid');
  const seen=new Set(), selected=[], rawManifests=new Map();
  for(const entry of batch.archives) {
    if(!validDir(entry.dir) || seen.has(entry.dir))throw Error('growth_retire_archive_invalid');
    seen.add(entry.dir);
    const name=`archive-${entry.dir}.manifest.json`, encoded=manifests[name];
    if(typeof encoded!=='string')throw Error('growth_retire_manifest_encoding_required');
    const raw=Buffer.from(encoded,'base64');
    if(raw.toString('base64')!==encoded)throw Error('growth_retire_manifest_encoding_invalid');
    const manifest=JSON.parse(raw.toString('utf8'));
    rawManifests.set(name,raw);
    if(!manifest || manifest.dir!==entry.dir || !Array.isArray(manifest.inventory))throw Error('growth_retire_manifest_missing');
    if(manifest.inventory.some(row=>member.test(row.path || '')))selected.push(entry);
  }
  const dirs=batch.archives.map(entry=>entry.dir),selectedDirs=selected.map(entry=>entry.dir);
  if(!selected.length)return {schemaVersion:1,batchId:batch.batchId,rootScope,completed:true,
    skipped:rootScope==='bilibili-archives'?'no-bilibili-archives':'no-eligible-archives',removed:[],removedLogicalBytes:0,
    buckets:bucketStates(dirs,[],null,null)};
  signal?.throwIfAborted();
  await fs.mkdir(receiptsRoot,{recursive:true});
  const persistent=await realDirectory(path.resolve(receiptsRoot));
  if(persistent===store || persistent.startsWith(`${store}${path.sep}`))throw Error('growth_retire_receipts_must_be_outside_store');
  const evidenceDirectory=path.join(persistent,`${batch.batchId}-${randomUUID()}`);
  await fs.mkdir(evidenceDirectory,{mode:0o700});
  await durable(path.join(evidenceDirectory,'input.json'),input);
  const parent=await realDirectory(path.resolve(temporaryRoot));
  if(parent===store || parent.startsWith(`${store}${path.sep}`))throw Error('growth_retire_temporary_must_be_outside_store');
  const staging=await fs.mkdtemp(path.join(parent,'growth-retire-'));
  const token=randomUUID();
  await durable(path.join(staging,'.owner.json'),{token});
  const cleanupTemporary=async()=>{
    let st;try{st=await fs.lstat(staging);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(!st.isDirectory() || st.isSymbolicLink())throw Error('growth_retire_temporary_owner_changed');
    const markerPath=path.join(staging,'.owner.json');
    const markerStat=await fs.lstat(markerPath);
    if(!markerStat.isFile() || markerStat.isSymbolicLink())throw Error('growth_retire_temporary_owner_changed');
    const marker=JSON.parse(await fs.readFile(markerPath,'utf8'));
    if(marker.token!==token || (await realDirectory(staging))!==staging)throw Error('growth_retire_temporary_owner_changed');
    await fs.rm(staging,{recursive:true});
  };
  let completedDeletion,receiptFiles=null;
  try {
    await fs.mkdir(path.join(staging,'assets'));
    await durable(path.join(staging,'offload-manifest.json'),{...batch,archives:selected});
    await durable(path.join(staging,'publication-result.json'),publication);
    for(const entry of selected) {
      const name=`archive-${entry.dir}.manifest.json`;
      // 保留原manifest字节；新发布和历史复用均按相同SHA核对，不重新序列化。
      await durableBytes(path.join(staging,'assets',name),rawManifests.get(name));
    }
    const before=observation(await statfs(store));
    const proof=await buildCleanupReceipt({root:staging,cacheRoot:path.join(staging,'restore'),allowRemoteDownload:true,gh,fetchAsset,signal,
      ...(rootScope==='bilibili-archives'?{}:{scope:rootScope})});
    receiptFiles=proof.receipt.files;
    signal?.throwIfAborted();
    await durable(path.join(evidenceDirectory,'cleanup-receipt.json'),proof.receipt);
    await durable(path.join(evidenceDirectory,'authorization.json'),{
      rootScope,policy:POLICIES[rootScope],receiptSha256:proof.receiptSha256,
      batchId:batch.batchId,files:proof.receipt.files,createdAt:new Date().toISOString(),
    });
    const removed=await deleteVerifiedArchive({root:store,receipt:proof.receipt,receiptSha256:proof.receiptSha256,
      apply:true,approveSha256:proof.receiptSha256,verifyEvidence,
      journalPath:path.join(evidenceDirectory,'cleanup-journal.jsonl'),signal});
    completedDeletion=removed;
    await cleanupTemporary();
    const after=observation(await statfs(store));
    const result={...removed,batchId:batch.batchId,rootScope,evidenceDirectory,
      filesystem:{before,after,observedAvailableBytesDelta:String(BigInt(after.availableBytes)-BigInt(before.availableBytes)),
        attribution:'文件系统观测差值可能包含同期其他写入，不能当作本次单独释放量'},
      remoteRestoreVerified:true,buckets:bucketStates(dirs,selectedDirs,receiptFiles,removed)};
    await durable(path.join(evidenceDirectory,'result.json'),result);
    return result;
  } catch(error) {
    // 先保留清单、预期哈希和失败回执，再只回收本次下载的临时副本。
    const partial=error.cleanupResult || completedDeletion || null;
    error.retirementBuckets=bucketStates(dirs,selectedDirs,receiptFiles,partial);
    await durable(path.join(evidenceDirectory,'failure.json'),{error:error.message,staging,partial,buckets:error.retirementBuckets});
    try { await cleanupTemporary(); }
    catch(cleanupError) { await durable(path.join(evidenceDirectory,'temporary-cleanup-failure.json'),{error:cleanupError.message,staging}); }
    error.retirementEvidenceDirectory=evidenceDirectory;
    error.retirementStaging=staging;
    throw error;
  }
}

async function main() {
  const flags=process.argv.slice(2);
  const scope=SCOPES.find(name=>flags.includes(`--scope=${name}`));
  if(flags.length!==2 || !scope || !flags.includes('--allow-remote-download'))
    throw Error('Usage: growth-archive-retire.mjs --scope=bilibili-archives|verified-archives --allow-remote-download < metadata.json');
  if(!process.env.FLY_APP_NAME || !process.env.GROWTH_STORE_DIR)throw Error('growth_retire_fly_store_required');
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>32*1024*1024)throw Error('growth_retire_input_too_large');chunks.push(chunk);}
  const controller=new AbortController();
  for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>controller.abort(Error(`growth_retire_cancelled:${name}`)));
  const result=await retirePublishedArchives(JSON.parse(Buffer.concat(chunks).toString('utf8')),{root:process.env.GROWTH_STORE_DIR,
    rootScope:scope,allowRemoteDownload:true,signal:controller.signal});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(JSON.stringify({error:error.message,evidenceDirectory:error.retirementEvidenceDirectory,
    staging:error.retirementStaging,partial:error.cleanupResult,buckets:error.retirementBuckets}));process.exitCode=1;});
}

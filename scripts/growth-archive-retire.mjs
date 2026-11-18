#!/usr/bin/env node
// 自动回收仅适用于已授权范围：bilibili-archives（B站旧策略）或 verified-archives（2026-11-18 用户授权，
// 冷备核验后退役同桶全部已发布平台来源）；实际还原与逐文件证明不可省略。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {buildCleanupReceipt, verifyCleanupEvidenceOnFly} from './growth-archive-cleanup.mjs';
import {deleteVerifiedArchive,RETIREMENT_SCOPES,cleanupReceiptSha256,upgradeRetirementMarker,markRetirementPending,completeRetirementMarker} from './growth-archive-delete-verified.mjs';
import {parseGrowthArchiveManifest} from '../shared/growthArchiveRestore.mjs';

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
    signal,onJournal}={}) {
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
      journalPath:path.join(evidenceDirectory,'cleanup-journal.jsonl'),signal,onJournal});
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

// 2026-11-18 用户授权（验快照即可）：旧范围只退B站的桶被 offload 冻结、不再进批次。其剩余已发布平台来源
// 只与该桶旧标记中已核验的冷备证据（清单原字节 + 当时实际还原后的逐文件清单）比对大小与 sha256，
// 不再下载还原；远端只复核资产元数据仍在。一致者走同一双锁逐文件删除器；不一致/未列出者保留并
// 报数量与字节，不阻塞其他文件或桶。整桶无剩余后升级标记，不再每班重复处理。
const LEGACY_MAX_BUCKETS=8, LEGACY_MAX_BYTES=1024*1024*1024;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
async function fileSha(file){const digest=createHash('sha256');const handle=await fs.open(file,'r');
  try{for await(const chunk of handle.createReadStream({autoClose:false}))digest.update(chunk);}finally{await handle.close();}
  return digest.digest('hex');}
async function scanLegacyBucket(store,dir) {
  const {member}=RETIREMENT_SCOPES['verified-archives'],present=[],outside=[];
  const visit=async relative=>{
    for(const entry of await fs.readdir(path.join(store,relative),{withFileTypes:true})) {
      const child=`${relative}/${entry.name}`;
      if(entry.isDirectory()){await visit(child);continue;}
      if(/^(kuaishou|toutiao)[-_.]/i.test(entry.name) || entry.name.startsWith('._'))continue;
      const row={path:child,bytes:(await fs.lstat(path.join(store,child))).size};
      (entry.isFile() && relative===`archive/${dir}` && member.test(entry.name)?present:outside).push(row);
    }
  };
  await visit(`archive/${dir}`);
  return {present:present.sort((a,b)=>a.path.localeCompare(b.path,'en')),outside};
}
export async function retireLegacyMarkedArchives(request,{root,receiptsRoot='/data/growth-cleanup-receipts',
    verifyEvidence=verifyCleanupEvidenceOnFly,repository=process.env.GROWTH_BACKUP_REPOSITORY || 'gabrieltan0506-prog/mvstudiopro-growth-data',
    maxBuckets=LEGACY_MAX_BUCKETS,maxBytes=LEGACY_MAX_BYTES,signal}={}) {
  if(request?.schemaVersion!==1 || request.mode!=='legacy-retired-markers' || !/^\d+-\d+(?:-backup)?$/.test(request.batchId || ''))
    throw Error('growth_retire_legacy_request_invalid');
  if(typeof root!=='string' || !root)throw Error('growth_retire_store_required');
  const store=await realDirectory(path.resolve(root));
  await fs.mkdir(receiptsRoot,{recursive:true});
  const persistent=await realDirectory(path.resolve(receiptsRoot));
  if(persistent===store || persistent.startsWith(`${store}${path.sep}`))throw Error('growth_retire_receipts_must_be_outside_store');
  const result={schemaVersion:1,mode:'legacy-retired-markers',batchId:request.batchId,rootScope:'verified-archives',
    completed:true,buckets:[],invalidMarkers:[],deferred:0,removedLogicalBytes:0,keptFiles:0,keptBytes:0};
  const markersRoot=path.join(store,'.growth-archive-retired');
  let names=[];try{names=await fs.readdir(markersRoot);}catch(error){if(error.code!=='ENOENT')throw error;}
  const buckets=(await fs.readdir(path.join(store,'archive'))).filter(validDir).sort(),newest=buckets.slice(-2);
  // 每班从上次消耗额度的最后一桶之后开始轮转，持续不一致的前排桶不能让后排桶永远延后。
  const cursorFile=path.join(persistent,'legacy-retired-cursor.json');
  let lastDir=null;try{const c=JSON.parse(await fs.readFile(cursorFile,'utf8'));if(c?.schemaVersion===1 && validDir(c.lastDir))lastDir=c.lastDir;}catch{}
  const sorted=names.filter(n=>/^\d{4}-\d{2}-\d{2}(?:-\d{2})?\.json$/.test(n)).sort();
  const start=lastDir===null?0:Math.max(0,sorted.findIndex(n=>n.slice(0,-5)>lastDir));
  let used=0,processed=0,charged=null;
  for(const name of [...sorted.slice(start),...sorted.slice(0,start)]) {
    // 中途取消：保留已完成桶的结果再停，不能把已删除的来源从输出里丢掉。
    if(signal?.aborted){result.completed=false;result.stopped=String(signal.reason?.message||'cancelled');break;}
    const dir=name.slice(0,-5);
    let marker,manifest,manifestRaw;
    try {
      const st=await fs.lstat(path.join(markersRoot,name));if(!st.isFile() || st.isSymbolicLink())throw Error('type');
      marker=JSON.parse(await fs.readFile(path.join(markersRoot,name),'utf8'));
      if(marker.schemaVersion!==1 || marker.dir!==dir || !/^[a-f0-9]{64}$/.test(marker.receiptSha256 || ''))throw Error('contract');
    } catch {
      // 标记无法解析（如 0 字节）：来源一律保留，但必须明确报告该桶未完成，不能算本班成功。
      result.invalidMarkers.push(dir);result.completed=false;
      result.buckets.push({dir,state:'marker-invalid',retirementCompleted:false,removedFiles:0,removedLogicalBytes:0,keptFiles:0,keptBytes:0,error:'retirement_marker_unreadable'});
      continue;
    }
    if(marker.platform==='verified-archives' && marker.state==='completed')continue;
    const report=(state,extra={})=>{result.buckets.push({dir,state,retirementCompleted:false,removedFiles:0,removedLogicalBytes:0,keptFiles:0,keptBytes:0,...extra});};
    if(!['bilibili','verified-archives'].includes(marker.platform) || (marker.state!==undefined && !['pending','completed'].includes(marker.state))){result.invalidMarkers.push(dir);result.completed=false;report('marker-invalid',{error:'retirement_marker_contract'});continue;}
    // verified 标记未完成（pending，或旧格式无 state 但仍有授权来源）：按原回执续删。
    const resume=marker.platform==='verified-archives';
    if(newest.includes(dir)){report('latest-bucket-protected');continue;}
    if(!buckets.includes(dir)){report('bucket-absent');continue;}
    const scan=await scanLegacyBucket(store,dir),restore=marker.restore;
    const keep=rows=>({keptFiles:rows.length,keptBytes:rows.reduce((n,row)=>n+row.bytes,0)});
    try {
      manifestRaw=Buffer.from(restore?.manifestBase64 || '','base64');
      manifest=parseGrowthArchiveManifest(JSON.parse(manifestRaw.toString('utf8')),dir);
      if(restore.dir!==dir || sha(manifestRaw)!==restore.manifestSha256 || typeof restore.releaseTag!=='string'
          || !Array.isArray(restore.inventory) || manifest.archive.sha256!==restore.archiveSha256)throw Error('evidence');
    } catch {
      const kept=keep([...scan.present,...scan.outside]);result.keptFiles+=kept.keptFiles;result.keptBytes+=kept.keptBytes;
      report('marker-evidence-unusable',kept);continue;
    }
    // 授权文件：旧B站桶 = 标记中已核验还原清单；pending = 原回执 files；旧格式 verified = 原回执的构造规则
    // （还原清单中本范围成员），可由标记自身证明。
    const {member}=RETIREMENT_SCOPES['verified-archives'];
    let cold=new Map(restore.inventory.map(row=>[`archive/${dir}/${row.path}`,row]));
    if(resume && marker.state==='pending') {
      if(!Array.isArray(marker.files) || marker.files.some(row=>typeof row?.path!=='string' || !row.path.startsWith(`archive/${dir}/`))) {
        const kept=keep([...scan.present,...scan.outside]);result.keptFiles+=kept.keptFiles;result.keptBytes+=kept.keptBytes;
        report('marker-evidence-unusable',kept);continue;
      }
      cold=new Map(marker.files.map(row=>[row.path,row]));
    } else if(resume) {
      if(!scan.present.length)continue;
      const files=restore.inventory.filter(row=>member.test(row.path)).map(row=>({path:`archive/${dir}/${row.path}`,bytes:row.bytes,sha256:row.sha256}));
      await markRetirementPending(store,dir,marker.receiptSha256,files);
      marker={...marker,state:'pending',files};cold=new Map(files.map(row=>[row.path,row]));
    }
    // 只按名称+大小可能匹配的文件计入哈希额度；明确未列出者直接保留，不占额度、不阻塞后续桶。
    const candidates=scan.present.filter(row=>cold.get(row.path)?.bytes===row.bytes);
    const kept=[...scan.outside,...scan.present.filter(row=>!candidates.includes(row))];
    const bytes=candidates.reduce((n,row)=>n+row.bytes,0);
    if(candidates.length && (processed>=maxBuckets || (processed && used+bytes>maxBytes))){result.deferred++;continue;}
    if(candidates.length){processed++;used+=bytes;charged=dir;}
    const matched=[];
    for(const row of candidates) {
      const expected=cold.get(row.path);
      if(await fileSha(path.join(store,row.path))===expected.sha256)matched.push({path:row.path,bytes:row.bytes,sha256:expected.sha256});
      else kept.push(row);
    }
    const keptSummary=keep(kept);result.keptFiles+=keptSummary.keptFiles;result.keptBytes+=keptSummary.keptBytes;
    if(!matched.length) {
      if(kept.length){report(resume?'resume-kept':'kept-not-in-verified-backup',keptSummary);continue;}
      if(resume) {
        await completeRetirementMarker(store,dir,marker.receiptSha256);
        result.buckets.push({dir,state:'resume-nothing-left',retirementCompleted:true,removedFiles:0,removedLogicalBytes:0,keptFiles:0,keptBytes:0});
        continue;
      }
      // 本范围内已无来源（只剩已退出平台/元数据）：无需删除，直接升级标记。
      await upgradeRetirementMarker(store,dir,marker.receiptSha256,{receiptSha256:marker.receiptSha256,restore,createdAt:new Date().toISOString()});
      result.buckets.push({dir,state:'nothing-to-retire',retirementCompleted:true,removedFiles:0,removedLogicalBytes:0,keptFiles:0,keptBytes:0});
      continue;
    }
    const assets=[{releaseTag:restore.releaseTag,name:`archive-${dir}.manifest.json`,bytes:manifestRaw.length,sha256:restore.manifestSha256},
      ...manifest.parts.map(part=>({releaseTag:restore.releaseTag,name:part.assetName,bytes:part.bytes,sha256:part.sha256}))];
    const receipt={schemaVersion:1,evidenceKind:'remote-restore',repository,createdAt:new Date().toISOString(),scope:'verified-archives',
      evidenceSource:resume?'resume-pending-marker':'legacy-marker-restore',
      [resume?'resumedMarkerReceiptSha256':'legacyMarkerReceiptSha256']:marker.receiptSha256,files:matched,
      backup:{batchId:request.batchId,assets,restores:[restore]}};
    const digest=cleanupReceiptSha256(receipt);
    const evidenceDirectory=path.join(persistent,`${request.batchId}-legacy-${dir}-${randomUUID()}`);
    await fs.mkdir(evidenceDirectory,{mode:0o700});
    await durable(path.join(evidenceDirectory,'cleanup-receipt.json'),receipt);
    await durable(path.join(evidenceDirectory,'authorization.json'),{rootScope:'verified-archives',policy:resume?'resume-pending-marker-receipt':'legacy-marker-verified-inventory',
      receiptSha256:digest,batchId:request.batchId,files:matched,kept:kept.map(({path,bytes})=>({path,bytes})),createdAt:new Date().toISOString()});
    try {
      const removed=await deleteVerifiedArchive({root:store,receipt,receiptSha256:digest,apply:true,approveSha256:digest,verifyEvidence,
        journalPath:path.join(evidenceDirectory,'cleanup-journal.jsonl'),signal,
        ...(resume?{resumeMarkers:{[dir]:marker.receiptSha256}}:{}),
        ...(kept.length?{keepUnlistedInLegacyBuckets:true}:resume?{}:{upgradeMarkers:{[dir]:marker.receiptSha256}})});
      await durable(path.join(evidenceDirectory,'result.json'),removed);
      result.removedLogicalBytes+=removed.removedLogicalBytes;
      report(`${resume?'resumed':'retired'}${kept.length?'-partially-kept':''}`,{retirementCompleted:!kept.length,removedFiles:removed.removed.length,
        removedLogicalBytes:removed.removedLogicalBytes,...keptSummary,evidenceDirectory});
    } catch(error) {
      await durable(path.join(evidenceDirectory,'failure.json'),{error:error.message,partial:error.cleanupResult || null});
      result.removedLogicalBytes+=error.cleanupResult?.removedLogicalBytes || 0;
      if(/growth_cleanup_busy|cancelled/.test(error.message)){
        // 采集占锁或被取消：本班到此为止，但前面桶已删除的内容必须如实出现在结果里。
        result.completed=false;result.stopped=error.message;
        report('deferred-busy',{error:error.message,removedFiles:error.cleanupResult?.removed?.length || 0,
          removedLogicalBytes:error.cleanupResult?.removedLogicalBytes || 0,...keptSummary,evidenceDirectory});
        break;
      }
      result.completed=false;
      report('failed',{error:error.message,removedFiles:error.cleanupResult?.removed?.length || 0,
        removedLogicalBytes:error.cleanupResult?.removedLogicalBytes || 0,...keptSummary,evidenceDirectory});
    }
  }
  if(charged) {
    const next=`${cursorFile}.next-${randomUUID()}`;
    await durable(next,{schemaVersion:1,lastDir:charged,batchId:request.batchId});await fs.rename(next,cursorFile);
  }
  return result;
}

async function main() {
  const flags=process.argv.slice(2);
  if(flags.length===3 && flags.includes('--legacy-retired-markers') && flags.includes('--scope=verified-archives') && flags.includes('--allow-remote-download')) {
    if(!process.env.FLY_APP_NAME || !process.env.GROWTH_STORE_DIR)throw Error('growth_retire_fly_store_required');
    const chunks=[];for await(const chunk of process.stdin){chunks.push(chunk);if(chunks.length>64)throw Error('growth_retire_input_too_large');}
    const controller=new AbortController();
    for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>controller.abort(Error(`growth_retire_cancelled:${name}`)));
    const result=await retireLegacyMarkedArchives(JSON.parse(Buffer.concat(chunks).toString('utf8')),{root:process.env.GROWTH_STORE_DIR,signal:controller.signal});
    process.stdout.write(JSON.stringify(result)+'\n');
    if(!result.completed)process.exitCode=3;
    return;
  }
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

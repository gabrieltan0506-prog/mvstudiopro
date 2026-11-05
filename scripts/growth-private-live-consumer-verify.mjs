#!/usr/bin/env node
// Fly独立验收：生产消费者输出必须与本次私有清单一致；不删除任何来源。
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 if(process.env.FLY_APP_NAME!=='mvstudiopro')throw Error('private_live_fly_required');
 const [dir,expectedTag,...rest]=process.argv.slice(2);
 if(rest.length||!/^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(dir||'')||!/^growth-archive-[A-Za-z0-9._-]+$/.test(expectedTag||''))throw Error('private_live_arguments');
 const repository='gabrieltan0506-prog/mvstudiopro-growth-data';
 if(process.env.GROWTH_BACKUP_REPOSITORY!==repository)throw Error('private_live_repository_mismatch');
 const {createGrowthPrivateAssetFetch}=await import('/app/shared/growthPrivateAssetFetch.mjs');
 const fetchPrivate=createGrowthPrivateAssetFetch({repository,token:process.env.GROWTH_BACKUP_GITHUB_TOKEN});
 const r=await fetchPrivate(`https://github.com/${repository}/releases/download/${expectedTag}/archive-${dir}.manifest.json`,{signal:AbortSignal.timeout(180000)});
 if(!r.ok)throw Error(`private_live_manifest_http_${r.status}`);
 const chunks=[];let bytes=0;for await(const chunk of r.body){bytes+=chunk.length;if(bytes>5*1024*1024)throw Error('private_live_manifest_size');chunks.push(chunk);}
 const raw=Buffer.concat(chunks),manifest=JSON.parse(raw);
 const {parseGrowthArchiveManifest}=await import('/app/shared/growthArchiveRestore.mjs');parseGrowthArchiveManifest(manifest,dir);
 const root=await fs.mkdtemp('/tmp/growth-private-live-consumer-'),owner=randomUUID();await fs.writeFile(path.join(root,'.owner'),owner,{flag:'wx',mode:0o600});
 process.env.GROWTH_GITHUB_OFFLOAD_CACHE_DIR=root;
 try{
  const {ensureOffloadedArchiveDir}=await import('/app/server/growth/trendStore.ts');
  const restored=await ensureOffloadedArchiveDir(dir);if(!restored)throw Error('private_live_consumer_unavailable');
  const receipt=JSON.parse(await fs.readFile(path.join(path.dirname(restored),'restore-receipt.json'),'utf8'));
  if(receipt.manifestHash!==sha(raw)||receipt.archiveSha!==manifest.archive.sha256||!receipt.inventory?.length||JSON.stringify(receipt.inventory)!==JSON.stringify(manifest.inventory))throw Error('private_live_consumer_private_identity_mismatch');
  const parent='/data/growth-cleanup-receipts';await fs.mkdir(parent,{recursive:true});const evidence=await fs.mkdtemp(path.join(parent,'private-live-consumer-'));
  const result={ok:true,dir,expectedTag,repository,files:receipt.inventory.length,items:receipt.inventory.reduce((n,f)=>n+f.items,0),manifestSha256:sha(raw),archiveSha256:receipt.archiveSha,evidenceDirectory:evidence};
  for(const [name,value] of [['manifest.original.json',raw],['restore-receipt.json',JSON.stringify(receipt,null,2)],['result.json',JSON.stringify(result,null,2)]]){const h=await fs.open(path.join(evidence,name),'wx',0o600);try{await h.writeFile(value);await h.sync();}finally{await h.close();}}
  const st=await fs.lstat(path.join(root,'.owner'));if(!st.isFile()||st.isSymbolicLink()||await fs.readFile(path.join(root,'.owner'),'utf8')!==owner)throw Error('private_live_owner_changed');await fs.rm(root,{recursive:true});console.log(JSON.stringify(result));
 }catch(error){await fs.writeFile(path.join(root,'failure.json'),JSON.stringify({error:error.message,dir,expectedTag}),{flag:'wx'});console.error(JSON.stringify({error:error.message,evidenceDirectory:root}));throw error;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

// GitHub 备份访问只在 Fly 内执行；返回 metadata 或小型 manifest，不回传凭证。
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const tagOK=x=>/^growth-(?:archive|cold-store|backup|current)[A-Za-z0-9._-]*$/.test(x||'');
const nameOK=x=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(x||'');
const pointerOK=x=>x==='growth-backup-latest.json'||/^archive-\d{4}-\d{2}-\d{2}(?:-\d{2})?\.latest\.json$/.test(x||'');
export async function executeBackupRequest(request,{env=process.env,fetchImpl=fetch,input=process.stdin}={}) {
 const repo=env.GROWTH_BACKUP_REPOSITORY||'gabrieltan0506-prog/mvstudiopro-growth-data';
 const token=env.GROWTH_BACKUP_GITHUB_TOKEN;
 if(!env.FLY_APP_NAME||!token||/[\r\n]/.test(token)||request.repository!==repo)throw Error('backup_gateway_fly_credentials_required');
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('backup_gateway_repository_invalid');
 const root=`https://api.github.com/repos/${repo}`;
 const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 async function api(suffix,options={}) {
  const r=await fetchImpl(root+suffix,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(180000)});
  if(!r.ok)throw Error(`backup_gateway_http_${r.status}`);
  return r.status===204?null:r.json();
 }
 const info=await api('');
 if(info.private!==true||info.full_name?.toLowerCase()!==repo.toLowerCase())throw Error('backup_gateway_private_repository_required');
 async function pages(suffix) {
  const out=[];for(let page=1;page<=100;page++) {const rows=await api(`${suffix}?per_page=100&page=${page}`);if(!Array.isArray(rows))throw Error('backup_gateway_metadata_invalid');out.push(rows);if(rows.length<100)return out;}throw Error('backup_gateway_page_limit');
 }
 const release=async()=>{if(!tagOK(request.tag))throw Error('backup_gateway_tag_invalid');const r=await api('/releases/tags/'+encodeURIComponent(request.tag));if(!Number.isSafeInteger(r.id)||r.id<=0||r.tag_name!==request.tag)throw Error('backup_gateway_release_invalid');return r;};
 if(request.operation==='repo')return {nameWithOwner:info.full_name,isPrivate:true};
 if(request.operation==='api') {
  const prefix=`repos/${repo}`;if(!request.endpoint?.startsWith(prefix+'/'))throw Error('backup_gateway_scope');
  const suffix=request.endpoint.slice(prefix.length).replace(/\?per_page=100$/,'');
  if(suffix==='/releases'||/^\/releases\/\d+\/assets$/.test(suffix))return request.paginate?pages(suffix):api(suffix);
  if(suffix.startsWith('/releases/tags/')&&tagOK(decodeURIComponent(suffix.slice(15))))return api(suffix);
  throw Error('backup_gateway_read_scope');
 }
 if(request.operation==='create') {
  if(!tagOK(request.tag)||typeof request.title!=='string'||typeof request.notes!=='string')throw Error('backup_gateway_create_invalid');
  return api('/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:request.tag,name:request.title,body:request.notes,make_latest:'false'})});
 }
 if(request.operation==='manifests') {
  const r=await release(),rows=(await pages(`/releases/${r.id}/assets`)).flat(),result=[];
  for(const a of rows.filter(x=>/^archive-\d{4}-\d{2}-\d{2}(?:-\d{2})?\.manifest\.json$/.test(x.name))) {
   if(a.size<=0||a.size>5*1024*1024||!Number.isSafeInteger(a.id)||a.id<=0)throw Error('backup_gateway_manifest_invalid');
   let url=root+`/releases/assets/${a.id}`,response;
   for(let n=0;n<6;n++) {
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('backup_gateway_redirect_invalid');
    response=await fetchImpl(url,{headers:u.origin==='https://api.github.com'&&u.pathname.startsWith(`/repos/${repo}/releases/`)?{...headers,Accept:'application/octet-stream'}:{Accept:'application/octet-stream'},redirect:'manual',signal:AbortSignal.timeout(30000)});
    if(![301,302,303,307,308].includes(response.status))break;
    const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('backup_gateway_redirect_invalid');url=new URL(next,url).href;
   }
   if(!response?.ok)throw Error('backup_gateway_manifest_download_failed');
   const chunks=[];let size=0;for await(const c of response.body){size+=c.length;if(size>a.size)throw Error('backup_gateway_manifest_size');chunks.push(c);}
   const raw=Buffer.concat(chunks);if(raw.length!==a.size||a.digest!==`sha256:${createHash('sha256').update(raw).digest('hex')}`)throw Error('backup_gateway_manifest_digest');
   result.push({name:a.name,base64:raw.toString('base64')});
  }return result;
 }
 if(request.operation==='upload') {
  if(!nameOK(request.name)||!Number.isSafeInteger(request.bytes)||request.bytes<=0||request.bytes>=2147483648||!/^[a-f0-9]{64}$/.test(request.sha256)||request.replace&&!pointerOK(request.name))throw Error('backup_gateway_upload_invalid');
  const r=await release(),rows=(await pages(`/releases/${r.id}/assets`)).flat(),existing=rows.filter(a=>a.name===request.name);
  if(existing.length>1||existing.length&&!request.replace)throw Error('backup_gateway_immutable_conflict');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'growth-gateway-'));
  try {
   const file=path.join(dir,'asset'),handle=await fs.open(file,'wx',0o600),digest=createHash('sha256');let size=0;
   try {for await(const chunk of input){size+=chunk.length;if(size>request.bytes)throw Error('backup_gateway_upload_size');digest.update(chunk);await handle.writeFile(chunk);}}finally{await handle.close();}
   if(size!==request.bytes||digest.digest('hex')!==request.sha256)throw Error('backup_gateway_upload_digest');
   if(existing.length)await api(`/releases/assets/${existing[0].id}`,{method:'DELETE'});
   const url=`https://uploads.github.com/repos/${repo}/releases/${r.id}/assets?name=${encodeURIComponent(request.name)}&label=${encodeURIComponent(request.label||'')}`;
   const response=await fetchImpl(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(size)},body:createReadStream(file),duplex:'half',redirect:'error',signal:AbortSignal.timeout(300000)});
   if(!response.ok)throw Error(`backup_gateway_upload_http_${response.status}`);
   const uploaded=await response.json();if(uploaded.name!==request.name||uploaded.size!==size||uploaded.digest!==`sha256:${request.sha256}`||uploaded.state!=='uploaded')throw Error('backup_gateway_upload_unverified');
   return uploaded;
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 }
 throw Error('backup_gateway_operation_invalid');
}
export async function main(request){try{process.stdout.write(JSON.stringify(await executeBackupRequest(request)));}catch(error){console.error(error.message);process.exitCode=1;}}

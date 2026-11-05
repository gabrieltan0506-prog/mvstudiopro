#!/usr/bin/env node
// 用户明确退出平台的本地历史删除器；不触碰远端备份、共享账本或其他平台。
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Error('excluded_cleanup_'+x);};
export const manifestSha256=x=>hash(JSON.stringify(x));
export function allowedPath(p) {
 return typeof p==='string' && (/^archive\/\d{4}-\d{2}-\d{2}(?:-\d{2})?\/(?:kuaishou|toutiao)-[A-Za-z0-9_.+-]+\.json\.gz$/.test(p)
 || /^(?:platforms|history-ledger)\/(?:kuaishou|toutiao)\.json(?:\.gz)?$/.test(p)
 || /^platforms\/\._(?:kuaishou|toutiao)\.json$/.test(p)
 || /^(?:platforms\.prev|restore-temp\/writeback-\d{8}T\d{6}\/platforms)\/(?:kuaishou|toutiao)\.json$/.test(p)
 || /^(?:platforms\.prev|restore-temp\/writeback-\d{8}T\d{6}\/platforms)\/(kuaishou|toutiao)\/\1_[A-Za-z0-9_.+-]+\.json$/.test(p)
 || /^platform-current\/(?:kuaishou|toutiao)\.current\.json(?:\.gz)?$/.test(p));
}
const identity=s=>({ino:s.ino,dev:s.dev,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,nlink:s.nlink});
async function inspect(root,relative) {
 if(!allowedPath(relative))fail('scope');
 const components=relative.split('/');let dir=root;
 for(const c of ['',...components.slice(0,-1)]) {
  if(c)dir=path.join(dir,c);const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())fail('directory');
 }
 const file=path.join(root,relative),s=await fs.lstat(file);
 if(!s.isFile()||s.isSymbolicLink())fail('file');
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
  if(JSON.stringify(identity(s))!==JSON.stringify(identity(await h.stat())))fail('changed');
  const digest=createHash('sha256');for await(const chunk of h.createReadStream({autoClose:false}))digest.update(chunk);
  if(JSON.stringify(identity(s))!==JSON.stringify(identity(await h.stat()))||JSON.stringify(identity(s))!==JSON.stringify(identity(await fs.lstat(file))))fail('changed');
  return {path:relative,sha256:digest.digest('hex'),...identity(s)};
 } finally{await h.close();}
}
async function candidates(root) {
 const result=[];
 async function list(dir){try{return await fs.readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 for(const base of ['platforms','history-ledger','platform-current']) {
  for(const e of await list(path.join(root,base)))if(allowedPath(base+'/'+e.name))result.push(base+'/'+e.name);
 }
 for(const bucket of await list(path.join(root,'archive')))if(/^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(bucket.name)) {
  if(!bucket.isDirectory()||bucket.isSymbolicLink())continue;
  for(const e of await list(path.join(root,'archive',bucket.name))) {
   const name='archive/'+bucket.name+'/'+e.name;if(allowedPath(name))result.push(name);
  }
 }
 // 仅走盘点确认的固定层级，禁止递归按名称搜索。
 async function prior(base) {
  for(const e of await list(path.join(root,base))) {
   const rel=base+'/'+e.name;if(allowedPath(rel))result.push(rel);
   if(['kuaishou','toutiao'].includes(e.name)&&e.isDirectory()&&!e.isSymbolicLink())
    for(const leaf of await list(path.join(root,rel)))if(allowedPath(rel+'/'+leaf.name))result.push(rel+'/'+leaf.name);
  }
 }
 await prior('platforms.prev');
 for(const batch of await list(path.join(root,'restore-temp')))if(/^writeback-\d{8}T\d{6}$/.test(batch.name)&&batch.isDirectory()&&!batch.isSymbolicLink())
  await prior('restore-temp/'+batch.name+'/platforms');
 return result.sort();
}
export async function planExcludedCleanup(root) {
 root=path.resolve(root);const rows=[];for(const p of await candidates(root))rows.push(await inspect(root,p));
 const manifest={schemaVersion:1,scope:['kuaishou','toutiao'],root:await fs.realpath(root),createdAt:new Date().toISOString(),files:rows};
 return {manifest,manifestSha256:manifestSha256(manifest),logicalBytes:rows.reduce((n,r)=>n+r.size,0)};
}
async function acquireLeases(root) {
  const token = `growth-cleanup:${process.pid}:${randomUUID()}`;
  const leases = [];
  let timer, pending = null, lost = null;
  async function assertOwned() {
    if (lost) throw lost;
    for (const lease of leases) {
      const [current, held, raw] = await Promise.all([
        fs.lstat(lease.file), lease.handle.stat(), fs.readFile(lease.file, "utf8"),
      ]);
      if (!current.isFile() || current.ino !== held.ino || current.dev !== held.dev || raw !== lease.raw)
        fail("lease_lost");
    }
  }
  async function release() {
    clearInterval(timer);
    if (pending) await pending;
    for (const lease of [...leases].reverse()) {
      try {
        const [current, held, raw] = await Promise.all([
          fs.lstat(lease.file), lease.handle.stat(), fs.readFile(lease.file, "utf8"),
        ]);
        if (current.isFile() && current.ino === held.ino && current.dev === held.dev && raw === lease.raw)
          await fs.unlink(lease.file);
      } catch { /* 不移除其他所有者替换的新锁。 */ }
      await lease.handle.close();
    }
  }
  try {
    for (const [name, raw] of [
      [".growth-platform-collection.lock", token],
      [".growth-store-mutation.lock", JSON.stringify({ token, pid: process.pid, operation: "excluded-platform-cleanup" })],
    ]) {
      const file = path.join(root, name);
      let handle;
      try { handle = await fs.open(file, "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") fail("busy"); throw error; }
      leases.push({ file, handle, raw });
      await handle.writeFile(raw);
      await handle.sync();
    }
    await assertOwned();
    timer = setInterval(() => {
      if (pending || lost) return;
      pending = (async () => {
        await assertOwned();
        for (const lease of leases) { const now = new Date(); await lease.handle.utimes(now, now); }
      })().catch(error => { lost = error; }).finally(() => { pending = null; });
    }, 10_000);
    timer.unref();
    return { assertOwned, release };
  } catch (error) { await release(); throw error; }
}


export async function applyExcludedCleanup({root,manifest,approveSha256,journalPath,signal,onJournal,statfs=p=>fs.statfs(p,{bigint:true})}) {
 const digest=manifestSha256(manifest);root=path.resolve(root);
 if(!approveSha256||approveSha256!==digest)fail('approval');
 if(manifest?.schemaVersion!==1||JSON.stringify(manifest.scope)!=='["kuaishou","toutiao"]'||!Array.isArray(manifest.files)||manifest.root!==await fs.realpath(root))fail('manifest');
 if(!Number.isFinite(Date.parse(manifest.createdAt))||Math.abs(Date.now()-Date.parse(manifest.createdAt))>86400000)fail('expired');
 const seen=new Set();for(const row of manifest.files){if(!allowedPath(row.path)||seen.has(row.path))fail('scope');seen.add(row.path);}
 const parent=await fs.realpath(path.dirname(journalPath));
 if(parent===manifest.root||parent.startsWith(manifest.root+path.sep))fail('journal_inside_store');
 const result={manifestSha256:digest,removed:[],removedLogicalBytes:0,completed:false};
 let lease,journal;
 const record=async row=>{await journal.writeFile(JSON.stringify({at:new Date().toISOString(),manifestSha256:digest,...row})+'\n');await journal.sync();await onJournal?.(row);};
 const sample=async()=>{const s=await statfs(root);return String(BigInt(s.bavail)*BigInt(s.bsize));};
 try {
  signal?.throwIfAborted();lease=await acquireLeases(root);journal=await fs.open(journalPath,'wx',0o600);
  const ph=await fs.open(parent,'r');try{await ph.sync();}finally{await ph.close();}
  await record({event:'start',manifest});result.availableBytesBefore=await sample();
  for(const row of manifest.files){signal?.throwIfAborted();if(JSON.stringify(await inspect(root,row.path))!==JSON.stringify(row))fail('source_changed');}
  await record({event:'preflight'});
  for(const row of manifest.files) {
   signal?.throwIfAborted();await lease.assertOwned();
   if(JSON.stringify(await inspect(root,row.path))!==JSON.stringify(row))fail('source_changed');
   await record({event:'unlink-intent',path:row.path});
   await lease.assertOwned();if(JSON.stringify(await inspect(root,row.path))!==JSON.stringify(row))fail('source_changed');signal?.throwIfAborted();
   await fs.unlink(path.join(root,row.path));result.removed.push(row.path);result.removedLogicalBytes+=row.size;
   const dh=await fs.open(path.dirname(path.join(root,row.path)),'r');try{await dh.sync();}finally{await dh.close();}
   await record({event:'unlinked',path:row.path});
  }
  result.availableBytesAfter=await sample();result.observedAvailableBytesDelta=String(BigInt(result.availableBytesAfter)-BigInt(result.availableBytesBefore));result.completed=true;
  await record({event:'completed',result});return result;
 }catch(e){if(journal)await record({event:'stopped',error:e.message,result}).catch(()=>{});e.cleanupResult=result;throw e;}
 finally{await journal?.close();await lease?.release();}
}
async function main(){
 const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){if(args[i]==='--apply')options.apply=true;else if(['--root','--manifest','--approve-sha256','--journal'].includes(args[i])&&args[i+1])options[args[i].slice(2)]=args[++i];else fail('arguments');}
 if(!options.root)fail('root_required');
 if(!options.apply){console.log(JSON.stringify(await planExcludedCleanup(options.root)));return;}
 if(!options.manifest||!options.journal)fail('manifest_journal_required');
 const controller=new AbortController();for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>controller.abort(Error('cancelled')));
 console.log(JSON.stringify(await applyExcludedCleanup({root:options.root,manifest:JSON.parse(await fs.readFile(options.manifest,'utf8')),approveSha256:options['approve-sha256'],journalPath:options.journal,signal:controller.signal})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({error:e.message,partial:e.cleanupResult}));process.exitCode=1;});

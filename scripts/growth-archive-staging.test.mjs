import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const script=path.resolve('scripts/growth-archive-offload-remote.sh');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'growth-staging-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const dir of ['2026-09-01-00','2026-09-02-00','2026-09-03-00'])fs.mkdirSync(path.join(root,'archive',dir),{recursive:true});
 fs.writeFileSync(path.join(root,'archive/2026-09-01-00/bilibili-valid.json.gz'),gzipSync('{"items":[]}'));
 const next=path.join(root,'backups/archive-offload/123-1.next');
 const env={...process.env,GROWTH_STORE_DIR:root,GROWTH_INTERACTIVE_FALLBACK_DIR:path.join(root,'unused')};
 return {root,next,env};
}
test('prepare保留未知或旧批次.next，不按同名目录删除',t=>{
 const f=fixture(t);fs.mkdirSync(f.next,{recursive:true});fs.writeFileSync(path.join(f.next,'evidence.json'),'preserve');
 const run=spawnSync('sh',[script,'prepare','123-1'],{env:f.env,encoding:'utf8'});
 assert.equal(run.status,65,run.stderr);assert.match(run.stderr,/临时目录已存在/);
 assert.equal(fs.readFileSync(path.join(f.next,'evidence.json'),'utf8'),'preserve');
 assert(!fs.existsSync(path.join(f.root,'.growth-platform-collection.lock')));
 assert(!fs.existsSync(path.join(f.root,'.growth-store-mutation.lock')));
});
test('prepare失败仅回收本轮带token的.next，不影响邻批或来源',t=>{
 const f=fixture(t),bin=path.join(f.root,'bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'node'),`#!${process.execPath}\nconst{spawnSync}=require('node:child_process');const a=process.argv.slice(2);if(a[0]==='-e'&&a[1].includes('report=process.argv[2]'))process.exit(70);const r=spawnSync(${JSON.stringify(process.execPath)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
 const neighbor=path.join(f.root,'backups/archive-offload/124-1.next');fs.mkdirSync(neighbor,{recursive:true});fs.writeFileSync(path.join(neighbor,'evidence'),'preserve');
 const run=spawnSync('sh',[script,'prepare','123-1'],{env:{...f.env,PATH:`${bin}:${f.env.PATH}`},encoding:'utf8'});
 assert.equal(run.status,70,run.stderr);assert(!fs.existsSync(f.next));
 assert.equal(fs.readFileSync(path.join(neighbor,'evidence'),'utf8'),'preserve');
 assert(fs.existsSync(path.join(f.root,'archive/2026-09-01-00/bilibili-valid.json.gz')));
 assert(!fs.existsSync(path.join(f.root,'.growth-platform-collection.lock')));
 assert(!fs.existsSync(path.join(f.root,'.growth-store-mutation.lock')));
});

test('损坏退役marker也隔离桶，不把剩余子集再次发布',t=>{
 const f=fixture(t),dir='2026-09-01-00';fs.mkdirSync(path.join(f.root,'.growth-archive-retired'));
 fs.writeFileSync(path.join(f.root,'.growth-archive-retired',dir+'.json'),'{broken');
 const run=spawnSync('sh',[script,'prepare','123-1'],{env:f.env,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.match(run.stderr,/retirement-marker-invalid/);
 assert(fs.existsSync(path.join(f.root,'archive',dir,'bilibili-valid.json.gz')));
 assert(!fs.existsSync(path.join(f.root,'backups/archive-offload/123-1/archive',dir)));
});

function addOldBucket(f,dir='2026-08-31-00') {
 fs.mkdirSync(path.join(f.root,'archive',dir));
 fs.writeFileSync(path.join(f.root,'archive',dir,'bilibili-valid.json.gz'),gzipSync('{"items":[]}'));
 return dir;
}
const prepare=(f,batch='123-1',probe)=>spawnSync('sh',[script,'prepare',batch,...(probe===undefined?[]:[probe])],{env:f.env,encoding:'utf8'});
test('显式probe在hash/link前缩到一桶，邻桶损坏也不读取',t=>{
 const f=fixture(t),other=addOldBucket(f),dir='2026-09-01-00';
 fs.writeFileSync(path.join(f.root,'archive',other,'bilibili-valid.json.gz'),'not-gzip');
 const run=prepare(f,'123-1',dir);assert.equal(run.status,0,run.stderr);
 const snapshot=path.join(f.root,'backups/archive-offload/123-1');
 assert.deepEqual(fs.readdirSync(path.join(snapshot,'inventories')),[dir+'.json']);
 assert.equal(run.stdout.trim().split('\n').length,1);assert(run.stdout.startsWith(dir+'\t'));
 assert.equal(fs.statSync(path.join(f.root,'archive',other,'bilibili-valid.json.gz')).nlink,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(snapshot,'.snapshot-owner.json'))).probeDir,dir);
});
test('probe不能选择最新两桶、缺失或非法路径且不留锁',t=>{
 const f=fixture(t);
 for(const dir of ['2026-09-02-00','2026-09-03-00','2026-08-30-00','../2026-09-01-00','2026-09-01-00\nother','2026-09-01-00\n']){
  const run=prepare(f,'123-1',dir);assert.notEqual(run.status,0,dir);assert.match(run.stderr,/archive_probe_directory_(?:invalid|not_eligible)/);
  assert(!fs.existsSync(f.next));assert(!fs.existsSync(path.join(f.root,'.growth-platform-collection.lock')));
 }
});
test('probe遇退役marker拒绝且不创建source inventory',t=>{
 const f=fixture(t),dir='2026-09-01-00';fs.mkdirSync(path.join(f.root,'.growth-archive-retired'));fs.writeFileSync(path.join(f.root,'.growth-archive-retired',dir+'.json'),'{broken');
 const run=prepare(f,'123-1',dir);assert.notEqual(run.status,0);assert.match(run.stderr,/archive_probe_directory_retired/);assert(!fs.existsSync(f.next));
 assert.equal(fs.statSync(path.join(f.root,'archive',dir,'bilibili-valid.json.gz')).nlink,1);
});
test('默认prepare保持全量安全候选；probe同batch重入不得切换范围',t=>{
 const f=fixture(t),other=addOldBucket(f),dir='2026-09-01-00';
 const full=prepare(f);assert.equal(full.status,0,full.stderr);assert.equal(full.stdout.trim().split('\n').length,2);
 const mismatch=prepare(f,'123-1',dir);assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/probe_scope_mismatch/);
 const same=prepare(f);assert.equal(same.status,0,same.stderr);assert.equal(same.stdout,full.stdout);
 const chosen=prepare(f,'124-1',dir);assert.equal(chosen.status,0,chosen.stderr);
 assert.equal(prepare(f,'124-1',dir).stdout,chosen.stdout);
 for(const probe of [undefined,other]){const bad=prepare(f,'124-1',probe);assert.notEqual(bad.status,0);assert.match(bad.stderr,/probe_scope_mismatch/);}
});
test('旧owner无probeDir仅兼容默认空范围',t=>{
 const f=fixture(t),run=prepare(f);assert.equal(run.status,0,run.stderr);
 const owner=path.join(f.root,'backups/archive-offload/123-1/.snapshot-owner.json'),json=JSON.parse(fs.readFileSync(owner));delete json.probeDir;fs.writeFileSync(owner,JSON.stringify(json));
 assert.equal(prepare(f).status,0);const rejected=prepare(f,'123-1','2026-09-01-00');assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/probe_scope_mismatch/);
});
test('workflow先校验单桶参数再传给远端prepare',()=>{
 const source=fs.readFileSync('.github/workflows/growth-archive-offload.yml','utf8');
 assert(source.indexOf('archive_probe_directory_invalid')<source.indexOf('sh -s -- prepare'));
 assert(source.includes("sh -s -- prepare '$BATCH_ID' '${GROWTH_ARCHIVE_PROBE_DIR:-}'"));
});

test('默认轮转跨两轮覆盖候选、环绕且同batch重入不推进游标',t=>{
 const f=fixture(t);for(let i=1;i<=14;i++){const dir=`2026-08-${String(i).padStart(2,'0')}-00`;fs.mkdirSync(path.join(f.root,'archive',dir));}
 const cursorFile=path.join(f.root,'backups/archive-offload/.rotation-cursor.json');
 const a=prepare(f,'201-1');assert.equal(a.status,0,a.stderr);const first=JSON.parse(fs.readFileSync(path.join(f.root,'backups/archive-offload/201-1/rotation.json')));assert.equal(first.scannedCount,12);assert.equal(first.deferred.length,3);
 const saved=fs.readFileSync(cursorFile,'utf8');assert.equal(prepare(f,'201-1').status,0);assert.equal(fs.readFileSync(cursorFile,'utf8'),saved);
 const b=prepare(f,'202-1');assert.equal(b.status,0,b.stderr);const second=JSON.parse(fs.readFileSync(path.join(f.root,'backups/archive-offload/202-1/rotation.json')));assert.equal(second.scannedCount,12);assert.equal(second.cursorBefore,first.cursorAfter);assert(second.cursorAfter<first.cursorAfter);
 const union=new Set([...fs.readdirSync(path.join(f.root,'backups/archive-offload/201-1/inventories')),...fs.readdirSync(path.join(f.root,'backups/archive-offload/202-1/inventories'))]);assert.equal(union.size,15);
 assert(![...union].some(d=>d.startsWith('2026-09-02')||d.startsWith('2026-09-03')));
 const beforeProbe=fs.readFileSync(cursorFile,'utf8');assert.equal(prepare(f,'203-1','2026-09-01-00').status,0);assert.equal(fs.readFileSync(cursorFile,'utf8'),beforeProbe);
});
test('超大桶显式延后并推进、失败快照不提交游标',t=>{
 const f=fixture(t),old=addOldBucket(f),huge=path.join(f.root,'archive',old,'bilibili-valid.json.gz');fs.truncateSync(huge,513*1024*1024);
 const run=prepare(f,'210-1');assert.equal(run.status,0,run.stderr);const report=JSON.parse(spawnSync('sh',[script,'report','210-1'],{env:f.env,encoding:'utf8'}).stdout);assert.equal(report.rotation.oversized[0].dir,old);assert(report.deferred.some(r=>r.dir===old&&r.reason==='oversized'));assert(report.rotation.estimatedBytes<=512*1024*1024);assert(!fs.existsSync(path.join(f.root,'backups/archive-offload/210-1',old)));
 const cursor=path.join(f.root,'backups/archive-offload/.rotation-cursor.json'),saved=fs.readFileSync(cursor,'utf8'),bin=path.join(f.root,'failbin');fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'node'),`#!${process.execPath}\nconst{spawnSync}=require('child_process');const a=process.argv.slice(2);if(a[0]==='-e'&&a[1].includes('report=process.argv[2]'))process.exit(70);const r=spawnSync(${JSON.stringify(process.execPath)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
 const bad=prepare({...f,env:{...f.env,PATH:bin+':'+f.env.PATH}},'211-1');assert.equal(bad.status,70,bad.stderr);assert.equal(fs.readFileSync(cursor,'utf8'),saved);
});
test('plan保留未扫描deferred且remaining零不代表无积压',async t=>{
 const {writeArchivePlan}=await import('./growth-archive-plan.mjs');const f=fixture(t);fs.writeFileSync(path.join(f.root,'source-inventory.json'),JSON.stringify({deferred:[{dir:'2026-08-01',reason:'rotation-budget'}]}));
 writeArchivePlan(f.root,{selected:[],reclaim:[],reusedCleanup:[],remaining:0,reused:0});const p=JSON.parse(fs.readFileSync(path.join(f.root,'plan.json')));assert.equal(p.deferredCount,1);assert.equal(p.pendingOutsideBatch,1);assert.equal(p.remaining,0);
});
test('全超大批次仍报告deferred并推进游标，不声称无积压',t=>{
 const f=fixture(t),dir='2026-09-01-00';fs.truncateSync(path.join(f.root,'archive',dir,'bilibili-valid.json.gz'),513*1024*1024);
 const run=prepare(f,'220-1');assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'');assert.match(run.stderr,/GROWTH_ARCHIVE_ROTATION.*"deferred":1/);assert.match(run.stderr,/GROWTH_ARCHIVE_DEFERRED.*oversized/);
 const c=JSON.parse(fs.readFileSync(path.join(f.root,'backups/archive-offload/.rotation-cursor.json')));assert.equal(c.lastDir,dir);
});

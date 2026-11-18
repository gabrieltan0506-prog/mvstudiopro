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

test('verified-archives退役marker合法：记为retired不要求人工复核，也不再发布',t=>{
 const f=fixture(t),dir='2026-09-01-00';fs.mkdirSync(path.join(f.root,'.growth-archive-retired'));
 for(const [platform,expected] of [['verified-archives','"state":"retired"'],['other','retirement-marker-invalid']]){
  fs.writeFileSync(path.join(f.root,'.growth-archive-retired',dir+'.json'),JSON.stringify({schemaVersion:1,dir,platform,receiptSha256:'a'.repeat(64),restore:{dir}}));
  const batch=platform==='other'?'125-1':'124-1',run=prepare(f,batch);assert.equal(run.status,0,run.stderr);assert(run.stderr.includes(expected),run.stderr);
  assert(!fs.existsSync(path.join(f.root,'backups/archive-offload',batch,dir)));
 }
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

const commit=(f,batch,list)=>spawnSync('sh',[script,'commit-cursor',batch,...(list===undefined?[]:[list])],{env:f.env,encoding:'utf8'});
const rotation=(f,batch)=>JSON.parse(fs.readFileSync(path.join(f.root,'backups/archive-offload',batch,'rotation.json')));
const readCursor=f=>JSON.parse(fs.readFileSync(path.join(f.root,'backups/archive-offload/.rotation-cursor.json')));
const selectedDirs=run=>run.stdout.trim().split('\n').filter(Boolean).map(l=>l.split('\t')[0]);
function addBuckets(f,n){const dirs=[];for(let i=1;i<=n;i++){const dir=`2026-08-${String(i).padStart(2,'0')}-00`;fs.mkdirSync(path.join(f.root,'archive',dir));fs.writeFileSync(path.join(f.root,'archive',dir,'bilibili-valid.json.gz'),gzipSync('{"items":[]}'));dirs.push(dir);}return dirs;}
test('默认轮转跨两轮覆盖候选、环绕且同batch重入不推进游标',t=>{
 const f=fixture(t);addBuckets(f,14);
 const cursorFile=path.join(f.root,'backups/archive-offload/.rotation-cursor.json');
 const a=prepare(f,'201-1');assert.equal(a.status,0,a.stderr);const first=rotation(f,'201-1');assert.equal(first.scannedCount,12);assert.equal(first.deferred.length,3);
 const saved=fs.readFileSync(cursorFile,'utf8');assert.equal(prepare(f,'201-1').status,0);assert.equal(fs.readFileSync(cursorFile,'utf8'),saved);
 // prepare 只登记 inflight，不推进；退役报告完成后才越过本班全部桶。
 assert.equal(readCursor(f).lastDir,null);assert.deepEqual(readCursor(f).inflight.visited,selectedDirs(a));
 const c1=commit(f,'201-1',selectedDirs(a).join(','));assert.equal(c1.status,0,c1.stderr);const afterFirst=readCursor(f).lastDir;assert.equal(afterFirst,selectedDirs(a).at(-1));assert.equal(readCursor(f).inflight,null);
 const b=prepare(f,'202-1');assert.equal(b.status,0,b.stderr);const second=rotation(f,'202-1');assert.equal(second.scannedCount,12);assert.equal(second.cursorBefore,afterFirst);
 assert.equal(commit(f,'202-1',selectedDirs(b).join(',')).status,0);assert(readCursor(f).lastDir<afterFirst);
 const union=new Set([...fs.readdirSync(path.join(f.root,'backups/archive-offload/201-1/inventories')),...fs.readdirSync(path.join(f.root,'backups/archive-offload/202-1/inventories'))]);assert.equal(union.size,15);
 assert(![...union].some(d=>d.startsWith('2026-09-02')||d.startsWith('2026-09-03')));
 const beforeProbe=fs.readFileSync(cursorFile,'utf8');assert.equal(prepare(f,'203-1','2026-09-01-00').status,0);assert.equal(fs.readFileSync(cursorFile,'utf8'),beforeProbe);
});
test('退役跳过/延后/失败（commit 未报告完成）不推进游标，下班重选同一批',t=>{
 const f=fixture(t);addBuckets(f,14);
 const a=prepare(f,'301-1');assert.equal(a.status,0,a.stderr);const first=selectedDirs(a);
 const c=commit(f,'301-1','');assert.equal(c.status,0,c.stderr);assert.match(c.stderr,/"committed":true.*"passed":0/);
 const cur=readCursor(f);assert.equal(cur.lastDir,null);for(const d of first)assert.equal(cur.attempts[d],1);
 const b=prepare(f,'302-1');assert.equal(b.status,0,b.stderr);assert.deepEqual(selectedDirs(b),first);
 // 部分完成：只越过连续完成前缀，停在第一个未完成桶之前。
 const done=first.filter((_,i)=>i!==3);assert.equal(commit(f,'302-1',done.join(',')).status,0);
 const cur2=readCursor(f);assert.equal(cur2.lastDir,first[2]);assert.equal(cur2.attempts[first[3]],2);assert.equal(cur2.attempts[first[0]],undefined);
 const next=prepare(f,'303-1');assert.equal(next.status,0,next.stderr);assert.equal(selectedDirs(next)[0],first[3]);
});
test('未调用commit的上一班在下一次prepare按失败结算并计尝试',t=>{
 const f=fixture(t);addBuckets(f,2);
 assert.equal(prepare(f,'311-1').status,0);const b=prepare(f,'312-1');assert.equal(b.status,0,b.stderr);assert.match(b.stderr,/"staleShiftSettled":\{"passed":0,"retry":3\}/);
 const cur=readCursor(f);assert.equal(cur.lastDir,null);assert.equal(cur.attempts['2026-08-01-00'],1);assert.equal(cur.inflight.batchId,'312-1');
 // 迟到的旧批次commit不能改写新inflight。
 const late=commit(f,'311-1','2026-08-01-00');assert.equal(late.status,0);assert.match(late.stderr,/no-inflight-for-batch/);assert.equal(readCursor(f).inflight.batchId,'312-1');
});
test('坏桶最多卡3班，之后放行但保留待重试记录，下一圈重试并在完成后清除',t=>{
 const f=fixture(t),dirs=addBuckets(f,2),bad=dirs[0];
 for(let i=1;i<=3;i++){const run=prepare(f,`32${i}-1`);assert.equal(run.status,0,run.stderr);assert.equal(selectedDirs(run)[0],bad);assert.equal(commit(f,`32${i}-1`,selectedDirs(run).filter(d=>d!==bad).join(',')).status,0);}
 const cur=readCursor(f);assert.equal(cur.attempts[bad],3);assert.equal(cur.lastDir,'2026-09-01-00');
 const lap=prepare(f,'324-1');assert.equal(lap.status,0,lap.stderr);assert.deepEqual(selectedDirs(lap),[bad,dirs[1],'2026-09-01-00']);
 assert.equal(commit(f,'324-1',bad).status,0);const cleared=readCursor(f);assert.equal(cleared.attempts[bad],undefined);assert.equal(cleared.lastDir,bad);
});
test('已退役桶不占12桶额度，commit未报告也可越过；损坏cursor或非法完成列表拒绝且不改游标',t=>{
 const f=fixture(t),dirs=addBuckets(f,14);fs.mkdirSync(path.join(f.root,'.growth-archive-retired'));
 for(const d of dirs.slice(0,5))fs.writeFileSync(path.join(f.root,'.growth-archive-retired',d+'.json'),'{}');
 const run=prepare(f,'331-1');assert.equal(run.status,0,run.stderr);const r=rotation(f,'331-1');
 assert.equal(r.retiredCount,5);assert.equal(r.nonemptyVisited,10);assert.equal(r.deferred.length,0);
 assert.equal(fs.readFileSync(path.join(f.root,'backups/archive-offload/331-1/retired.jsonl'),'utf8').trim().split('\n').length,5);
 assert.equal(commit(f,'331-1','').status,0);assert.equal(readCursor(f).lastDir,dirs[4]);
 const saved=fs.readFileSync(path.join(f.root,'backups/archive-offload/.rotation-cursor.json'),'utf8');
 assert.notEqual(commit(f,'331-1','../x').status,0);assert.equal(fs.readFileSync(path.join(f.root,'backups/archive-offload/.rotation-cursor.json'),'utf8'),saved);
});
test('schemaVersion 1 旧游标兼容读取并从其后续接',t=>{
 const f=fixture(t),dirs=addBuckets(f,3);fs.mkdirSync(path.join(f.root,'backups/archive-offload'),{recursive:true});
 fs.writeFileSync(path.join(f.root,'backups/archive-offload/.rotation-cursor.json'),JSON.stringify({schemaVersion:1,batchId:'1-1',lastDir:dirs[0]}));
 const run=prepare(f,'341-1');assert.equal(run.status,0,run.stderr);assert.equal(selectedDirs(run)[0],dirs[1]);assert.equal(readCursor(f).schemaVersion,2);
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
 assert.equal(commit(f,'220-1','').status,0);const c=readCursor(f);assert.equal(c.lastDir,dir);assert.equal(c.attempts[dir],3);
});


test('空目录不耗尽内容额度，零字节损坏文件仍保留并报告',t=>{
 const f=fixture(t);for(let i=1;i<=20;i++)fs.mkdirSync(path.join(f.root,'archive',`2026-08-${String(i).padStart(2,'0')}-00`));
 const bad='2026-08-21-00';fs.mkdirSync(path.join(f.root,'archive',bad));fs.writeFileSync(path.join(f.root,'archive',bad,'bilibili-empty.json.gz'),'');
 const run=prepare(f,'230-1');assert.equal(run.status,0,run.stderr);
 const root=path.join(f.root,'backups/archive-offload/230-1'),r=JSON.parse(fs.readFileSync(path.join(root,'rotation.json')));
 assert.equal(r.emptyCount,20);assert.equal(r.nonemptyVisited,2);assert.equal(r.scannedCount,22);assert.equal(r.deferred.length,0);
 assert.match(run.stdout,/2026-09-01-00/);assert(fs.readFileSync(path.join(root,'anomalies.jsonl'),'utf8').includes(bad));
 assert(fs.existsSync(path.join(f.root,'archive',bad,'bilibili-empty.json.gz')));assert(fs.existsSync(path.join(f.root,'archive','2026-08-01-00')));
});

test('空目录metadata扫描仍有4096上限且下一轮到达有效桶',t=>{
 const f=fixture(t);for(let i=0;i<4097;i++){const dir=new Date(Date.UTC(2000,0,1+i)).toISOString().slice(0,10);fs.mkdirSync(path.join(f.root,'archive',dir));}
 const a=prepare(f,'240-1');assert.equal(a.status,0,a.stderr);const r=JSON.parse(fs.readFileSync(path.join(f.root,'backups/archive-offload/240-1/rotation.json')));assert.equal(r.scannedCount,4096);assert.equal(r.emptyCount,4096);assert.equal(r.selectedCount,0);assert.equal(r.deferred.length,2);
 const b=prepare(f,'241-1');assert.equal(b.status,0,b.stderr);assert.match(b.stdout,/2026-09-01-00/);
});

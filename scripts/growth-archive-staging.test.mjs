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

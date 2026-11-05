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

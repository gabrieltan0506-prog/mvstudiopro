import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planExcludedCleanup,applyExcludedCleanup,manifestSha256,allowedPath} from './growth-excluded-platform-cleanup.mjs';
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'excluded-cleanup-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const root=path.join(base,'store');
 const files=['archive/2026-01-01/kuaishou-foo.json.gz','archive/2026-01-01/toutiao-bar.json.gz','platforms/kuaishou.json','history-ledger/toutiao.json.gz','platform-current/kuaishou.current.json','archive/2026-01-01/bilibili-keep.json.gz','backups/kuaishou.json','history-ledger/index.json','platforms/douyin.json'];
 for(const name of files){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'payload:'+name);}
 return {root,base,files,journalPath:path.join(base,'journal.jsonl')};}
async function opts(f){const p=await planExcludedCleanup(f.root);return {root:f.root,manifest:p.manifest,approveSha256:p.manifestSha256,journalPath:f.journalPath};}
test('dryrun仅5个精确退出平台文件且零删除；apply保留5平台、共享账本与备份',async t=>{const f=fixture(t),o=await opts(f);assert.equal(o.manifest.files.length,5);assert(f.files.every(p=>fs.existsSync(path.join(f.root,p))));let n=0;
 const r=await applyExcludedCleanup({...o,statfs:async()=>({bsize:4096n,bavail:BigInt(++n===1?10:11)})});assert.equal(r.completed,true);assert.equal(r.removed.length,5);assert.equal(r.observedAvailableBytesDelta,'4096');
 for(const p of f.files.slice(5))assert(fs.existsSync(path.join(f.root,p)));assert(fs.existsSync(path.join(f.root,'archive/2026-01-01')));assert.match(fs.readFileSync(f.journalPath,'utf8'),/completed/);});
test('错误SHA与伪造五平台文件不能删',async t=>{const f=fixture(t),o=await opts(f);await assert.rejects(applyExcludedCleanup({...o,approveSha256:'x'}),/approval/);o.manifest.files[0].path='platforms/bilibili.json';o.approveSha256=manifestSha256(o.manifest);await assert.rejects(applyExcludedCleanup(o),/scope/);assert(f.files.every(p=>fs.existsSync(path.join(f.root,p))));});
test('任一来源变化时全量预检阻止所有删除',async t=>{const f=fixture(t),o=await opts(f);fs.appendFileSync(path.join(f.root,o.manifest.files.at(-1).path),'changed');await assert.rejects(applyExcludedCleanup(o),/source_changed/);assert(f.files.every(p=>fs.existsSync(path.join(f.root,p))));});
test('intent后取消不得删除，journal和来源保留',async t=>{const f=fixture(t),o=await opts(f),c=new AbortController();await assert.rejects(applyExcludedCleanup({...o,signal:c.signal,onJournal:e=>{if(e.event==='unlink-intent')c.abort(Error('cancel'));}}),/cancel/);assert(f.files.every(p=>fs.existsSync(path.join(f.root,p))));assert.match(fs.readFileSync(f.journalPath,'utf8'),/stopped/);});
test('既有锁不得覆盖或清除',async t=>{const f=fixture(t),o=await opts(f);const lock=path.join(f.root,'.growth-platform-collection.lock');fs.writeFileSync(lock,'owner');await assert.rejects(applyExcludedCleanup(o),/busy/);assert.equal(fs.readFileSync(lock,'utf8'),'owner');});
test('符号链接来源及目录不进入删除清单',async t=>{const f=fixture(t);const target=path.join(f.root,f.files[0]);fs.unlinkSync(target);fs.symlinkSync(path.join(f.root,f.files[5]),target);await assert.rejects(planExcludedCleanup(f.root),/file/);assert(fs.existsSync(path.join(f.root,f.files[5])));});
test('持久journal不能覆盖旧证据或写进store',async t=>{const f=fixture(t),o=await opts(f);fs.writeFileSync(f.journalPath,'old');await assert.rejects(applyExcludedCleanup(o),/EEXIST/);assert.equal(fs.readFileSync(f.journalPath,'utf8'),'old');await assert.rejects(applyExcludedCleanup({...o,journalPath:path.join(f.root,'receipt')}),/inside_store/);});
test('范围拒绝含糊名称、嵌套、共享索引',()=>{for(const p of ['archive/2026-01-01/my-kuaishou.json.gz','archive/2026-01-01/kuaishou/a.json.gz','platforms/kuaishou-extra.json','history-ledger/index.json','../kuaishou.json','backups/kuaishou.json'])assert.equal(allowedPath(p),false,p);});
test('删除前锁被替换必须停止且保留新锁',async t=>{const f=fixture(t),o=await opts(f),lock=path.join(f.root,'.growth-store-mutation.lock');await assert.rejects(applyExcludedCleanup({...o,onJournal:e=>{if(e.event==='unlink-intent'){fs.unlinkSync(lock);fs.writeFileSync(lock,'new-owner');}}}),/lease_lost/);assert.equal(fs.readFileSync(lock,'utf8'),'new-owner');assert(f.files.every(p=>fs.existsSync(path.join(f.root,p))));});
test('盘点新增真实路径匹配，历史writeback只删同平台叶子',async t=>{
 const f=fixture(t);
 const extra=['platforms/._kuaishou.json','platforms.prev/kuaishou.json','platforms.prev/kuaishou/kuaishou_feed.json','restore-temp/writeback-20260322T172340/platforms/toutiao/toutiao_video_feed.json','restore-temp/writeback-20260322T172340/platforms/toutiao.json'];
 const keep=['platforms.prev/kuaishou/douyin_feed.json','restore-temp/writeback-20260322T172340/platforms/toutiao/kuaishou_feed.json','restore-temp/random/platforms/kuaishou.json'];
 for(const name of [...extra,...keep]){fs.mkdirSync(path.dirname(path.join(f.root,name)),{recursive:true});fs.writeFileSync(path.join(f.root,name),'data');}
 const o=await opts(f);assert.equal(o.manifest.files.length,10);await applyExcludedCleanup(o);
 for(const name of extra)assert(!fs.existsSync(path.join(f.root,name)));for(const name of keep)assert(fs.existsSync(path.join(f.root,name)));
});

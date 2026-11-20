import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const files=['growth-backup.yml','growth-archive-offload.yml'];
// 2026-11-18 授权后步骤改名并改用 verified-archives；集成方改 YAML 前旧 B站 步骤仍合法。
const retireStep=source=>source.includes('      - name: Retire verified archive sources\n')?'Retire verified archive sources':'Retire verified Bilibili archive sources';
function step(source,name){
 const block=source.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
 assert(block,name);return block.split('        run: |\n')[1].replace(/^ {10}/gm,'');
}
function fixture(t,name){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'growth-retire-wiring-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=path.join(root,'runner'),bin=path.join(root,'bin'),capture=path.join(root,'capture.json'),summary=path.join(root,'summary.md');
 fs.mkdirSync(path.join(store,'assets'),{recursive:true});fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'timeout'),'#!/bin/sh\nshift\nshift\nexec "$@"\n',{mode:0o755});
 fs.writeFileSync(path.join(bin,'flyctl'),`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2),input=fs.readFileSync(0,'utf8');
fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args,input}));
if(process.env.OLD_IMAGE==='1'&&args.at(-1).includes('--scope=verified-archives')){console.error(JSON.stringify({error:'Usage: growth-archive-retire.mjs --scope=bilibili-archives --allow-remote-download < metadata.json'}));process.exit(1);}
const countFile=process.env.CAPTURE+'.calls';
const count=fs.existsSync(countFile)?Number(fs.readFileSync(countFile)):0;
fs.writeFileSync(countFile,String(count+1));
if(process.env.BUSY==='1'||(process.env.BUSY==='once'&&count===0)){
 console.error('Connecting to fdaa:50::2...');
 console.error(JSON.stringify({error:'growth_cleanup_busy',partial:{candidates:61,completed:false,removed:[],removedLogicalBytes:0},buckets:[{state:'failed',retirementCompleted:false,removedFiles:0,removedLogicalBytes:0}]}));
 console.error('Error: ssh shell: Process exited with status 1');
 process.exit(1);
}
process.stdout.write(JSON.stringify({completed:process.env.FAIL!=='1',removed:2,actualFreeBytesDelta:4096})+'\\n');
process.exit(process.env.FAIL==='1'?23:0);
`,{mode:0o755});
 const source=fs.readFileSync(`.github/workflows/${name}`,'utf8');
 const env={...process.env,PATH:`${bin}:${process.env.PATH}`,CAPTURE:capture,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'4',FLY_MACHINE_ID:'selected-app',GITHUB_STEP_SUMMARY:summary};
 const run=(label=retireStep(source),extra={})=>spawnSync('bash',['-euo','pipefail','-c',step(source,label).replaceAll('/tmp/growth-archive-offload',store)],{env:{...env,...extra},encoding:'utf8'});
 const dir='2026-10-01-00',batchId=name==='growth-backup.yml'?'123-4-backup':'123-4';
 const batch={schemaVersion:3,batchId,archives:[{dir,releaseTag:'growth-archive-2026-10-01'}]};
 const publication={schemaVersion:1,batchId,uploaded:[{dir,releaseTag:'growth-archive-2026-10-01'}]};
 const manifest={schemaVersion:1,dir,archive:{assetName:`archive-${dir}.tar.gz`,bytes:42,sha256:'a'.repeat(64)},parts:[],inventory:[]};
 const seed=()=>{
  fs.writeFileSync(path.join(store,'offload-manifest.json'),JSON.stringify(batch));
  fs.writeFileSync(path.join(store,'publication-result.json'),JSON.stringify(publication));
  fs.writeFileSync(path.join(store,'assets',`archive-${dir}.manifest.json`),JSON.stringify(manifest));
  fs.writeFileSync(path.join(store,'batch-id.txt'),batchId);fs.writeFileSync(path.join(store,'SNAPSHOT_RELEASED'),'');
 };
 return{root,store,source,capture,summary,run,seed,batch,publication,manifest,dir};
}
test('单桶任务（archive_dir=A）不触发其他历史桶的正式删源：步骤条件与脚本内双重拦截',t=>{
 const f=fixture(t,'growth-archive-offload.yml'),label='Retire remaining sources of Bilibili-retired archive buckets';
 const block=f.source.split(`      - name: ${label}\n`)[1].split('\n      - ')[0];
 assert.match(block,/if: \$\{\{ success\(\) && \(inputs\.archive_dir \|\| ''\) == '' \}\}/);
 const probe=f.run(label,{GROWTH_ARCHIVE_PROBE_DIR:'2026-10-01-00'});
 assert.equal(probe.status,0,probe.stderr);assert(!fs.existsSync(f.capture),'单桶任务不得调用 Fly');
 assert(!fs.existsSync(path.join(f.store,'retirement-request-legacy.json')));
 const scheduled=f.run(label,{GROWTH_ARCHIVE_PROBE_DIR:''});
 assert(fs.existsSync(f.capture),scheduled.stderr);
 assert.match(JSON.parse(fs.readFileSync(f.capture)).args.at(-1),/--legacy-retired-markers/);
});
for(const name of files){
 test(`${name}: 成功发布且释放快照后只传本批metadata到指定Fly机器`,t=>{
  const f=fixture(t,name);f.seed();
  const idx=f.source.indexOf(`- name: ${retireStep(f.source)}`);
  assert(idx>f.source.indexOf('- name: Always release archive hardlink snapshot'));
  if(name==='growth-backup.yml')assert(idx>f.source.indexOf('- name: Always release owned current snapshot'));
  // 允许带 BACKUP_DEFERRED 让路守卫的写法：if: ${{ success() && env.BACKUP_DEFERRED != 'true' }}
  assert.match(f.source.slice(idx),/if: (?:\$\{\{ )?success\(\)/);
  const r=f.run();assert.equal(r.status,0,r.stderr);
  const captured=JSON.parse(fs.readFileSync(f.capture));
  assert(captured.args.includes('selected-app'));
  assert.match(captured.args.at(-1),/node scripts\/growth-archive-retire.mjs --scope=(?:verified|bilibili)-archives --allow-remote-download/);
  assert.doesNotMatch(captured.args.join(' '),/machine start|sftp|curl|gh release/);
  assert.deepEqual(JSON.parse(captured.input),{batch:f.batch,publication:f.publication,manifests:{[`archive-${f.dir}.manifest.json`]:Buffer.from(JSON.stringify(f.manifest)).toString("base64")}});
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.store,'retirement-result-new.json'))).actualFreeBytesDelta,4096);
  assert(fs.readFileSync(f.summary,'utf8').includes('逐文件清理已执行'));
 });
 test(`${name}: 线上仍是旧版本时退回只退役B站，不因部署顺序失败`,t=>{
  const f=fixture(t,name);f.seed();
  const r=f.run(undefined,{OLD_IMAGE:'1'});assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/本轮按旧范围只退役 B站/);
  assert.match(JSON.parse(fs.readFileSync(f.capture)).args.at(-1),/--scope=bilibili-archives --allow-remote-download/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.store,'retirement-result-new.json'))).actualFreeBytesDelta,4096);
 });
 test(`${name}: 无发布回执或快照未释放不调用清理`,t=>{
  const f=fixture(t,name);assert.equal(f.run().status,0);assert(!fs.existsSync(f.capture));
  f.seed();fs.unlinkSync(path.join(f.store,'SNAPSHOT_RELEASED'));
  assert.equal(f.run().status,0);assert(!fs.existsSync(f.capture));
 });
 test(`${name}: 跨批回执拒绝且远端失败不伪报成功`,t=>{
  const f=fixture(t,name);f.seed();
  fs.writeFileSync(path.join(f.store,'publication-result.json'),JSON.stringify({...f.publication,batchId:'other-batch'}));
  assert.notEqual(f.run().status,0);assert(!fs.existsSync(f.capture));
  f.seed();const result=f.run(undefined,{FAIL:'1'});assert.notEqual(result.status,0);
  assert(fs.existsSync(path.join(f.store,'retirement-result-new.json')));assert(!fs.existsSync(f.summary));
 });
 test(`${name}: 没有新上传时仍清理已备份复用包`,t=>{
  const f=fixture(t,name);f.seed();fs.unlinkSync(path.join(f.store,'publication-result.json'));
  fs.writeFileSync(path.join(f.store,'UPLOAD_EMPTY'),'');
  const payload={batch:f.batch,publication:{batchId:f.batch.batchId,reused:f.publication.uploaded},manifests:{[`archive-${f.dir}.manifest.json`]:Buffer.from(JSON.stringify(f.manifest,null,2)).toString('base64')}};
  fs.writeFileSync(path.join(f.store,'reused-cleanup-input.json'),JSON.stringify(payload));
  const r=f.run(undefined,{BUSY:'once',GROWTH_RETIRE_BUSY_WAIT_SECONDS:'0'});assert.equal(r.status,0,r.stderr);
  assert.equal(fs.readFileSync(f.capture+'.calls','utf8'),'2');
  assert(!fs.existsSync(path.join(f.store,'RETIREMENT_DEFERRED_reused')));
  const captured=JSON.parse(fs.readFileSync(f.capture));assert.deepEqual(JSON.parse(captured.input),payload);
  assert(fs.existsSync(path.join(f.store,'retirement-result-reused.json')));
 });
 test(`${name}: 服务端采集锁 growth_cleanup_busy 只重试后延后，不红掉也不删来源`,t=>{
  const f=fixture(t,name);f.seed();
  const r=f.run(undefined,{BUSY:'1',GROWTH_RETIRE_BUSY_ATTEMPTS:'2',GROWTH_RETIRE_BUSY_WAIT_SECONDS:'0'});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/第 1 次遇到 growth_cleanup_busy/);
  assert(fs.existsSync(path.join(f.store,'RETIREMENT_DEFERRED_new')));
  assert.equal(fs.readFileSync(f.capture+'.calls','utf8'),'2');
  assert.equal(fs.readFileSync(path.join(f.store,'retirement-result-new.json'),'utf8'),'');
  assert(fs.readFileSync(f.summary,'utf8').includes('延后'));
  assert(!fs.readFileSync(f.summary,'utf8').includes('逐文件清理已执行'));
  const cursor=f.run('Commit archive rotation cursor');assert.equal(cursor.status,0,cursor.stderr);
  assert.match(JSON.parse(fs.readFileSync(f.capture)).args.at(-1),/commit-cursor '[^']+' ''$/);
 });
 test(`${name}: 仅快照清理成功才建立释放标记`,t=>{
  const f=fixture(t,name);f.seed();fs.unlinkSync(path.join(f.store,'SNAPSHOT_RELEASED'));
  // 1118：释放步骤改为重试；失败 shim 下不等待，只验证最终保留标记。
  const failed=f.run('Always release archive hardlink snapshot',{FAIL:'1',GROWTH_SNAPSHOT_RELEASE_ATTEMPTS:'2',GROWTH_SNAPSHOT_RELEASE_WAIT_SECONDS:'0'});
  assert.equal(failed.status,0,failed.stderr);
  assert(!fs.existsSync(path.join(f.store,'SNAPSHOT_RELEASED')));
  assert(fs.existsSync(path.join(f.store,'SNAPSHOT_RETAINED')));
  assert.match(failed.stdout,/（2\/2）/);
  fs.unlinkSync(path.join(f.store,'SNAPSHOT_RETAINED'));
  assert.equal(f.run('Always release archive hardlink snapshot').status,0);
  assert(fs.existsSync(path.join(f.store,'SNAPSHOT_RELEASED')));
  assert(!fs.existsSync(path.join(f.store,'SNAPSHOT_RETAINED')));
 });
}

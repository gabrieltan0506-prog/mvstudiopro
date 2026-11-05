import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {executeBackupRequest} from './growth-backup-fly-gateway.mjs';
import {decodeBackupCommand,runBackupViaFly} from './growth-backup-fly-client.mjs';
const repository='test-owner/private-backup',env={FLY_APP_NAME:'test',GROWTH_BACKUP_REPOSITORY:repository,GROWTH_BACKUP_GITHUB_TOKEN:'test-key'};
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture({isPrivate=true,existing=[]}={}) {
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url,init});assert.equal(init.headers.Authorization,'Bearer test-key');
  if(url===`https://api.github.com/repos/${repository}`)return Response.json({full_name:repository,private:isPrivate});
  if(url.includes('/releases/tags/'))return Response.json({id:1,tag_name:'growth-archive-test'});
  if(url.includes('/assets?per_page'))return Response.json(existing);
  if(init.method==='DELETE')return new Response(null,{status:204});
  if(url.startsWith('https://uploads.github.com/')){const b=[];for await(const c of init.body)b.push(c);const raw=Buffer.concat(b);return Response.json({name:new URL(url).searchParams.get('name'),size:raw.length,digest:`sha256:${hash(raw)}`,state:'uploaded'});}
  if(init.method==='POST')return Response.json({id:1});
  if(url.includes('/releases?'))return Response.json([{id:1}]);
  throw Error('unexpected test url '+url);
 };return {calls,fetchImpl};
}
test('没有Fly服务端令牌时零网络失败',async()=>{let n=0;await assert.rejects(executeBackupRequest({repository,operation:'repo'},{env:{},fetchImpl:()=>n++}),/credentials/);assert.equal(n,0);});
test('公开仓拒绝写入；跨仓请求零网络拒绝',async()=>{const f=fixture({isPrivate:false});await assert.rejects(executeBackupRequest({repository,operation:'create',tag:'growth-archive-test',title:'t',notes:''},{env,...f}),/private_repository/);assert.equal(f.calls.length,1);await assert.rejects(executeBackupRequest({repository:'other/repo',operation:'repo'},{env,...f}),/credentials/);assert.equal(f.calls.length,1);});
test('metadata分页返回gh兼容结构',async()=>{const f=fixture();assert.deepEqual(await executeBackupRequest({repository,operation:'api',endpoint:`repos/${repository}/releases?per_page=100`,paginate:true},{env,...f}),[[{id:1}]]);});
test('任意API或删除普通附件被拒绝',async()=>{const f=fixture();await assert.rejects(executeBackupRequest({repository,operation:'api',endpoint:`repos/${repository}/issues`},{env,...f}),/scope/);await assert.rejects(executeBackupRequest({repository,operation:'upload',name:'archive.tar.gz',bytes:1,sha256:hash('x'),replace:true},{env,...f}),/upload_invalid/);assert(f.calls.every(c=>!c.init.method));});
test('真实流上传先校验内容，坏流零写入',async()=>{const f=fixture(),raw=Buffer.from('synthetic archive content'),r={repository,operation:'upload',tag:'growth-archive-test',name:'archive.tar.gz',bytes:raw.length,sha256:hash(raw)};const result=await executeBackupRequest(r,{env,...f,input:Readable.from([raw])});assert.equal(result.digest,`sha256:${hash(raw)}`);const g=fixture();await assert.rejects(executeBackupRequest(r,{env,...g,input:Readable.from([Buffer.alloc(raw.length)])}),/digest/);assert(g.calls.every(c=>!c.init.method));});
test('同名普通附件不覆盖，指针校验后才替换',async()=>{const raw=Buffer.from('{}'),f=fixture({existing:[{id:9,name:'growth-backup-latest.json'}]});await executeBackupRequest({repository,operation:'upload',tag:'growth-archive-test',name:'growth-backup-latest.json',label:'generation:1-1',bytes:2,sha256:hash(raw),replace:true},{env,...f,input:Readable.from([raw])});assert.equal(f.calls.filter(c=>c.init.method==='DELETE').length,1);const g=fixture({existing:[{id:8,name:'archive.tar.gz'}]});await assert.rejects(executeBackupRequest({repository,operation:'upload',tag:'growth-archive-test',name:'archive.tar.gz',bytes:2,sha256:hash(raw)},{env,...g,input:Readable.from([raw])}),/immutable_conflict/);});
test('客户端以文件fd传输；label不会被误当成资产名；不传GitHub令牌',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fly-client-test-'));try{const file=path.join(dir,'growth-backup-latest.json');fs.writeFileSync(file,'{}');const args=['release','upload','growth-archive-test',file+'#generation:1-1','--clobber','--repo',repository];assert.equal(decodeBackupCommand(args,repository).name,'growth-backup-latest.json');const result=runBackupViaFly(args,{env:{GROWTH_BACKUP_REPOSITORY:repository,FLY_MACHINE_ID:'abc123',FLY_API_TOKEN:'test-fly'},execute:(bin,argv,options)=>{assert.equal(bin,'flyctl');assert.equal(argv[argv.indexOf('--machine')+1],'abc123');assert.equal(typeof options.stdio[0],'number');assert(!JSON.stringify(argv).includes('test-key'));return '{}';}});assert.equal(result,'{}');}finally{fs.rmSync(dir,{recursive:true});}});
test('两workflow不再要求GitHub备份令牌复制到Actions',()=>{for(const name of ['growth-backup','growth-archive-offload']){const text=fs.readFileSync(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8');assert(!text.includes('secrets.GROWTH_BACKUP_GITHUB_TOKEN'));assert(text.includes('GROWTH_BACKUP_TRANSPORT: fly'));assert(text.indexOf('Resolve production app machine')<text.indexOf('Require authorized private backup target'));}});
test('直接本机GitHub令牌不能替代Fly转发',async()=>{const old=process.env.GH_TOKEN,route=process.env.GROWTH_BACKUP_TRANSPORT;try{process.env.GH_TOKEN='test-key';delete process.env.GROWTH_BACKUP_TRANSPORT;const {runBackupGh}=await import('./growth-backup-target.mjs');assert.throws(()=>runBackupGh(['repo','view',repository]),/server_transport_required/);}finally{if(old===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=old;if(route===undefined)delete process.env.GROWTH_BACKUP_TRANSPORT;else process.env.GROWTH_BACKUP_TRANSPORT=route;}});

test('最小实跑限定已筛选单桶，不能带入最新桶或路径穿越',async()=>{
 const {selectProbeSnapshot}=await import('./growth-archive-plan.mjs');
 const snapshot='2026-10-01-00\tabc\t12\n2026-10-02-00\tdef\t34\n';
 assert.equal(selectProbeSnapshot(snapshot,'2026-10-01-00'),'2026-10-01-00\tabc\t12\n');
 assert.equal(selectProbeSnapshot(snapshot,''),snapshot);
 assert.throws(()=>selectProbeSnapshot(snapshot,'2026-11-05-12'),/not_eligible/);
 assert.throws(()=>selectProbeSnapshot(snapshot,'../data'),/invalid/);
});
test('工作流env映射没有重复键',()=>{for(const name of ['growth-backup','growth-archive-offload']){const lines=fs.readFileSync(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8').split('\n');for(let i=0;i<lines.length;i++){const match=/^(\s*)env:\s*$/.exec(lines[i]);if(!match)continue;const keys=new Set();for(let j=i+1;j<lines.length;j++){if(!lines[j].trim())continue;const indentation=lines[j].match(/^\s*/)[0].length;if(indentation<=match[1].length)break;const key=/^\s*([A-Z_][A-Z_0-9]*):/.exec(lines[j])?.[1];if(key){assert(!keys.has(key),`${name}: duplicate ${key}`);keys.add(key);}}}}});
test('manifest跨域下载不携带GitHub凭证且校验原始字节',async()=>{
 const raw=Buffer.from('{"probe":"synthetic"}'),calls=[];
 const fetchImpl=async(url,init)=>{calls.push(url);
  if(url===`https://api.github.com/repos/${repository}`)return Response.json({full_name:repository,private:true});
  if(url.includes('/releases/tags/'))return Response.json({id:1,tag_name:'growth-archive-test'});
  if(url.includes('/assets?'))return Response.json([{id:2,name:'archive-2026-10-01-00.manifest.json',size:raw.length,digest:`sha256:${hash(raw)}`}]);
  if(url.endsWith('/assets/2'))return new Response(null,{status:302,headers:{location:'https://storage.example/probe'}});
  assert.equal(url,'https://storage.example/probe');assert.equal(init.headers.Authorization,undefined);return new Response(raw);
 };
 const result=await executeBackupRequest({repository,operation:'manifests',tag:'growth-archive-test'},{env,fetchImpl});
 assert.equal(Buffer.from(result[0].base64,'base64').toString(),raw.toString());assert.equal(calls.length,5);
});
test('release标签metadata读取保持协议兼容',async()=>{const f=fixture();const result=await executeBackupRequest({repository,operation:'api',endpoint:`repos/${repository}/releases/tags/growth-archive-test`},{env,...f});assert.equal(result.id,1);});

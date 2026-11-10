// runner 只转发数据；GitHub 凭证在指定 Fly 进程内使用，不进入 runner。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const source=()=>fs.readFileSync(new URL('./growth-backup-fly-gateway.mjs',import.meta.url),'utf8');
export function decodeBackupCommand(args,repository) {
 const request={repository},scoped=[...args];
 const flag=k=>{const i=scoped.indexOf(k);return i<0?undefined:scoped[i+1];};
 if(scoped[0]==='repo'&&scoped[1]==='view'&&scoped[2]===repository)return {...request,operation:'repo'};
 if(scoped[0]==='api'&&!scoped.includes('-X')&&!scoped.includes('--method'))return {...request,operation:'api',endpoint:scoped.at(-1),paginate:scoped.includes('--paginate')};
 if(scoped[0]!=='release'||flag('--repo')!==repository)throw Error('backup_fly_command_scope');
 request.tag=scoped[2];
 if(scoped[1]==='create')return {...request,operation:'create',title:flag('--title')||request.tag,notes:flag('--notes')||''};
 if(scoped[1]==='download'&&flag('--pattern')==='archive-*.manifest.json')return {...request,operation:'manifests',directory:flag('--dir')};
 if(scoped[1]==='upload') {
  const [file,label]=scoped[3].split('#');const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('backup_fly_upload_file');
  const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
  return {...request,operation:'upload',file,name:path.basename(file),label:label||'',bytes:st.size,sha256:hash.digest('hex'),replace:scoped.includes('--clobber')};
 }throw Error('backup_fly_command_invalid');
}
// 1110：Fly 接口偶发断线（如 `Error: get app: ... stream error ... INTERNAL_ERROR`）发生在 flyctl 连上机器之前，
// 远端命令根本没执行，重试安全；连上之后的失败一律不重试（避免重复写入），照旧整次判失败。
export const FLY_PRE_CONNECT_ERROR=/Error: (get app|get machine|failed to connect|could not (find|resolve|connect))|dial tcp|TLS handshake timeout|api\.machines\.dev/i;
export function isFlyPreConnectFailure(error){return error?.status!==undefined&&!/Connecting to /.test(String(error.stdout||'')+String(error.stderr||''))&&FLY_PRE_CONNECT_ERROR.test(String(error.stderr||''));}
const sleepSync=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
export function runBackupViaFly(args,{env=process.env,execute=execFileSync,attempts=3,backoffMs=20000,sleep=sleepSync}={}) {
 const repo=env.GROWTH_BACKUP_REPOSITORY||'gabrieltan0506-prog/mvstudiopro-growth-data';
 if(!/^[a-f0-9]+$/.test(env.FLY_MACHINE_ID||'')||!env.FLY_API_TOKEN)throw Error('backup_fly_target_required');
 const request=decodeBackupCommand(args,repo),{file,directory,...wire}=request;
 const moduleUrl='data:text/javascript;base64,'+Buffer.from(source()).toString('base64');
 const js=`import(${JSON.stringify(moduleUrl)}).then(m=>m.main(${JSON.stringify(wire)}))`;
 const encoded=Buffer.from(js).toString('base64');
 const command=`node --input-type=module -e 'eval(Buffer.from("${encoded}","base64").toString())'`;
 let fd;try {
  let raw;
  for(let attempt=1;;attempt++){
   if(file)fd=fs.openSync(file,'r');
   try{raw=execute('flyctl',['ssh','console','-a','mvstudiopro','--machine',env.FLY_MACHINE_ID,'-C',command],{env,encoding:'utf8',stdio:[fd??'ignore','pipe','pipe'],maxBuffer:32*1024*1024,timeout:600000});break;}
   catch(error){
    if(attempt>=attempts||!isFlyPreConnectFailure(error))throw error;
    process.stderr.write(`backup_fly_preconnect_retry:${attempt}/${attempts}:${String(error.stderr||'').trim().split('\n').pop().slice(0,200)}\n`);
    sleep(backoffMs*attempt);
   }finally{if(fd!==undefined){fs.closeSync(fd);fd=undefined;}}
  }
  const result=JSON.parse(raw);
  if(request.operation==='manifests') {
   for(const item of result){if(!/^archive-\d{4}-\d{2}-\d{2}(?:-\d{2})?\.manifest\.json$/.test(item.name))throw Error('backup_fly_manifest_name');fs.writeFileSync(path.join(directory,item.name),Buffer.from(item.base64,'base64'),{flag:'wx'});}return '';
  }return JSON.stringify(result);
 }catch(error){if(error.status!==undefined)throw Error(`backup_fly_command_failed:${String(error.stderr||'').slice(-1000)}`);throw error;}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}

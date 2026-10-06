import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fetchGrowthStatus} from '../../scripts/fetch-growth-status.mjs';
it('旧接口计数兼容，未就绪不能保存为成功快照',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'status-fetch-'));const out=path.join(dir,'out.json');
 try {
  const fetchImpl=vi.fn(async()=>({ok:true,json:async()=>[{result:{data:{json:{truthStore:{platforms:[{platform:'douyin',currentItems:10,archivedItems:20}]}}}}}]}));
  await fetchGrowthStatus('http://test-only',out,{fetchImpl});
  expect(JSON.parse(await readFile(out,'utf8')).platforms.douyin).toEqual({currentTotal:10,archivedTotal:20});
  await expect(fetchGrowthStatus('http://test-only',out,{fetchImpl:async()=>({ok:true,json:async()=>[{result:{data:{json:{truthStore:{ready:false,platforms:[]}}}}}]})})).rejects.toThrow('not ready');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('收到headers后body仍受超时控制',async()=>{
 const fetchImpl=async(_url:any,{signal}:any)=>({ok:true,json:()=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new Error('body aborted'))))});
 await expect(fetchGrowthStatus('http://test-only','/not-written',{fetchImpl,timeoutMs:10})).rejects.toThrow('body aborted');
});

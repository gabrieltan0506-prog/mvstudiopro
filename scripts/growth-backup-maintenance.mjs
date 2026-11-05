import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// 仅限已授权运维：复用后台采集的协作式 abort，绝不杀进程或删除采集锁。
export async function holdMaintenance({begin, label, holdMs, stopped, record, sleep=delay, now=Date.now}) {
  if (!/^maintenance:growth-pr-\d+$/.test(label) || !Number.isInteger(holdMs) || holdMs < 1000 || holdMs > 600000) {
    throw Error('growth_maintenance_scope_invalid');
  }
  const release = await begin(label);
  const expiresAt = now() + holdMs;
  try {
    await record({state:'ready',label,expiresAt,pid:process.pid});
    while (now() < expiresAt && !await stopped()) await sleep(Math.min(1000, expiresAt-now()));
  } finally {
    await release();
    await record({state:'released',label,expiresAt,pid:process.pid});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [label, receipt, stopFile] = process.argv.slice(2);
  if (!process.env.FLY_APP_NAME || !receipt || !stopFile || !path.isAbsolute(receipt) || !path.isAbsolute(stopFile)) {
    throw Error('growth_maintenance_fly_arguments_required');
  }
  let stopping=false;
  process.once('SIGTERM',()=>{stopping=true;});
  process.once('SIGINT',()=>{stopping=true;});
  const {beginGrowthInteractiveWorkload}=await import(pathToFileURL(path.resolve('server/growth/growthWorkloadPriority.ts')).href);
  await holdMaintenance({
    begin:beginGrowthInteractiveWorkload,label,holdMs:600000,
    stopped:async()=>stopping || await fs.stat(stopFile).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),
    record:async value=>fs.appendFile(receipt,JSON.stringify({...value,at:new Date().toISOString()})+'\n',{mode:0o600}),
  });
}

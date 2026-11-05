import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { staticVideoReceipt, validateStaticVideoReceipt } from './staticSiteVideos';
import { excludeVerifiedVideoCopies, verifyVideoOrigin, waitForVideoOrigins, VIDEO_READINESS_TIMEOUT_MS } from '../scripts/vite-static-site-video-offload';
const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const p of dirs.splice(0)) await fs.rm(p, { recursive: true }); });
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'static-video-test-')); dirs.push(dir);
  const source = path.join(dir, 'source'), output = path.join(dir, 'output');
  const bytes = Buffer.from('test-video-only'); const asset = { ...staticVideoReceipt.assets[0], path: '/home-assets/test.mp4', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  for (const root of [source, output]) { await fs.mkdir(path.join(root, 'home-assets'), { recursive: true }); await fs.writeFile(root + asset.path, bytes); await fs.writeFile(path.join(root, 'keep.txt'), 'keep'); }
  return { source, output, asset };
}
it('只排除输出副本，源文件和其它资源逐字节不变', async () => {
  const f = await fixture(); let checked = 0;
  expect(await excludeVerifiedVideoCopies(f.source, f.output, [f.asset], async () => { checked++; })).toEqual({ count: 1, bytes: f.asset.bytes });
  expect(checked).toBe(1); expect((await fs.stat(f.source + f.asset.path)).size).toBe(f.asset.bytes);
  await expect(fs.stat(f.output + f.asset.path)).rejects.toThrow(); expect(await fs.readFile(f.output + '/keep.txt', 'utf8')).toBe('keep');
});
it('回源未就绪、源变动或源/输出重叠都不得删除', async () => {
  const f = await fixture();
  await expect(excludeVerifiedVideoCopies(f.source, f.output, [f.asset], async () => { throw Error('not-ready'); })).rejects.toThrow('not-ready');
  expect((await fs.stat(f.output + f.asset.path)).size).toBe(f.asset.bytes);
  await expect(excludeVerifiedVideoCopies(f.source, f.source, [f.asset], async () => {})).rejects.toThrow('隔离');
  await fs.writeFile(f.source + f.asset.path, 'changed');
  await expect(excludeVerifiedVideoCopies(f.source, f.output, [f.asset], async () => {})).rejects.toThrow('内容变动');
  expect((await fs.stat(f.output + f.asset.path)).size).toBe(f.asset.bytes);
});
it('符号链接无法引导删除原文件，未验清单拒绝加载', async () => {
  const f = await fixture(); await fs.unlink(f.output + f.asset.path); await fs.symlink(f.source + f.asset.path, f.output + f.asset.path);
  await expect(excludeVerifiedVideoCopies(f.source, f.output, [f.asset], async () => {})).rejects.toThrow();
  expect((await fs.stat(f.source + f.asset.path)).size).toBe(f.asset.bytes);
  expect(() => validateStaticVideoReceipt({ ...staticVideoReceipt, complete: false })).toThrow();
  expect(() => validateStaticVideoReceipt({ ...staticVideoReceipt, assets: [{ ...staticVideoReceipt.assets[0], temporaryHold: false }] })).toThrow();
});

it('回源200但版本不匹配仍必须阻断发布', async () => {
  const asset = staticVideoReceipt.assets[0];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { headers: {
    'content-length': String(asset.bytes), 'content-type': 'video/mp4', 'accept-ranges': 'bytes',
    'x-static-video-sha256': asset.sha256, 'x-static-video-generation': 'wrong-version',
  } })));
  await expect(verifyVideoOrigin(asset)).rejects.toThrow('回源未就绪');
});

it('保留三片与退役25片清单覆盖全部静态视频，输出只保留允许发布项', async () => {
  const { assertVideoInventory } = await import('../scripts/vite-static-site-video-offload');
  const retired = (await import('./staticSiteVideoRetired.json')).default;
  expect(staticVideoReceipt.assets.map(a => a.path).sort()).toEqual([
    '/home-assets/digital-human-talk-20261020.mp4', '/home-assets/mojing-episode-01-20261007.mp4', '/home-assets/warship-2k-1.2x.mp4',
  ]);
  expect(retired.assets).toHaveLength(25);
  await assertVideoInventory(path.resolve('client/public'), [...staticVideoReceipt.assets, ...retired.assets]);
  const f = await fixture();
  await assertVideoInventory(f.output, [f.asset]);
  await fs.writeFile(f.output + '/new-video.mp4', 'unreviewed');
  await expect(assertVideoInventory(f.output, [f.asset])).rejects.toThrow('清单不匹配');
  expect((await fs.stat(f.output + f.asset.path)).size).toBe(f.asset.bytes);
});
it('退役项不请求回源；失败校验不提前删除其它副本', async () => {
  const f = await fixture();
  const missing = {...f.asset, path:'/home-assets/missing.mp4'};
  await expect(excludeVerifiedVideoCopies(f.source, f.output, [f.asset, missing], async () => {})).rejects.toThrow();
  expect((await fs.stat(f.output + f.asset.path)).size).toBe(f.asset.bytes);
  const result = await excludeVerifiedVideoCopies(f.source, f.output, [f.asset], async () => {});
  expect(result.count).toBe(1); expect((await fs.stat(f.source + f.asset.path)).size).toBe(f.asset.bytes);
});
it('退役片不再出现在博客展示或代理路由，用户工具入口保留', async () => {
  const retired = (await import('./staticSiteVideoRetired.json')).default;
  const vercel = JSON.parse(await fs.readFile('vercel.json','utf8'));
  const routes = vercel.rewrites.filter((r: {destination:string}) => r.destination.includes('/api/static-site-video/'));
  expect(routes).toHaveLength(3);
  for (const row of retired.assets) expect(routes.some((r: {source:string}) => r.source === row.path)).toBe(false);
  for (const name of await fs.readdir('content/blog')) {
    if (!name.endsWith('.md')) continue;
    expect(await fs.readFile(path.join('content/blog',name),'utf8')).not.toMatch(/<video\b|<source[^>]+\.mp4/);
  }
  expect(await fs.readFile('client/src/components/HomePhotoVideoUpscale.tsx','utf8')).toContain('<video');
});


it('后端已就绪直接放行，不固定等满窗口', async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});
  const check = vi.fn(async () => {});
  await waitForVideoOrigins(staticVideoReceipt.assets, undefined, {check});
  expect(check).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});
it('首次迁移旧SPA返回200，五分钟后全部真实元数据就绪才能通过', async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']}); const start=Date.now();
  vi.stubGlobal('fetch',vi.fn(async (url: string) => {
    const a=staticVideoReceipt.assets.find(a=>url.endsWith(a.sha256))!;
    if(Date.now()-start<5*60_000) return new Response(null,{headers:{'content-type':'text/html','content-length':'11789'}});
    return new Response(null,{headers:{'content-type':'video/mp4','content-length':String(a.bytes),
      'x-static-video-sha256':a.sha256,'x-static-video-generation':a.generation,'accept-ranges':'bytes'}});
  }));
  let finished=false;
  const done=waitForVideoOrigins(staticVideoReceipt.assets,undefined,{log:()=>{}}).then(()=>{finished=true});
  await vi.advanceTimersByTimeAsync(4*60_000); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000); await done; expect(finished).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('同轮验证全部三片，不能拿过期成功结果拼凑通过', async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']}); let round=0;
  const check=vi.fn(async (a: typeof staticVideoReceipt.assets[number])=>{
    if(a===staticVideoReceipt.assets[0]) round++;
    if((round===1&&a===staticVideoReceipt.assets[1])||(round===2&&a===staticVideoReceipt.assets[0])) throw Error('not-ready');
  });
  let finished=false;const done=waitForVideoOrigins(staticVideoReceipt.assets,undefined,{check,intervalMs:10,log:()=>{}}).then(()=>{finished=true});
  await vi.advanceTimersByTimeAsync(10);expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(10);await done;expect(round).toBe(3);expect(check).toHaveBeenCalledTimes(9);
});
it('持续版本错误到期失败，不能删除任何源或输出', async () => {
  const f=await fixture();vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});
  const waiting=excludeVerifiedVideoCopies(f.source,f.output,[f.asset],()=>waitForVideoOrigins([f.asset],undefined,{
    timeoutMs:25,intervalMs:10,check:async()=>{throw Error('wrong-generation')},log:()=>{},
  }));
  const rejected=expect(waiting).rejects.toThrow('视频回源等待超时');
  // 文件读取使用真实I/O；先让校验结束、等待计时器确实建好。
  while(vi.getTimerCount()===0) await new Promise(resolve=>setImmediate(resolve));
  await vi.advanceTimersByTimeAsync(25);await rejected;
  expect((await fs.stat(f.source+f.asset.path)).size).toBe(f.asset.bytes);
  expect((await fs.stat(f.output+f.asset.path)).size).toBe(f.asset.bytes);
  expect(vi.getTimerCount()).toBe(0);
});
it('挂起请求受全局截止保护并取消，不在每片上重置窗口', async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const signals:AbortSignal[]=[];
  const waiting=waitForVideoOrigins(staticVideoReceipt.assets,undefined,{timeoutMs:25,check:async(_a,_o,signal)=>{
    signals.push(signal!);await new Promise<void>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  },log:()=>{}});
  const rejected=expect(waiting).rejects.toThrow('等待超时');await vi.advanceTimersByTimeAsync(25);await rejected;
  expect(signals).toHaveLength(3);expect(signals.every(s=>s.aborted)).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('网络错误和404恢复后可继续，外层检查时限覆盖媒体等待与构建', async () => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});let calls=0;
  const waiting=waitForVideoOrigins([staticVideoReceipt.assets[0]],undefined,{intervalMs:10,check:async()=>{if(++calls<3)throw Error(calls===1?'network':'404')},log:()=>{}});
  await vi.advanceTimersByTimeAsync(20);await waiting;expect(calls).toBe(3);
  const workflow=await fs.readFile('.github/workflows/fly-deploy.yml','utf8');
  const frontend=workflow.split('  frontend:')[1];
  const jobMinutes=Number(frontend.match(/timeout-minutes: (\d+)/)![1]);
  const polls=Number(frontend.match(/seq 1 (\d+)/)![1]);
  const sleepSeconds=Number(frontend.match(/sleep (\d+)/)![1]);
  expect(polls*sleepSeconds*1000).toBeGreaterThan(VIDEO_READINESS_TIMEOUT_MS+5*60_000);
  expect(jobMinutes*60).toBeGreaterThan(polls*sleepSeconds+60);
});

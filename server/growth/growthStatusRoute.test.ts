import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// 执行真实router的query回调；仅替换I/O。不是正式HTTP/工作流验收。
function handler(summary: unknown, source = readFileSync(new URL('../routers.ts', import.meta.url),'utf8')) {
  const block = source.slice(source.indexOf('    getGrowthSystemStatus: publicProcedure'),source.indexOf('    setGrowthRuntimeMode:'));
  const callback = block.slice(block.indexOf('async () =>'),block.lastIndexOf('}),')+1);
  const readTrendStore = vi.fn(async () => { throw new Error('status must not read full warehouse'); });
  const deps = {
    summarizeTrendWindowCounts: () => ({warehouseTotal:0,windowFiltered:0}),
    readTrendStore, getSmtpStatus:()=>({}), readGrowthStatusSnapshot:async()=>null,
    readTrendRuntimeMeta:async()=>({scheduler:{},mailDigest:{}}), readGrowthRuntimeControl:async()=>null,
    readGrowthDebugSummary:async()=>summary, readDouyinCredentialHealthReport:async()=>null,
    fs:{statfs:async()=>({bsize:4096,blocks:1000000,bavail:500000})},
    activeGrowthPlatformValues:['douyin'], scheduledGrowthPlatformValues:['douyin'],
    getGrowthPlatformMeta:()=>({label:'抖音',description:'平台'}), buildPlatformSupportActivities:()=>['趋势'],
  };
  const js=ts.transpile(`const query = ${callback};`,{target:ts.ScriptTarget.ES2022});
  const run=new Function(...Object.keys(deps),`${js}; return query;`)(...Object.values(deps));
  return {run,readTrendStore};
}
describe('状态路由不读全库',()=>{
  it('并发轮询只消费摘要，保留真实0和历史摘要未知窗口',async()=>{
    const {run,readTrendStore}=handler({updatedAt:'2026-10-06T00:00:00Z',platforms:{douyin:{currentTotal:0,archivedTotal:10}},totals:{currentItems:0,archivedItems:10}});
    const results=await Promise.all(Array.from({length:30},()=>run()));
    expect(readTrendStore).not.toHaveBeenCalled();
    for(const r of results){expect(r.truthStore.ready).toBe(true);expect(r.truthStore.platforms[0]).toMatchObject({currentItems:0,archivedItems:10});expect(r.truthStore.platforms[0].windowItems15d).toBeUndefined();}
  });
  it('摘要缺失明确未就绪，不触发全库回退',async()=>{
    const {run,readTrendStore}=handler(null);const r=await run();
    expect(r.truthStore.ready).toBe(false);expect(r.anomalies.some((x:any)=>x.title==='状态摘要尚未就绪')).toBe(true);
    expect(readTrendStore).not.toHaveBeenCalled();
  });
});

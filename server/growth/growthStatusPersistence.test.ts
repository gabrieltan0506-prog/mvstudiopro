import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
it('已有采集写入摘要后，状态快照带窗口与热门信息，不需额外读库',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'growth-status-projection-'));
 await mkdir(path.join(root,'backups'));
 vi.stubEnv('GROWTH_STORE_DIR',root);vi.resetModules();
 try {
  const {refreshTrendDebugSummary,readGrowthStatusSnapshot}=await import('./trendStore');
  await refreshTrendDebugSummary({updatedAt:'2026-10-06T00:00:00Z',collections:{douyin:{platform:'douyin',source:'live',collectedAt:'2026-10-06T00:00:00Z',items:[{id:'test-only',title:'测试素材',likes:10,publishedAt:new Date().toISOString()}]}},history:{platforms:{douyin:{archivedItems:25}}}} as any);
  const snapshot=await readGrowthStatusSnapshot();
  expect(snapshot?.debugSummary?.platforms.douyin).toMatchObject({currentTotal:1,archivedTotal:25,windowItems15d:1,windowItems30d:1,hotTopic:'测试素材'});
 }finally{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
});

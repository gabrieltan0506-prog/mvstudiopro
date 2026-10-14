import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildTrendShortlistIndex, readTrendShortlistIndex, writeTrendShortlistIndex } from "./trendShortlistIndex";
import type { PlatformTrendCollection } from "./trendCollector";
const collection = (items: Array<Record<string, unknown>>) => ({platform:"xiaohongshu",source:"live",collectedAt:"2026-10-14T00:00:00Z",windowDays:365,items,notes:[],stats:{itemCount:items.length}} as unknown as PlatformTrendCollection);
it("近期优先、同日按互动选入，保留真实日期且不携带巨型媒体和评论详情", () => {
 const source=collection([
  {id:"old-hot",title:"旧热帖",publishedAt:"2026-01-01",likes:999999},
  {id:"new-1",title:"近期一",publishedAt:"2026-10-13",likes:1,rawResponse:"large"},
  {id:"new-2",title:"近期二",publishedAt:"2026-10-13",likes:2},
  {id:"undated",title:"未标日期",likes:999999},
 ]);
 const index=buildTrendShortlistIndex(source,"2026-10-14",2);
 expect(index.collection.items.map(i=>i.id)).toEqual(["new-2","new-1"]);
 expect(index.collection.items[1]).not.toHaveProperty("rawResponse");
 expect(index.collection.shortlistCoverage).toEqual({totalItems:4,indexedItems:2,selection:"recent-and-diverse"});
 expect(source.items).toHaveLength(4);
});
it("只读独立小索引，缺失或非法不回退全量；恢复来源不能冒充实时样本", async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),"shortlist-index-"));
 try {
  await mkdir(path.join(root,"platform-current"));
  await writeFile(path.join(root,"platform-current/xiaohongshu.current.json"),"禁止在选题请求读取此完整库");
  await expect(readTrendShortlistIndex(root,"xiaohongshu")).rejects.toThrow("not_ready");
  const source=collection([{id:"real",title:"真实样本",observedAt:"2026-10-13"}]);
  await writeTrendShortlistIndex(root,source,"2026-10-14");
  expect((await readTrendShortlistIndex(root,"xiaohongshu")).items[0].id).toBe("real");
  expect(await readFile(path.join(root,"platform-current/xiaohongshu.current.json"),"utf8")).toBe("禁止在选题请求读取此完整库");
  await writeTrendShortlistIndex(root,{...source,source:"csv-recovered" as any},"2026-10-14");
  await expect(readTrendShortlistIndex(root,"xiaohongshu")).rejects.toThrow("not_ready");
 } finally { await rm(root,{recursive:true,force:true}); }
});
it("有效空采集库与索引缺失分别处理，不用超时冒充零样本", async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),"shortlist-index-"));
 try {await writeTrendShortlistIndex(root,collection([]),"2026-10-14");expect((await readTrendShortlistIndex(root,"xiaohongshu")).items).toEqual([]);}
 finally{await rm(root,{recursive:true,force:true});}
});
it("已有gzip库可流式初始化，跨块中文、转义和嵌套结构都正确，原库不变", async () => {
 const { gzipSync } = await import("node:zlib");
 const { ensureTrendShortlistIndex } = await import("./trendShortlistIndex");
 const root=await mkdtemp(path.join(os.tmpdir(),"shortlist-stream-"));
 try {
  await mkdir(path.join(root,"platform-current"));
  const source=collection(Array.from({length:2000},(_,i)=>({id:`真实-${i}`,title:`中文转义\\\"[]{}-${i}`,publishedAt:"2026-10-13",likes:i,raw:{nested:[{text:'伪标记 "items":[{}]'}]}})));
  const bytes=gzipSync(JSON.stringify({updatedAt:"2026-10-14",collection:source}));
  const file=path.join(root,"platform-current/xiaohongshu.current.json.gz");await writeFile(file,bytes);
  await Promise.all([ensureTrendShortlistIndex(root,"xiaohongshu"),ensureTrendShortlistIndex(root,"xiaohongshu")]);
  const result=await readTrendShortlistIndex(root,"xiaohongshu");
  expect(result.items).toHaveLength(2000);expect(result.items[0].id).toBe("真实-1999");expect(result.items[0].title).toBe(source.items[1999].title);
  expect(await readFile(file)).toEqual(bytes);
 } finally {await rm(root,{recursive:true,force:true});}
});
it("截断采集库不能生成可用索引", async () => {
 const { ensureTrendShortlistIndex } = await import("./trendShortlistIndex");
 const root=await mkdtemp(path.join(os.tmpdir(),"shortlist-broken-"));
 try {await mkdir(path.join(root,"platform-current"));await writeFile(path.join(root,"platform-current/xiaohongshu.current.json"),'{"updatedAt":"now","collection":{"platform":"xiaohongshu","source":"live","items":[{"id":"bad","title":"截断');await expect(ensureTrendShortlistIndex(root,"xiaohongshu")).rejects.toThrow();await expect(readTrendShortlistIndex(root,"xiaohongshu")).rejects.toThrow("not_ready");}
 finally {await rm(root,{recursive:true,force:true});}
});

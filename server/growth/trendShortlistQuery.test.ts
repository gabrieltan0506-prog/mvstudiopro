import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { queryTrendShortlist } from "./trendShortlistQuery";
const now = Date.parse("2026-10-14T00:00:00Z");
async function fixture(items: unknown[]) {
 const root = await mkdtemp(path.join(os.tmpdir(), "trend-query-"));
 await mkdir(path.join(root, "platform-current"));
 const file = path.join(root, "platform-current/xiaohongshu.current.json.gz");
 const save = (rows: unknown[]) => writeFile(file, gzipSync(JSON.stringify({updatedAt:new Date(now).toISOString(),collection:{platform:"xiaohongshu",source:"live",items:rows}})));
 await save(items); return {root,file,save};
}
it("全库找低频主题，排除越界、缺日期与非所求短剧，保留多重身份", async () => {
 const many = Array.from({length:13000}, (_,i)=>({id:`多-${i}`,title:"日常热点",publishedAt:"2026-10-13"}));
 const f=await fixture([...many,...[
  {id:"运动",title:"网球热身动作",publishedAt:"2026-10-10"},
  {id:"工作",title:"办公室久坐间隙",observedAt:"2026-10-09"},
  {id:"旧",title:"网球热身",publishedAt:"2025-01-01"},
  {id:"未来",title:"网球热身",publishedAt:"2027-01-01"},
  {id:"无日期",title:"网球热身"},
  {id:"短剧",title:"网球甜宠短剧",publishedAt:"2026-10-12"},
 ]]);
 try {
  const result=await queryTrendShortlist(f.root,"xiaohongshu","本轮要求：网球热身、办公室久坐",30,now);
  expect(result.queryCoverage.totalItems).toBe(13006);
  expect(result.items.map(i=>i.id).sort()).toEqual(["工作","运动"]);
  const fiction=await queryTrendShortlist(f.root,"xiaohongshu","本轮要求：网球短剧",30,now);
  expect(fiction.items.some(i=>i.id==="短剧")).toBe(true);
 } finally {await rm(f.root,{recursive:true,force:true});}
});
it("同查询合并扫描，源文件更新使缓存失效，候选上限明确",async()=>{
 const rows=Array.from({length:1000},(_,i)=>({id:String(i),title:`网球热身${i}`,likes:i,publishedAt:"2026-10-13"}));
 const f=await fixture(rows);
 try {
  const [a,b]=await Promise.all([queryTrendShortlist(f.root,"xiaohongshu","网球热身",30,now),queryTrendShortlist(f.root,"xiaohongshu","网球热身",30,now)]);
  expect(a).toEqual(b);expect(a.items.length).toBeLessThanOrEqual(48);expect(a.queryCoverage.matchedItems).toBe(1000);
  await f.save([{id:"new",title:"网球热身新增",publishedAt:"2026-10-13"}]);
  expect((await queryTrendShortlist(f.root,"xiaohongshu","网球热身",30,now)).items.map(i=>i.id)).toEqual(["new"]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it("损坏压缩库不返回部分候选，也不缓存失败",async()=>{
 const f=await fixture([]);
 try {
  await writeFile(f.file,gzipSync('{"updatedAt":"now","collection":{"platform":"xiaohongshu","source":"live","items":[{"id":"1","title":"网球"}'));
  await expect(queryTrendShortlist(f.root,"xiaohongshu","网球",30,now)).rejects.toThrow();
  await writeFile(f.file,gzipSync('{"updatedAt":"now","collection":{"platform":"xiaohongshu","source":"live","items":[]'));
  await expect(queryTrendShortlist(f.root,"xiaohongshu","网球",30,now)).rejects.toThrow();
  for (const items of ['[{},{}{}]', '[{},]', '[,{}]']) {
    await writeFile(f.file,gzipSync('{"updatedAt":"now","collection":{"platform":"xiaohongshu","source":"live","items":'+items+'}}'));
    await expect(queryTrendShortlist(f.root,"xiaohongshu","网球",30,now)).rejects.toThrow();
  }
  await f.save([]);expect((await queryTrendShortlist(f.root,"xiaohongshu","网球",30,now)).items).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it("并发查询等待读盘名额，旧数字ID仍可完整去重返回", async () => {
 const f=await fixture([42,43].map(id=>({id,title:"网球热身",publishedAt:"2026-10-13"})));
 try {
  const results=await Promise.all(Array.from({length:6},(_,i)=>queryTrendShortlist(f.root,"xiaohongshu",`本轮要求：网球热身。背景编号${i}`,30,now)));
  for(const result of results) expect(result.items.map(row=>row.id).sort()).toEqual(["42","43"]);
 } finally {await rm(f.root,{recursive:true,force:true});}
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, {recursive:true,force:true})));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-retired-read-")); roots.push(root);
  vi.stubEnv("GROWTH_STORE_DIR",root);
  vi.stubEnv("GROWTH_LEGACY_STORE_FILE",path.join(root,"legacy.json"));
  vi.stubEnv("GROWTH_GITHUB_OFFLOAD_CACHE_DIR",path.join(root,"cache"));
  vi.stubEnv("GROWTH_GITHUB_COLD_STORE_BASE_URL","https://synthetic.invalid/releases/download/growth-cold-store-latest");
  vi.stubEnv("GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL","");
  const fetch = vi.fn(async () => { throw Error("不允许读取退出平台远端备份"); });
  vi.stubGlobal("fetch",fetch); vi.resetModules();
  return {root,fetch,consumer:await import("./trendStore")};
}
it.each([{}, {preferDerivedFiles:true}, {preferFlyLive:true}])("退出平台显式查询在任何远端IO前返回空 %j",async options=>{
  const {fetch,consumer}=await setup();
  const result=await consumer.readTrendStoreForPlatforms(["kuaishou","toutiao"],options);
  expect(result.collections).toEqual({}); expect(fetch).not.toHaveBeenCalled();
});
it.each(["kuaishou","toutiao"] as const)("%s 历史查询不读取索引或冷备",async platform=>{
  const {fetch,consumer}=await setup();
  expect(await consumer.loadArchiveItemsNearDaysAgo(platform)).toEqual({items:[]});
  expect(fetch).not.toHaveBeenCalled();
});
it("共享current含退出平台时只返回保留平台且原文件不变",async()=>{
  const {root,consumer,fetch}=await setup();
  const collection=(platform:string)=>({platform,source:"live",collectedAt:new Date().toISOString(),items:[{id:platform,title:"合成数据",platform}]});
  const raw=JSON.stringify({updatedAt:new Date().toISOString(),collections:Object.fromEntries(["douyin","xiaohongshu","bilibili","weixin_channels","kuaishou","toutiao"].map(p=>[p,collection(p)])),archiveIndex:[]});
  await fs.writeFile(path.join(root,"current.json"),raw);
  await fs.writeFile(path.join(root,"runtime-meta.json"),"{}");
  await fs.writeFile(path.join(root,"history-summary.json"),JSON.stringify({platforms:{}}));
  const result=await consumer.readTrendStore();
  expect(Object.keys(result.collections).sort()).toEqual(["bilibili","douyin","weixin_channels","xiaohongshu"]);
  expect(await fs.readFile(path.join(root,"current.json"),"utf8")).toBe(raw);
  const mixed=await consumer.readTrendStoreForPlatforms(["douyin","kuaishou","toutiao"]);
  expect(Object.keys(mixed.collections)).toEqual(["douyin"]);
  expect(fetch).not.toHaveBeenCalled();
});

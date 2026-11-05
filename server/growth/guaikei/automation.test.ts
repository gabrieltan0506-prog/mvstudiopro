import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { GuaikeiService } from "./service";
import { GuaikeiAutomation } from "./automation";
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "guaikei-recovery-")); vi.stubEnv("GROWTH_STORE_DIR", root); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
it("恢复不丢最近50条之外的任务；跨管理员、关闭调度仍公平轮询", async () => {
  const jobs = Array.from({length: 60}, (_, i) => ({ id: randomUUID(), owner: i % 2 + 1, requestId: `r${i}`, fingerprint: `f${i}`,
    input: {platform:"douyin",operation:"search",query:`q${i}`,limit:1}, status:"pending", items:[], reservedCents:10, actualCents:null,
    createdAt: new Date(Date.now() - 120_000 + i).toISOString(), updatedAt:new Date().toISOString(),
  }));
  await fs.writeFile(path.join(root,"index.json"),JSON.stringify({version:1,jobs}));
  const request = vi.fn(async () => ({errcode:1}));
  const service = new GuaikeiService({root,request,ready:()=>true});
  const automation = new GuaikeiAutomation({root,service});
  // 没有配置调度owner也必须收尾手动已付费任务；不能依赖开关才能GET。
  for(let i=0;i<6;i++) await automation.tick();
  expect(request).toHaveBeenCalledTimes(60);
  expect(new Set(request.mock.calls.map(call => (call as unknown as [any])[0].query)).size).toBe(60);
  expect(request.mock.calls.every(call => (call as unknown as [any,string])[1]==="GET")).toBe(true);
});
it("单项读取失败不阻断其他已提交任务",async()=>{
  const poll=vi.fn().mockRejectedValueOnce(Error("读失败")).mockResolvedValue({});
  const service={pending:vi.fn(async()=>[{id:"a",owner:1},{id:"b",owner:2}]),poll,quote:vi.fn(),submit:vi.fn()};
  await new GuaikeiAutomation({root,service}).tick();
  expect(poll.mock.calls).toEqual([[1,"a"],[2,"b"]]);expect(service.submit).not.toHaveBeenCalled();
});

it("公共池只公开自动轮次原始任务，不暴露管理员手动缓存",async()=>{
 const {defaultGuaikeiSettings}=await import("../../../shared/guaikei");
 const request={platform:"wechat",operation:"search",query:"美食",limit:20};
 await fs.writeFile(path.join(root,"automation.json"),JSON.stringify({version:1,owner:7,settings:defaultGuaikeiSettings(),slots:{},cursors:{},lastAt:{},native:{},runs:[{id:"auto",owner:7,platform:"wechat",reason:"每小时",at:new Date().toISOString(),requests:[request],jobIds:["private","public"],status:"submitted"}]}));
 const jobs=await new GuaikeiAutomation({root}).publicJobs(async(owner,id)=>({id,owner,status:"completed",input:request,requestId:id==="public"?createHash("sha256").update("auto:0").digest("hex"):"manual"} as any));
 expect(jobs.map(j=>j.id)).toEqual(["public"]);
});
it("新自动最热排序与旧任务GET合同各自保持",async()=>{
 const {requestContract}=await import("./provider");
 for(const [platform,value]of [["wechat",2],["xiaohongshu",2],["douyin",1]] as const){
 const input={platform,operation:"search" as const,query:"生活",limit:20};
 const key=platform==="douyin"?"sort_type":"sort";
 expect(requestContract(input).params[key]).toBe(0);
 expect(requestContract({...input,searchOrder:"hot"}).params[key]).toBe(value);
 }
});

it("调度后仍保留十天前公共来源索引以支持十五天报告", async()=>{
 const {defaultGuaikeiSettings}=await import("../../../shared/guaikei");
 const settings=defaultGuaikeiSettings();settings.enabled=true;
 for(const cfg of Object.values(settings.platforms))cfg.enabled=false;
 const request={platform:"wechat",operation:"search",query:"美食",limit:20};
 const run={id:"old",owner:7,platform:"wechat",reason:"定时",at:new Date(Date.now()-10*86400_000).toISOString(),requests:[request],jobIds:["public"],status:"submitted"};
 await fs.writeFile(path.join(root,"automation.json"),JSON.stringify({version:1,owner:7,settings,slots:{},cursors:{},lastAt:{},native:{},runs:[run]}));
 const service={pending:vi.fn(async()=>[]),poll:vi.fn(),quote:vi.fn(),submit:vi.fn()};
 const automation=new GuaikeiAutomation({root,service});await automation.tick();
 const jobs=await automation.publicJobs(async(owner,id)=>({id,owner,status:"completed",input:request,requestId:createHash("sha256").update("old:0").digest("hex")} as any));
 expect(jobs.map(j=>j.id)).toEqual(["public"]);expect(service.submit).not.toHaveBeenCalled();
});

it("离线还原包禁止自动或手动提交和轮询，保留原台账", async () => {
  const index = JSON.stringify({version:1,jobs:[]});
  await fs.writeFile(path.join(root,"index.json"), index);
  await fs.writeFile(path.join(root,".growth-offline-restore"), "offline-audit-only");
  const request = vi.fn(async () => ({errcode:1}));
  const service = new GuaikeiService({root,request,ready:()=>true});
  const pending = vi.fn(async () => []);
  const automation = new GuaikeiAutomation({root,service:{...service,
    quote: service.quote.bind(service), submit:service.submit.bind(service),
    poll:service.poll.bind(service),pending}});
  await expect(automation.tick()).rejects.toThrow("离线还原");
  await expect(service.submit(1,{platform:"tiktok",operation:"search",query:"test",limit:1},"test",100)).rejects.toThrow("离线还原");
  await expect(service.poll(1,"test")).rejects.toThrow("离线还原");
  expect(request).not.toHaveBeenCalled();expect(pending).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(root,"index.json"),"utf8")).toBe(index);
});

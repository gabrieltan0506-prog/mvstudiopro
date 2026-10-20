import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema-jobs";
import { newMarketingPlan } from "../../shared/marketingPlan";
const state = vi.hoisted(() => ({ db: null as any, used: 0, balance: 10 }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("../credits", () => ({ getCredits: async () => ({totalAvailable:state.balance}), deductCreditsAmount: vi.fn() }));
vi.mock("../services/platformPersonaPolish", () => ({ countPlatformPersonaPolishEver: async () => state.used, countPlatformPersonaPolishToday: async () => state.used }));
import { enqueueMarketingPlan, getMarketingPlan, retryMarketingPlan } from "./platformMarketingPlan";
import { reapStaleJobsOnce } from "./staleJobsReaper";
const pg = new PGlite();
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
  state.db = drizzle(pg);
}, 30_000);
beforeEach(async () => { state.used=0;state.balance=10;await pg.exec("TRUNCATE jobs"); });
afterAll(() => pg.close());
it("真实失联清理保留两份原稿和排队任务，不删除或自动重投", async () => {
  const a=await enqueueMarketingPlan(7,false,"推广网站，保留已成功的第一份稿件",0);
  const b=await enqueueMarketingPlan(8,false,"亲子绘本，保留尚未领取的排队任务",0);
  const saved=newMarketingPlan("推广网站，保留已成功的第一份稿件");
  saved.steps.deepseek={status:"succeeded",text:"已经完成且必须保留的原稿"};saved.steps.glm={status:"running"};
  const old=new Date(Date.now()-24*3600000);
  await state.db.update(jobs).set({status:"running",updatedAt:old,output:{marketingPlan:saved}}).where(eq(jobs.id,a.jobId));
  await state.db.update(jobs).set({updatedAt:old}).where(eq(jobs.id,b.jobId));
  await reapStaleJobsOnce({bypassDisable:true});
  expect(await getMarketingPlan(7,a.jobId)).toMatchObject({status:"failed",result:{steps:{deepseek:{text:"已经完成且必须保留的原稿"},glm:{status:"running"}}}});
  expect(await getMarketingPlan(8,b.jobId)).toMatchObject({status:"failed"});
});
it("同账号同需求并发只有一条真实任务，另一账号不能读或重试", async () => {
  const request = () => enqueueMarketingPlan(7,false,"亲子绘本推广测试，没有家长群",0);
  const first = await request();
  const [a,b] = await Promise.all([request(),request()]);
  expect(a.jobId).toBe(first.jobId); expect(b.reused).toBe(true);
  expect((await pg.query("SELECT * FROM jobs")).rows).toHaveLength(1);
  await expect(getMarketingPlan(8, first.jobId)).rejects.toThrow("无权访问");
  await expect(retryMarketingPlan(8, first.jobId,"glm")).rejects.toThrow("无权访问");
});
it("不同需求同时提交只允许一个活跃任务，防止共享免费次数", async () => {
  const results=await Promise.allSettled([enqueueMarketingPlan(7,false,"推广网站功能，价格尚未确认",0),enqueueMarketingPlan(7,false,"推广另一份亲子绘本作品",0)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await pg.query("SELECT * FROM jobs")).rows).toHaveLength(1);
});
it("额度变更和余额不足均不建单；失败步骤定向恢复保留成功原稿", async () => {
  state.used=5;
  await expect(enqueueMarketingPlan(7,false,"推广网站功能，价格尚未确认",0)).rejects.toThrow("额度已变化");
  state.balance=0;
  await expect(enqueueMarketingPlan(7,false,"推广网站功能，价格尚未确认",1)).rejects.toThrow("积分不足");
  expect((await pg.query("SELECT * FROM jobs")).rows).toHaveLength(0);
  state.used=0;
  const {jobId}=await enqueueMarketingPlan(7,false,"推广网站功能，价格尚未确认",0);
  const result=newMarketingPlan("推广网站功能，价格尚未确认");
  result.steps.deepseek={status:"succeeded",text:"保留的真实原稿"};result.steps.glm={status:"unknown",attempts:1};
  await state.db.update(jobs).set({status:"succeeded",output:{marketingPlan:result}}).where(eq(jobs.id,jobId));
  await expect(retryMarketingPlan(7,jobId,"deepseek")).rejects.toThrow("不会重复生成");
  await retryMarketingPlan(7,jobId,"glm");
  const saved=await getMarketingPlan(7,jobId);
  expect(saved?.status).toBe("queued");expect(saved?.result.steps.deepseek.text).toBe("保留的真实原稿");
  expect(saved?.result.steps.glm).toMatchObject({status:"pending",attempts:1,history:[{}]});
});

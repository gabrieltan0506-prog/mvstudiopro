import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuaikeiService } from "./service";
const input = { platform: "douyin", operation: "search", query: "AI漫剧", limit: 20 } as const;
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "guaikei-test-")); vi.stubEnv("GROWTH_STORE_DIR", root); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); await fs.rm(root, { recursive: true, force: true }); });
describe("任务持久化、权限与预算（仅虚构响应，无生产调用）", () => {
  it.each(["missing", "negative", "actual", "date", "duplicate"])("台账字段损坏%s时阻止报价、提交与恢复外呼", async kind => {
    const request = vi.fn(async () => ({ errcode: 0 }));
    const service = new GuaikeiService({ root, request, ready: () => true });
    const job = await service.submit(1, input, "original", 20);
    const ledger = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8"));
    if (kind === "missing") delete ledger.jobs[0].reservedCents;
    if (kind === "negative") ledger.jobs[0].reservedCents = -20;
    if (kind === "actual") ledger.jobs[0].actualCents = "0";
    if (kind === "date") ledger.jobs[0].createdAt = "broken";
    if (kind === "duplicate") ledger.jobs.push({ ...ledger.jobs[0] });
    const corrupt = JSON.stringify(ledger);
    await fs.writeFile(path.join(root, "index.json"), corrupt);
    request.mockClear();
    await expect(service.quote(input)).rejects.toThrow("台账记录损坏");
    await expect(service.submit(1, { ...input, query: "新关键词" }, "new", 20)).rejects.toThrow("台账记录损坏");
    await expect(service.poll(1, job.id)).rejects.toThrow("台账记录损坏");
    expect(request).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(root, "index.json"), "utf8")).toBe(corrupt);
  });
  it("18条一批、20条两批；微信未知批量明确保守预占", async () => {
    const service = new GuaikeiService({ root, ready: () => true });
    expect(await service.quote({ ...input, limit: 18 })).toMatchObject({ estimatedCents: 10, reservedCents: 10 });
    expect(await service.quote(input)).toMatchObject({ estimatedCents: 20, reservedCents: 20 });
    expect(await service.quote({ ...input, platform: "wechat", limit: 10 })).toMatchObject({ estimatedCents: null, reservedCents: 150 });
  });
  it("真实账单纠正TikTok20条预占，默认无日上限且公众号禁止新采", async () => {
    const request = vi.fn();
    const service = new GuaikeiService({ root, ready: () => true, request });
    expect(await service.quote({ ...input, platform: "tiktok", limit: 20 })).toMatchObject({ reservedCents: 20, dailyLimitCents: 0 });
    expect(await service.quote({ ...input, platform: "xiaohongshu", limit: 20 })).toMatchObject({ reservedCents: 20 });
    await expect(service.submit(1, { ...input, platform: "wechat", operation: "articles" }, "article", 300)).rejects.toThrow("公众号采集已停用");
    expect(request).not.toHaveBeenCalled();
  });
  it("并发相同提交只POST一次，预算先落盘", async () => {
    const request = vi.fn(async () => { const data = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8")); expect(data.jobs[0].status).toBe("submitting"); return { errcode: 0 }; });
    const service = new GuaikeiService({ root, request, ready: () => true });
    const [a, b] = await Promise.all([service.submit(1, input, "same", 20), service.submit(1, input, "same", 20)]);
    expect(a.id).toBe(b.id); expect(request).toHaveBeenCalledTimes(1);
    expect((await service.quote(input)).dailyReservedCents).toBe(20);
  });
  it("POST超时后重启只GET同参数并恢复真实结果", async () => {
    const first = vi.fn(async () => { throw new Error("模拟网络断开"); });
    const a = await new GuaikeiService({ root, request: first, ready: () => true }).submit(1, input, "same", 20);
    expect(a.status).toBe("unknown");
    const second = vi.fn(async () => ({ errcode: 0, data: [{ aweme_id: "123", desc: "真实结构样本", create_time: Math.floor(Date.now() / 1000), digg_count: 0 }] }));
    const service = new GuaikeiService({ root, request: second, ready: () => true });
    expect((await service.submit(1, input, "same", 20)).id).toBe(a.id);
    expect(second).not.toHaveBeenCalled();
    const done = await service.poll(1, a.id);
    expect(second).toHaveBeenCalledWith(input, "GET"); expect(done.status).toBe("completed");
    expect(done.items[0].likes).toBe(0); expect(done.actualCents).toBeNull();
    expect((await service.get(1, a.id)).items).toHaveLength(1);
    await expect(service.get(2, a.id)).rejects.toThrow("无权");
    expect(await service.list(2)).toEqual([]);
    expect((await service.submit(1, input, "new-click", 20)).id).toBe(a.id);
    expect(second).toHaveBeenCalledTimes(1);
  });
  it("预算不足、未配Token、台账损坏时不发请求", async () => {
    const request = vi.fn(async () => ({ errcode: 0 }));
    vi.stubEnv("GUAIKEI_DAILY_BUDGET_CENTS", "10");
    const service = new GuaikeiService({ root, request, ready: () => true });
    await expect(service.submit(1, input, "x", 20)).rejects.toThrow("预算");
    await expect(new GuaikeiService({ root, request, ready: () => false }).submit(1, input, "x", 20)).rejects.toThrow("TOKEN");
    await fs.writeFile(path.join(root, "index.json"), "broken");
    await expect(service.submit(1, input, "x", 20)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("错误码不是成功，费用预占不因失败消失", async () => {
    const service = new GuaikeiService({ root, request: async () => ({ errcode: 401 }), ready: () => true });
    expect((await service.submit(1, input, "x", 20)).status).toBe("failed");
    expect((await service.quote(input)).dailyReservedCents).toBe(20);
  });
  it("未知结果形状保存原始回执且明确失败", async () => {
    const request = vi.fn().mockResolvedValueOnce({ errcode: 0 }).mockResolvedValueOnce({ errcode: 0, data: { mystery: true } });
    const service = new GuaikeiService({ root, request, ready: () => true });
    const job = await service.submit(1, input, "x", 20);
    expect((await service.poll(1, job.id)).status).toBe("failed");
    expect(await fs.readFile(path.join(root, `${job.id}.raw.json`), "utf8")).toContain("mystery");
  });
  it("真实传输函数固定域名、秒时间戳、头鉴权且不跟随重定向", async () => {
    vi.stubEnv("FLY_APP_NAME", "test-app"); vi.stubEnv("GUAIKEI_API_TOKEN", "test-key");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const service = new GuaikeiService({ root });
    await service.submit(1, input, "transport", 20);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://www.guaikei.com");
    expect(url.searchParams.get("_")).toMatch(/^\d{10}$/);
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({ TOKEN: "test-key" });
    expect(options.body).not.toContain("test-key");
    expect(await fs.readFile(path.join(root, "index.json"), "utf8")).not.toContain("test-key");
  });
  it("不同任务并发也共享预算门禁", async () => {
    vi.stubEnv("GUAIKEI_DAILY_BUDGET_CENTS", "20");
    const request = vi.fn(async () => ({ errcode: 0 }));
    const service = new GuaikeiService({ root, request, ready: () => true });
    const results = await Promise.allSettled([service.submit(1, input, "a", 20), service.submit(1, { ...input, query: "另一个关键词" }, "b", 20)]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

});

it("POST与失败GET回执先保存，成功标准化另存且不覆盖原JSON",async()=>{
 const request=vi.fn().mockResolvedValueOnce({errcode:0}).mockResolvedValueOnce({errcode:1}).mockResolvedValueOnce({errcode:0,data:[{aweme_id:"123",desc:"内容",create_time:Math.floor(Date.now()/1000)}]});
 const service=new GuaikeiService({root,request,ready:()=>true});const job=await service.submit(1,input,"raw-audit",20);
 await service.poll(1,job.id);
 const ledger=JSON.parse(await fs.readFile(path.join(root,"index.json"),"utf8"));ledger.jobs[0].lastPolledAt="2020-01-01T00:00:00Z";await fs.writeFile(path.join(root,"index.json"),JSON.stringify(ledger));
 await service.poll(1,job.id);
 const files=await fs.readdir(root);expect(files.filter(n=>n.endsWith(".submit.raw.json"))).toHaveLength(1);
 const raw=await Promise.all(files.filter(n=>n.endsWith(".raw.json")).map(n=>fs.readFile(path.join(root,n),"utf8")));
 expect(raw.some(text=>JSON.parse(text).errcode===1)).toBe(true);
 expect(files.filter(n=>n.endsWith(".normalized.json"))).toHaveLength(1);
 expect(await fs.readFile(path.join(root,`${job.id}.raw.json`),"utf8")).toContain("123");
});

it("旧小红书台账按原始publish_time恢复，缺原始回执不以旧timestamp冒充近期",async()=>{
 const service=new GuaikeiService({root,request:async()=>({errcode:0}),ready:()=>true});
 const wx={...input,platform:"xiaohongshu" as const};
 const job=await service.submit(1,wx,"legacy",20);
 const ledger=JSON.parse(await fs.readFile(path.join(root,"index.json"),"utf8"));
 ledger.jobs[0].status="completed";ledger.jobs[0].items=[{id:"old",title:"旧文",publishedAt:new Date().toISOString()}];
 await fs.writeFile(path.join(root,"index.json"),JSON.stringify(ledger));
 expect((await service.get(1,job.id)).items).toEqual([]);
 await fs.writeFile(path.join(root,`${job.id}.raw.json`),JSON.stringify({data:[{id:"old",title:"旧文",timestamp:Date.now(),publish_time:"2025-03-16 01:14:19"}]}));
 expect((await service.get(1,job.id)).items).toEqual([]);
});

import { describe, it, expect, vi } from "vitest";
import { prepareGuaikeiTrendSnapshot, combineGuaikeiTrendEvidence, assertGuaikeiTrendSnapshot } from "./guaikeiTrendEvidence";
import type { GuaikeiJob } from "../../shared/guaikei";
const jobId = "11111111-1111-4111-8111-111111111111";
const item = { id: "a", platform: "xiaohongshu" as const, title: "AI工作流", description: "完整正文", author: "作者", authorId: "u", url: "https://example.com/a?track=1", publishedAt: "2026-11-03T08:00:00Z", likes: 2, comments: null, shares: null, views: null };
const job = { id: jobId, owner: 7, status: "completed", input: { platform: "xiaohongshu", operation: "search", query: "AI", limit: 20 }, updatedAt: "2026-11-04T13:00:00Z", items: [item] } as GuaikeiJob;
const args = { owner: 7, role: "admin", refs: [{ jobId, itemIds: ["a"] }], platforms: ["xiaohongshu"], windowDays: 7, anchorMs: Date.parse("2026-11-04T13:00:00Z") };
describe("外部资料与原库合并", () => {
  it("空公共池冻结空快照，不读取管理员私有任务", async () => {
    const read = vi.fn();
    expect((await prepareGuaikeiTrendSnapshot({ ...args, refs: [] }, read, async()=>[]))?.items).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it("冻结真实作品，重复引用去重，序列化后保持正文和任务身份", async () => {
    const snap = await prepareGuaikeiTrendSnapshot({ ...args, refs: [...args.refs, ...args.refs] }, async () => job);
    const saved = JSON.parse(JSON.stringify(snap));
    expect(saved.items).toHaveLength(1); expect(saved.items[0]).toMatchObject({ jobId, description: "完整正文", collectedAt: job.updatedAt });
    expect(() => assertGuaikeiTrendSnapshot(saved, 7, ["xiaohongshu"], 7)).not.toThrow();
    expect(() => assertGuaikeiTrendSnapshot(saved, 8, ["xiaohongshu"], 7)).toThrow("不匹配");
  });
  it.each(["role", "owner", "pending", "missing", "old", "undated", "large"])("%s在扣费之前拒绝不可用资料", async kind => {
    const bad = structuredClone(job);
    if (kind === "owner") bad.owner = 8;
    if (kind === "pending") bad.status = "pending";
    if (kind === "missing") bad.items = [];
    if (kind === "old") bad.items[0].publishedAt = "2025-01-01T00:00:00Z";
    if (kind === "undated") bad.items[0].publishedAt = null;
    if (kind === "large") bad.items[0].description = "超长".repeat(13000);
    await expect(prepareGuaikeiTrendSnapshot({ ...args, role: kind === "role" ? "user" : "admin" }, async () => bad)).rejects.toThrow();
  });
  it("与原库按ID及去查询参数的原链接去重，不修改统计数据", async () => {
    const snap = await prepareGuaikeiTrendSnapshot(args, async () => job);
    const native = [{ platform: "xiaohongshu", items: [{ id: "legacy", url: "https://example.com/a?track=2" }] }];
    const before = JSON.stringify(native);
    expect(combineGuaikeiTrendEvidence(snap, native)).toEqual([]);
    expect(JSON.stringify(native)).toBe(before);
    expect(combineGuaikeiTrendEvidence(snap, [{ platform: "xiaohongshu", items: [{ id: "a" }] }])).toEqual([]);
    expect(combineGuaikeiTrendEvidence(snap, [{ platform: "douyin", items: [{ id: "a" }] }])).toHaveLength(1);
  });
  it.each(["search", "articles"])("微信%s保留独立来源，不混成小红书作品", async operation => {
    const wx = { ...job, input: { ...job.input, platform: "wechat", operation }, items: [{ ...item, platform: "wechat" }] } as GuaikeiJob;
    const snap = await prepareGuaikeiTrendSnapshot(args, async () => wx);
    expect(snap?.items[0].reportPlatform).toBe(operation === "articles" ? "wechat_articles" : "weixin_channels");
    expect(snap?.platforms).toEqual(["xiaohongshu"]);
  });
});

it("普通用户按时间和平台消费公共作品，快照冻结给当前订单所有者", async()=>{
 const snap=await prepareGuaikeiTrendSnapshot({...args,owner:99,role:"user",refs:[]}, async()=>{throw Error("不能读私有任务")},async()=>[job,{...job,items:[{...item,id:"old",publishedAt:"2020-01-01T00:00:00Z"}]}]);
 expect(snap?.owner).toBe(99);expect(snap?.items.map(i=>i.id)).toEqual(["a"]);
 expect(()=>assertGuaikeiTrendSnapshot(snap!,99,args.platforms,7)).not.toThrow();
});

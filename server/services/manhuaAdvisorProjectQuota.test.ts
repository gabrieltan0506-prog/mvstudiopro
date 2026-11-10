import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { addDigitalHumanSegment } from "../../shared/digitalHumanProject";
import { newDigitalHumanDraft } from "../../shared/digitalHumanStudio";
import { advisorProjectRef } from "../../shared/manhuaCreativeAdvisor";

/** 离线替身：GCS 只有 objects 里的对象（其余一律 404）；数据库只有内存账本与 postProdJobs。 */
const objects = new Map<string, Buffer>();
const stat = vi.fn();
const download = vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
  const buffer = objects.get(gcsUri);
  if (!buffer) throw new Error("gcs_stat_failed:404");
  return { buffer, bucket: "test-bucket", objectName: gcsUri, generation: "3" };
});
vi.mock("./gcs", () => ({
  statGcsObjectVersion: (...args: unknown[]) => stat(...args),
  getGcsBucketName: () => "test-bucket",
  downloadGcsObjectVersioned: (...args: unknown[]) => download(...(args as [{ gcsUri: string }])),
  uploadBufferToGcs: vi.fn(), inspectGcsObjectBounded: vi.fn(), listGcsObjectNamesByPrefix: vi.fn(),
}));
vi.mock("./manhuaCloudDraftGcsStore", () => ({ manhuaCloudDraftGcsUri: (userId: number, projectId: string) => `gs://test/user-${userId}/${projectId}` }));
const dialect = new PgDialect();
const ledgers = new Map<string, { seed: number; claims: Record<string, "reserved" | "released"> }>();
const inserts: Array<{ id: string; input: unknown }> = [];
const postProdJobs: Array<{ userId: string; type: string; input: Record<string, unknown> }> = [];
const fakeDb = {
  execute: async () => undefined,
  select: () => ({ from: () => ({ where: (cond: SQL) => {
    const params = dialect.sqlToQuery(cond).params as string[];
    if (params[0]!.startsWith("mqp_")) { const ledger = ledgers.get(params[0]!); return Promise.resolve(ledger && params[1] ? [{ output: ledger }] : []); }
    const [userId, type, scopeKey] = params;
    const rows = postProdJobs.filter(j => j.userId === userId && j.type === type && j.input.action === "concat" && j.input.scopeKey === scopeKey).map(() => ({ id: "job" }));
    return { limit: async () => rows };
  } }) }),
  // 与 reserveAdvisorProjectQuota 的 UPSERT 同口径：已领同编号原样返回；seed + 已领 < 5 才领
  insert: () => ({ values: (v: { id: string; input: unknown; output: { claims: Record<string, string> } }) => ({ onConflictDoUpdate: () => ({ returning: async () => {
    inserts.push({ id: v.id, input: v.input });
    const requestId = Object.keys(v.output.claims)[0]!;
    const ledger = ledgers.get(v.id) ?? { seed: 0, claims: {} };
    if (!(requestId in ledger.claims) && ledger.seed + Object.values(ledger.claims).filter(c => c === "reserved").length < 5) ledger.claims[requestId] = "reserved";
    ledgers.set(v.id, ledger);
    return [{ output: ledger }];
  } }) }) }),
};
vi.mock("../db", () => ({ getDb: async () => fakeDb }));
import { advisorProjectQuotaId, assertAdvisorProject, readAdvisorProjectQuota, reserveAdvisorProjectQuota } from "./manhuaAdvisorProjectQuota";

const P = "7f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const oldLedgerId = (key: unknown[]) => `mqp_${createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 40)}`;
const dh = addDigitalHumanSegment(newDigitalHumanDraft("7", "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659"), "00000000-0000-4000-8000-000000000099");
const dhWorkId = dh.project?.id || dh.id;
const dhObject = "gs://test-bucket/digital-human-drafts/user-7/current.json";
beforeEach(() => {
  stat.mockReset(); stat.mockRejectedValue(new Error("gcs_stat_failed:404")); objects.clear(); ledgers.clear(); inserts.length = 0; postProdJobs.length = 0;
  objects.set(dhObject, Buffer.from(JSON.stringify({ format: "digital-human-draft-v1", owner: 7, updatedAt: "2026-11-10T00:00:00.000Z", draft: dh })));
});

describe("每作品额度账户隔离", () => {
  it("旧工作区只有一个桶；新作品和其他账户互不占用", () => {
    expect(advisorProjectQuotaId(7)).toBe(advisorProjectQuotaId(7, undefined));
    expect(new Set([advisorProjectQuotaId(7), advisorProjectQuotaId(7, "a"), advisorProjectQuotaId(7, "b"), advisorProjectQuotaId(8, "a")]).size).toBe(4);
  });
  it("作品存在校验使用登录用户路径，不接收另一用户身份", async () => {
    stat.mockResolvedValueOnce({ generation: "1" });
    await assertAdvisorProject(7, "a");
    expect(stat).toHaveBeenCalledWith({ gcsUri: "gs://test/user-7/a" });
    stat.mockRejectedValueOnce(new Error("404"));
    await expect(assertAdvisorProject(8, "a")).rejects.toThrow("本次未扣费");
  });
});

describe("按作品类型记额度", () => {
  it("漫剧旧账本编号完全不变（缺省与显式 manhua 同一编号）；新类型并入类型、各自独立；新类型缺作品编号拒绝", () => {
    expect(advisorProjectQuotaId(7, P)).toBe(oldLedgerId([7, P]));
    expect(advisorProjectQuotaId(7)).toBe(oldLedgerId([7, "legacy"]));
    expect(advisorProjectRef({ projectId: P, projectKind: "manhua" })).toBe(P);
    expect(advisorProjectRef({ projectId: P })).toBe(P);
    const ids = (["code_motion", "marketing", "digital_human"] as const).map(kind => advisorProjectQuotaId(7, advisorProjectRef({ projectId: P, projectKind: kind })));
    expect(ids).toEqual([oldLedgerId([7, "code_motion", P]), oldLedgerId([7, "marketing", P]), oldLedgerId([7, "digital_human", P])]);
    expect(new Set([advisorProjectQuotaId(7, P), ...ids]).size).toBe(4);
    expect(() => advisorProjectQuotaId(7, { kind: "code_motion" })).toThrow("缺少作品编号");
  });
  it("各类型独立计数：同一编号的代码动画用满 5 次，漫剧与营销仍各有 5 次；漫剧账本记录不带类型", async () => {
    const codeMotion = advisorProjectRef({ projectId: P, projectKind: "code_motion" });
    for (let i = 0; i < 5; i++) expect((await reserveAdvisorProjectQuota(7, codeMotion, `cm-${i}`)).reserved).toBe(true);
    expect(await reserveAdvisorProjectQuota(7, codeMotion, "cm-5")).toMatchObject({ reserved: false, used: 5, remaining: 0 });
    expect(await readAdvisorProjectQuota(7, codeMotion)).toEqual({ used: 5, remaining: 0, limit: 5 });
    expect(await readAdvisorProjectQuota(7, P)).toEqual({ used: 0, remaining: 5, limit: 5 });
    expect(await readAdvisorProjectQuota(7, advisorProjectRef({ projectId: P, projectKind: "marketing" }))).toEqual({ used: 0, remaining: 5, limit: 5 });
    expect(await reserveAdvisorProjectQuota(7, P, "mh-0")).toMatchObject({ reserved: true, used: 1, remaining: 4 });
    expect(inserts.at(-1)).toEqual({ id: oldLedgerId([7, P]), input: { action: "manhua_advisor_project_quota", projectId: P } });
    expect(inserts[0]).toEqual({ id: oldLedgerId([7, "code_motion", P]), input: { action: "manhua_advisor_project_quota", projectId: P, projectKind: "code_motion" } });
  });
  it("修复前现状：数字人作品按缺省（漫剧云稿）路径核对必然失败——缺省行为保持不变", async () => {
    await expect(assertAdvisorProject(7, dhWorkId)).rejects.toThrow("尚未确认这部作品的云端保存");
    expect(stat).toHaveBeenCalledWith({ gcsUri: `gs://test/user-7/${dhWorkId}` });
  });
  it("数字人：查 digital-human-drafts/user-{id}/current.json，作品编号一致才放行；别人的、别的编号、没有制作稿都拒绝", async () => {
    await expect(assertAdvisorProject(7, { kind: "digital_human", projectId: dhWorkId })).resolves.toBeUndefined();
    expect(download).toHaveBeenCalledWith({ gcsUri: dhObject });
    await expect(assertAdvisorProject(7, { kind: "digital_human", projectId: P })).rejects.toThrow("尚未确认这部数字人作品的云端保存");
    await expect(assertAdvisorProject(8, { kind: "digital_human", projectId: dhWorkId })).rejects.toThrow("本次未扣费");
    expect(stat).not.toHaveBeenCalled();
  });
  it("代码动画：查本人云端存档；不存在拒绝；存储暂不可用拒绝且说明可重试，均不扣费", async () => {
    stat.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
      if (gcsUri === `gs://test-bucket/code-motion/u7/projects/${P}.json`) return { generation: "9" };
      throw new Error("gcs_stat_failed:404");
    });
    await expect(assertAdvisorProject(7, { kind: "code_motion", projectId: P })).resolves.toBeUndefined();
    await expect(assertAdvisorProject(8, { kind: "code_motion", projectId: P })).rejects.toThrow("尚未确认这部代码动画的云端保存");
    stat.mockRejectedValueOnce(new Error("gcs_stat_failed:503"));
    await expect(assertAdvisorProject(7, { kind: "code_motion", projectId: P })).rejects.toThrow("暂时无法核对这部作品，请稍后重试；本次未扣费");
    await expect(assertAdvisorProject(7, { kind: "code_motion" })).rejects.toThrow("缺少作品编号");
  });
  it("营销：查本人该稿的成片后期任务（concat）；只有贴装任务、别人的成片、别的稿都拒绝", async () => {
    postProdJobs.push({ userId: "7", type: "post_prod", input: { action: "bgm_mount", scopeKey: `marketing:${P}` } });
    await expect(assertAdvisorProject(7, { kind: "marketing", projectId: P })).rejects.toThrow("这份营销稿还没有合成成片");
    postProdJobs.push({ userId: "8", type: "post_prod", input: { action: "concat", scopeKey: `marketing:${P}` } });
    await expect(assertAdvisorProject(7, { kind: "marketing", projectId: P })).rejects.toThrow("本次未扣费");
    postProdJobs.push({ userId: "7", type: "post_prod", input: { action: "concat", scopeKey: `marketing:${P}` } });
    await expect(assertAdvisorProject(7, { kind: "marketing", projectId: P })).resolves.toBeUndefined();
    await expect(assertAdvisorProject(7, { kind: "marketing", projectId: "00000000-0000-4000-8000-0000000000aa" })).rejects.toThrow("这份营销稿还没有合成成片");
  });
});

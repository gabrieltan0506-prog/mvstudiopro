import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ objects: new Map<string, { buffer: Buffer; generation: string }>(), failDelete: "", corruptArchive: false, reads: [] as string[], deleted: [] as string[] }));
vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  listGcsObjectNamesByPrefix: vi.fn(), downloadGcsObject: vi.fn(), uploadBufferToGcs: vi.fn(),
  downloadGcsObjectVersioned: async ({ gcsUri }: { gcsUri: string }) => {
    const name = gcsUri.replace("gs://test-bucket/", "");
    state.reads.push(name);
    const value = state.objects.get(name);
    if (!value) throw new Error("gcs_stat_failed:404");
    return { ...value, bucket: "test-bucket" };
  },
  uploadBufferToGcsIfAbsent: async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    if (state.objects.has(objectName)) return { created: false };
    state.objects.set(objectName, { buffer: state.corruptArchive && !objectName.includes("/locks/") ? Buffer.from("wrong") : buffer, generation: "9" });
    return { created: true };
  },
  deleteGcsObject: async ({ objectName, ifGenerationMatch }: { objectName: string; ifGenerationMatch: string }) => {
    if (state.failDelete === objectName) throw new Error("gcs_delete_failed:503");
    if (state.objects.get(objectName)?.generation !== ifGenerationMatch) throw new Error("gcs_delete_generation_conflict");
    state.deleted.push(objectName);
    state.objects.delete(objectName);
  },
}));
import { discardGcsManhuaViralProposal, retireNativeEpisodeTemplatesForRelearn } from "./manhuaViralTemplateStore";
const id = "tpl_native_abc-g38f_ep001";
const approved = `manhua-template-learn/approved/${id}.json`;
const proposal = `manhua-template-learn/proposals/${id}.json`;
const seed = (name: string, status: string) => {
  const buffer = Buffer.from(JSON.stringify({ id, status, reusableZh: "", sourceEvidence: "原稿永久保留" }));
  state.objects.set(name, { buffer, generation: "123" });
  return buffer;
};
beforeEach(() => { state.objects.clear(); state.failDelete = ""; state.corruptArchive = false; state.reads = []; state.deleted = []; });
describe("删除学习同步移除正式模板", () => {
  it("两份原字节先归档回读，然后按版本删除；不触碰付费证据", async () => {
    const originalApproved = seed(approved, "approved");
    const originalProposal = seed(proposal, "proposed");
    const evidence = "manhua-template-learn/segment-evidence/source.json";
    seed(evidence, "evidence");
    const result = await retireNativeEpisodeTemplatesForRelearn(id);
    expect(result.archivedObjectNames).toHaveLength(2);
    expect(state.objects.get(result.archivedObjectNames[0])?.buffer).toEqual(originalApproved);
    expect(state.objects.get(result.archivedObjectNames[1])?.buffer).toEqual(originalProposal);
    expect(state.reads).toEqual(expect.arrayContaining(result.archivedObjectNames));
    expect(state.deleted.slice(0, 2)).toEqual([approved, proposal]);
    expect(state.objects.has(evidence)).toBe(true);
  });
  it("待审删除入口同样移除对应正式模板", async () => {
    seed(approved, "approved"); seed(proposal, "proposed");
    const result = await discardGcsManhuaViralProposal(id);
    expect(result.id).toBe(id);
    expect(state.objects.has(approved)).toBe(false);
    expect(state.objects.has(proposal)).toBe(false);
  });
  it("只有正式模板也能删除；重复操作幂等", async () => {
    seed(approved, "approved");
    expect((await retireNativeEpisodeTemplatesForRelearn(id)).archivedObjectNames).toHaveLength(1);
    expect((await retireNativeEpisodeTemplatesForRelearn(id)).archivedObjectNames).toEqual([]);
  });
  it("第二份删除失败保留入口，重试完成剩余删除", async () => {
    seed(approved, "approved"); seed(proposal, "proposed");
    state.failDelete = proposal;
    await expect(retireNativeEpisodeTemplatesForRelearn(id)).rejects.toThrow("503");
    expect(state.objects.has(approved)).toBe(false);
    expect(state.objects.has(proposal)).toBe(true);
    state.failDelete = "";
    await retireNativeEpisodeTemplatesForRelearn(id);
    expect(state.objects.has(proposal)).toBe(false);
  });
  it("归档回读不一致则两份均不删除", async () => {
    seed(approved, "approved"); seed(proposal, "proposed"); state.corruptArchive = true;
    await expect(retireNativeEpisodeTemplatesForRelearn(id)).rejects.toThrow("归档内容校验失败");
    expect(state.objects.has(approved)).toBe(true); expect(state.objects.has(proposal)).toBe(true);
  });
  it("拒绝异卡身份，防止串删", async () => {
    state.objects.set(approved, { buffer: Buffer.from('{"id":"other"}'), generation: "123" });
    await expect(retireNativeEpisodeTemplatesForRelearn(id)).rejects.toThrow("身份不一致");
    expect(state.objects.has(approved)).toBe(true);
  });
});

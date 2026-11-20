import { expect, it, vi } from "vitest";
import { knowledgeDistillPreview } from "./handbookDistillPreview";
const batch = (i: number) => ({ index: i, source: { title: "t", pages: [{ id: `p${i}`, headline: `第${i}组`, body: `正文${i}`, imageUrl: "", role: "reading" }] }, sourceDigest: "a".repeat(64) });
function deps(files: Record<string, unknown>, plan: any = { jobId: "kc_x", batches: 5 }) {
  const read = vi.fn(async (name: string) => (name in files ? files[name] : null));
  const load = vi.fn(async () => ({ job: {}, plan }));
  return { read, load } as any;
}
const root = "knowledge-reading/user-7/kc_x";
it("按原顺序返回已落盘分组；遇缺口即停，不跳段", async () => {
  const d = deps({ [`${root}/batch-0/input.json`]: batch(0), [`${root}/batch-1/input.json`]: batch(1), [`${root}/batch-3/input.json`]: batch(3) });
  const out = await knowledgeDistillPreview(7, "kc_x", 0, d);
  expect(out.segments.map(s => s.index)).toEqual([0, 1]);
  expect(out.nextBatch).toBe(2);
  expect(out.kind).toBe("distilled");
  // 只读：除读档计划与分组输入外不访问其他对象
  expect(d.read.mock.calls.map((c: any[]) => c[0])).toEqual([`${root}/batch-0/input.json`, `${root}/batch-1/input.json`, `${root}/batch-2/input.json`]);
});
it("从上次位置增量读取，单次最多 8 组", async () => {
  const files = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${root}/batch-${i}/input.json`, batch(i)]));
  const out = await knowledgeDistillPreview(7, "kc_x", 4, deps(files, { jobId: "kc_x", batches: 20 }));
  expect(out.segments.map(s => s.index)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
});
it("非本人或非读档任务：计划加载拒绝，不读任何分组", async () => {
  const d = deps({}); d.load.mockRejectedValue(new Error("读档任务不存在或不属于当前账号"));
  await expect(knowledgeDistillPreview(8, "kc_x", 0, d)).rejects.toThrow("不属于当前账号");
  expect(d.read).not.toHaveBeenCalled();
});
it("存储读取失败：如实抛错（前台显示「预览暂未取回」，不影响提炼）", async () => {
  const d = deps({}); d.read.mockRejectedValue(new Error("gcs_download_failed:503"));
  await expect(knowledgeDistillPreview(7, "kc_x", 0, d)).rejects.toThrow("503");
});
it("分组身份不一致即拒绝；文件原稿标为原文预览", async () => {
  await expect(knowledgeDistillPreview(7, "kc_x", 0, deps({ [`${root}/batch-0/input.json`]: batch(3) }))).rejects.toThrow("身份不一致");
  const out = await knowledgeDistillPreview(7, "kc_x", 0, deps({ [`${root}/batch-0/input.json`]: batch(0) }, { jobId: "kc_x", batches: 1, rawSources: [{ key: "k", digest: "d" }] }));
  expect(out.kind).toBe("source");
});

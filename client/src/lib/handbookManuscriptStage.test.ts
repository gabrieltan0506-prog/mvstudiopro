import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { handbookManuscriptDigest, handbookManuscriptNeedsStaging, handbookManuscriptPageBody, stageHandbookManuscript, __resetHandbookManuscriptStageForTest } from "./handbookManuscriptStage";
const big = "知".repeat(450_001);
beforeEach(() => __resetHandbookManuscriptStageForTest());
it("摘要与服务端一致（sha256/utf8）；20 万字及以下不走暂存", async () => {
  expect(await handbookManuscriptDigest(big)).toBe(createHash("sha256").update(big, "utf8").digest("hex"));
  expect(handbookManuscriptNeedsStaging("知".repeat(200_000))).toBe(false);
  expect(handbookManuscriptNeedsStaging("知".repeat(200_001))).toBe(true);
});
it("按 20 万字切段、顺序上传后封存；拼回即原稿", async () => {
  const chunks: any[] = [];
  const api = { stageChunk: vi.fn(async (c: any) => { chunks.push(c); }), finalize: vi.fn(async () => {}) };
  const digest = await stageHandbookManuscript(big, api);
  expect(chunks.map(c => c.text.length)).toEqual([200_000, 200_000, 50_001]);
  expect(chunks.map(c => c.text).join("")).toBe(big);
  expect(api.finalize).toHaveBeenCalledWith({ digest, count: 3, totalChars: big.length });
});
it("第 2 段上传失败：不封存、整体失败；再次调用补齐后封存", async () => {
  let n = 0;
  const api = { stageChunk: vi.fn(async () => { if (++n === 2) throw new Error("网络中断"); }), finalize: vi.fn(async () => {}) };
  await expect(stageHandbookManuscript(big, api)).rejects.toThrow("网络中断");
  expect(api.finalize).not.toHaveBeenCalled();
  await expect(stageHandbookManuscript(big, api)).resolves.toMatch(/^[a-f0-9]{64}$/);
  expect(api.finalize).toHaveBeenCalledTimes(1);
  // 已封存：同会话再用不重复上传
  await stageHandbookManuscript(big, api);
  expect(api.stageChunk).toHaveBeenCalledTimes(5);
});
it("逐页出图同一本稿：摘要与分页各只算一次；换稿后重算", async () => {
  const digestSpy = vi.spyOn(crypto.subtle, "digest");
  const api = { stageChunk: vi.fn(async () => {}), finalize: vi.fn(async () => {}) };
  const { planKnowledgeCardPages } = await import("@shared/knowledgeCardPagination");
  const text = `# 书\n\n${Array.from({ length: 400 }, (_, i) => `## 第${i}节\n${"知".repeat(1100)}`).join("\n\n")}`;
  const pages = planKnowledgeCardPages(text).pages;
  for (let i = 1; i <= 5; i++) {
    await stageHandbookManuscript(text, api);
    expect(handbookManuscriptPageBody(text, i)).toBe(pages[i - 1]);
  }
  expect(digestSpy).toHaveBeenCalledTimes(1);
  expect(handbookManuscriptPageBody(text, pages.length + 1)).toBe("");
  const other = text.replace("# 书", "# 另一本");
  await stageHandbookManuscript(other, api);
  expect(digestSpy).toHaveBeenCalledTimes(2);
  expect(handbookManuscriptPageBody(other, 1)).toBe(planKnowledgeCardPages(other).pages[0]);
  digestSpy.mockRestore();
});
it("出图前准备：上传进度逐段回报 a/b，分片内容与顺序不变；步骤文案与失败句", async () => {
  const { handbookPrepareStepLabel, handbookPrepareFailureMessage } = await import("./handbookManuscriptStage");
  const seen: string[] = [], order: number[] = [];
  const api = { stageChunk: vi.fn(async (c: any) => { order.push(c.index); }), finalize: vi.fn(async () => {}) };
  await stageHandbookManuscript(big, api, (a, b) => seen.push(`${a}/${b}`));
  expect(seen).toEqual(["0/3", "1/3", "2/3", "3/3"]);
  expect(order).toEqual([0, 1, 2]);
  expect(handbookPrepareStepLabel("上传大稿并报价", "已上传 1/3 段")).toBe("出图前准备 第 2/7 步：上传大稿并报价（已上传 1/3 段）");
  expect(handbookPrepareFailureMessage("保存云端稿件并报价", "网络中断")).toBe("出图前准备第 6 步（保存云端稿件并报价）未完成，尚未出图、未扣费：网络中断");
});

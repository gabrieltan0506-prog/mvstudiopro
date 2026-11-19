import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { handbookManuscriptDigest, handbookManuscriptNeedsStaging, stageHandbookManuscript, __resetHandbookManuscriptStageForTest } from "./handbookManuscriptStage";
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

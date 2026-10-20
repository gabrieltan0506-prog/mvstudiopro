import { describe, expect, it, vi } from "vitest";
import { COVER_DESIGNS, selectedCoverCandidate, type CoverCandidateSet } from "../../shared/platformCoverCandidates";
import { runCoverCandidates, type CoverCandidateDeps } from "./platformCoverCandidates";

function fixture(): CoverCandidateSet {
  return { version: 1, jobId: "cover-test", sceneId: "scene1", selectedId: null, candidates: COVER_DESIGNS.map(d => ({ id: d.id, label: d.label, status: "pending", billing: "pending" })) };
}
function deps(): CoverCandidateDeps {
  return { save: vi.fn(async () => {}), charge: vi.fn(async () => {}), refund: vi.fn(async () => {}),
    generate: vi.fn(async direction => `https://test.invalid/${encodeURIComponent(direction)}.png`),
    grade: vi.fn(async (url, style) => ({ originalUrl: url, imageUrl: `gs://test/graded/${style}.png`, receiptUrl: `gs://test/graded/${style}.json` })) };
}
describe("三候选持久化与恢复", () => {
  it("三个不同构图真实调用生产者与后期，完成后也不自动采用", async () => {
    const d = deps(), output = await runCoverCandidates(fixture(), d);
    expect(d.generate).toHaveBeenCalledTimes(3);
    expect(new Set(vi.mocked(d.generate).mock.calls.map(c => c[0])).size).toBe(3);
    expect(d.grade).toHaveBeenCalledTimes(3);
    expect(output.candidates.every(c => c.status === "ready" && c.originalUrl && c.receiptUrl)).toBe(true);
    expect(selectedCoverCandidate(output)).toBeNull();
    const saves = vi.mocked(d.save).mock.calls.map(c => c[0]);
    expect(saves[0].candidates[0].status).toBe("generating");
    expect(saves.some(s => s.candidates[0].status === "grading" && s.candidates[0].originalUrl)).toBe(true);
  });
  it("已完成项不重画，后期失败只重跑后期", async () => {
    const d = deps(); vi.mocked(d.grade).mockRejectedValueOnce(new Error("storage unavailable"));
    const first = await runCoverCandidates(fixture(), d);
    expect(first.candidates[0].status).toBe("grading");
    const resume = deps(), final = await runCoverCandidates(first, resume);
    expect(resume.generate).not.toHaveBeenCalled(); expect(resume.charge).not.toHaveBeenCalled();
    expect(resume.grade).toHaveBeenCalledTimes(1); expect(final.candidates.every(c => c.status === "ready")).toBe(true);
  });
  it("提交中断状态不重投，失败项幂等退款且不丢其他候选", async () => {
    const set = fixture(); set.candidates[0].status = "generating"; set.candidates[0].billing = "charged";
    const d = deps(), result = await runCoverCandidates(set, d);
    expect(d.generate).toHaveBeenCalledTimes(2); expect(d.refund).toHaveBeenCalledWith("story");
    expect(result.candidates[0].status).toBe("uncertain");
    const next = deps(); await runCoverCandidates(result, next);
    expect(next.generate).not.toHaveBeenCalled(); expect(next.refund).not.toHaveBeenCalled();
  });
  it("写入提交意图失败时不调用模型、不扣费", async () => {
    const d = deps(); vi.mocked(d.save).mockRejectedValue(new Error("db unavailable"));
    await expect(runCoverCandidates(fixture(), d)).rejects.toThrow("db unavailable");
    expect(d.generate).not.toHaveBeenCalled(); expect(d.charge).not.toHaveBeenCalled();
  });
  it("一张失败只退该张，退款失败保留待恢复状态", async () => {
    const d = deps(); vi.mocked(d.generate).mockRejectedValueOnce(new Error("provider fail")); vi.mocked(d.refund).mockRejectedValueOnce(new Error("db fail"));
    const result = await runCoverCandidates(fixture(), d);
    expect(result.candidates[0].billing).toBe("refund_pending");
    expect(result.candidates.filter(c => c.status === "ready")).toHaveLength(2);
    const restore = deps(); const final = await runCoverCandidates(result, restore);
    expect(restore.generate).not.toHaveBeenCalled(); expect(restore.refund).toHaveBeenCalledTimes(1);
    expect(final.candidates[0].billing).toBe("refunded");
  });
});

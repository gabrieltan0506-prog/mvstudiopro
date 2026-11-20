import { describe, expect, it } from "vitest";
import { knowledgeSkipsPostReviewConsistency, knowledgeSourceFromEditionManuscript } from "./knowledgePublicationAdvisor";

const root = "r";
const reader = (existing: string[]) => async (name: string) => (existing.includes(name) ? {} : null);
const edition = { readingContract: "image-primary-v1", pages: [{ knowledgeRole: "illustration", supplement: "图外内文" }, { knowledgeRole: "illustration" }] };
const legacy = { readingContract: "image-primary-v1", pages: [{ knowledgeRole: "illustration" }, { knowledgeRole: "illustration" }] };

describe("审校后是否跳过重复的全册核对", () => {
  it("已带核实标记的稿：行为不变（无计划则跳过，已有计划沿用旧流程）", async () => {
    expect(await knowledgeSkipsPostReviewConsistency({ verificationJobId: "kc_x" }, root, reader([]))).toBe(true);
    expect(await knowledgeSkipsPostReviewConsistency({ verificationJobId: "kc_x" }, root, reader(["r/consistency-plan.json"]))).toBe(false);
  });
  it("两档成稿出图、没带核实标记（回填的大书）：跳过；计划已落盘但第一组无结果也跳过", async () => {
    expect(knowledgeSourceFromEditionManuscript(edition)).toBe(true);
    expect(await knowledgeSkipsPostReviewConsistency(edition, root, reader([]))).toBe(true);
    expect(await knowledgeSkipsPostReviewConsistency(edition, root, reader(["r/consistency-plan.json"]))).toBe(true);
  });
  it("两档成稿但旧流程已有核对结果：沿用旧流程，不改已产出的回执", async () => {
    expect(await knowledgeSkipsPostReviewConsistency(edition, root, reader(["r/consistency-plan.json", "r/consistency-0/report.json"]))).toBe(false);
  });
  it("按字数分页的旧稿、文字页混排稿、无合同稿：不跳过", async () => {
    expect(await knowledgeSkipsPostReviewConsistency(legacy, root, reader([]))).toBe(false);
    expect(await knowledgeSkipsPostReviewConsistency({ readingContract: "image-primary-v1", pages: [{ knowledgeRole: "reading", supplement: "x" }, { knowledgeRole: "illustration", supplement: "y" }] }, root, reader([]))).toBe(false);
    expect(await knowledgeSkipsPostReviewConsistency({ pages: edition.pages }, root, reader([]))).toBe(false);
    expect(await knowledgeSkipsPostReviewConsistency({}, root, reader([]))).toBe(false);
  });
});

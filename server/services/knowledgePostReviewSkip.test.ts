import { describe, expect, it } from "vitest";
import { knowledgeSkipsPostReviewConsistency, knowledgeSourceFromEditionManuscript } from "./knowledgePublicationAdvisor";
import { knowledgeSourceSchema } from "../../shared/knowledgePublication";

const root = "r";
const reader = (existing: string[]) => async (name: string) => (existing.includes(name) ? {} : null);
const edition = { readingContract: "image-primary-v1" as const, pages: [{ role: "illustration" as const, supplement: "图外内文" }, { role: "illustration" as const }] };
const legacy = { readingContract: "image-primary-v1" as const, pages: [{ role: "illustration" as const }, { role: "illustration" as const }] };

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
    expect(await knowledgeSkipsPostReviewConsistency({ readingContract: "image-primary-v1" as const, pages: [{ role: "reading" as const, supplement: "x" }, { role: "illustration" as const, supplement: "y" }] }, root, reader([]))).toBe(false);
    expect(await knowledgeSkipsPostReviewConsistency({ pages: edition.pages }, root, reader([]))).toBe(false);
    expect(await knowledgeSkipsPostReviewConsistency({}, root, reader([]))).toBe(false);
  });
  it("按线上云稿原稿页的真实结构（经原稿合同解析，字段为 role）：回填的两档成稿被识别并跳过", async () => {
    // 1121 实测线上稿：source 键 = title/detailLevel/reviewBatchMode/readingContract/pages；页键 = id/headline/body/supplement/imageUrl/imageJobId/role。
    const page = (n: number) => ({ id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, headline: `第${n}章`, body: "图中要点", supplement: "图外内文", imageUrl: "", imageJobId: `job_${n}`, role: "illustration" as const });
    const source = knowledgeSourceSchema.parse({ title: "书", detailLevel: "full", reviewBatchMode: "ready-images", readingContract: "image-primary-v1" as const, pages: [page(1), page(2)] });
    expect(knowledgeSourceFromEditionManuscript(source)).toBe(true);
    expect(await knowledgeSkipsPostReviewConsistency(source, root, reader(["r/consistency-plan.json"]))).toBe(true);
    expect(await knowledgeSkipsPostReviewConsistency(source, root, reader(["r/consistency-plan.json", "r/consistency-0/report.json"]))).toBe(false);
  });
});

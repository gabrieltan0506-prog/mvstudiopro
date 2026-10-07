import { expect, it, vi } from "vitest";
const { indexed, legacy, list } = vi.hoisted(() => ({ indexed: vi.fn(), legacy: vi.fn(), list: vi.fn() }));
vi.mock("./manhuaAdvisorKnowledge", () => ({ resolveManhuaAdvisorKnowledgeTemplate: indexed }));
vi.mock("./manhuaViralTemplateStore", () => ({ resolveViralTemplateForExpand: legacy, listMergedApprovedManhuaViralTemplates: list }));
import { buildManhuaTemplateAdvisorReference } from "./manhuaTemplateAdvisorReference";
import { TEMPLATE_CATALOG_REQUEST_MARKER } from "../../shared/manhuaTemplateCraft";
const card = { id: "tpl_private", publicCode: "A123", nameZh: "PrivateSource", laneZh: "古言种田", status: "approved", summaryZh: "所选卡真实手法", beatGrid: [] };
it("specific IDs use knowledge index while explicit catalog marker retains original full-catalog path", async () => {
  indexed.mockResolvedValue({ card, appliedTemplate: { publicId: "mt_a123", nameZh: "匿名模板" }, resolution: "indexed" });
  const reference = await buildManhuaTemplateAdvisorReference("模板编号 A123");
  expect(reference).toContain("所选卡真实手法"); expect(indexed).toHaveBeenCalledWith("mt_a123");
  expect(legacy).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  indexed.mockClear();
  list.mockResolvedValue([card, { ...card, publicCode: "B456" }, { ...card, publicCode: "C789" }]);
  expect(await buildManhuaTemplateAdvisorReference(TEMPLATE_CATALOG_REQUEST_MARKER)).toContain("mt_c789");
  expect(list).toHaveBeenCalledTimes(1); expect(indexed).not.toHaveBeenCalled();
});
it("changed indexed version stops before advice with an explicit refresh instruction", async () => {
  indexed.mockResolvedValue({ error: "refresh_required" });
  await expect(buildManhuaTemplateAdvisorReference("模板编号 A123")).rejects.toThrow("刷新知识目录");
});

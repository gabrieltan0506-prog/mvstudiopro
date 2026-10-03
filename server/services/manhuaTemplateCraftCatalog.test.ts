import { expect, it } from "vitest";
import {
  buildTemplateCraftCatalog,
  buildNovelStageCraftCatalog,
  formatTemplateCraftCatalog,
} from "./manhuaTemplateCraftCatalog";
import { craftFixture } from "../../shared/testFixtures/manhuaTemplateCraft";
it("84张手法与未被索引归纳的内容全部进入服务端目录，版本摘要随内容变化", () => {
  const cards = Array.from({ length: 84 }, (_, i) =>
    craftFixture({
      id: `tpl_${i}`,
      publicCode: (1000 + i).toString(),
      reusableZh: `第${i}份独特方法，以道具毁损推动关系转折。`,
    })
  );
  const a = buildTemplateCraftCatalog(cards);
  expect(a.count).toBe(84);
  expect(a.catalog[83].methods).toContain("第83份");
  expect(formatTemplateCraftCatalog(a.catalog)).toContain("第83份");
  expect(formatTemplateCraftCatalog(a.catalog)).not.toContain("tpl_83");
  expect(
    buildTemplateCraftCatalog([
      { ...cards[0], reusableZh: "不同方法" },
      ...cards.slice(1),
    ]).sha256
  ).not.toBe(a.sha256);
});
it("重复编号、超容量明确拒绝，不静默截取", () => {
  expect(() =>
    buildTemplateCraftCatalog([craftFixture(), craftFixture()])
  ).toThrow("编号重复");
  expect(() =>
    buildTemplateCraftCatalog([
      craftFixture({ reusableZh: "甲".repeat(300001) }),
    ])
  ).toThrow("未截断");
});

it("推荐排除已选，小说与单模板剧本不灌入其他模板方法", () => {
  const cards = [
    craftFixture(),
    craftFixture({ publicCode: "B456", reusableZh: "另一份未选手法" }),
  ];
  const input = {
    stage: "advice",
    templates: [{ publicId: "mt_a123" }],
    selectedTemplateIds: ["mt_a123"],
  };
  expect(
    buildNovelStageCraftCatalog(cards, input).catalog.map(c => c.publicId)
  ).toEqual(["mt_b456"]);
  for (const stage of ["outline", "chapter", "script"]) {
    const catalog = buildNovelStageCraftCatalog(cards, { ...input, stage });
    expect(catalog.catalog.map(c => c.publicId)).toEqual(["mt_a123"]);
    expect(JSON.stringify(catalog)).not.toContain("另一份未选手法");
  }
});

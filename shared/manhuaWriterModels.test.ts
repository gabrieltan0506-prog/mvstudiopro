import { expect, it } from "vitest";
import { MANHUA_WRITER_MODELS, manhuaWriterExpansionQuote } from "./manhuaWriterModels";
it("两模型名称不含版本，三集均报价18，局部扩写只收实际改写集", () => {
  // 1111 新增线路三（见下方用例）；线路一 / 二名称不变
  expect(MANHUA_WRITER_MODELS.map(x => x.label).slice(0, 2)).toEqual(["线路一", "线路二"]);
  expect(manhuaWriterExpansionQuote(3)).toEqual({ episodes: 3, credits: 18 });
  expect(manhuaWriterExpansionQuote(3, 2)).toEqual({ episodes: 2, credits: 12 });
  expect(manhuaWriterExpansionQuote(6, 6)).toEqual({ episodes: 1, credits: 6 });
  expect(manhuaWriterExpansionQuote(3, 12)).toEqual({ episodes: 1, credits: 6 });
});
it("新扩写报价至少三集且可增加；旧两集稿不修改", () => {
  expect(manhuaWriterExpansionQuote(2)).toEqual({episodes:3,credits:18});
  expect(manhuaWriterExpansionQuote(4)).toEqual({episodes:4,credits:24});
  expect(manhuaWriterExpansionQuote(6)).toEqual({episodes:6,credits:36});
});

it("1111 线路三：中性叫法、单独计价（占位 25 积分/集，待站长定价）；线路一 / 二仍 6 分不变", async () => {
  const { manhuaWriterModelLabel, manhuaWriterEpisodeCredits, manhuaWriterAuxModel, MANHUA_WRITER_CARBON_EPISODE_CREDITS, MANHUA_WRITER_MODEL_HINTS } = await import("./manhuaWriterModels");
  expect(MANHUA_WRITER_MODELS.map(x => [x.id, x.label])).toEqual([["glm", "线路一"], ["deepseek", "线路二"], ["carbon", "线路三"]]);
  expect(manhuaWriterModelLabel("carbon")).toBe("线路三");
  expect(MANHUA_WRITER_CARBON_EPISODE_CREDITS).toBe(25);
  expect(manhuaWriterEpisodeCredits("carbon")).toBe(25);
  expect(manhuaWriterEpisodeCredits("glm")).toBe(6);
  expect(manhuaWriterExpansionQuote(3, 0, "carbon")).toEqual({ episodes: 3, credits: 75 });
  expect(manhuaWriterExpansionQuote(6, 5, "carbon")).toEqual({ episodes: 2, credits: 50 });
  expect(manhuaWriterExpansionQuote(3, 0, "deepseek")).toEqual({ episodes: 3, credits: 18 });
  // 其他文字步骤只走线路一 / 二
  expect(manhuaWriterAuxModel("carbon")).toBe("glm");
  expect(manhuaWriterAuxModel("deepseek")).toBe("deepseek");
  expect(Object.values(MANHUA_WRITER_MODEL_HINTS).join("")).not.toMatch(/gemini|carbon|glm|deepseek|evolink|vertex/i);
});

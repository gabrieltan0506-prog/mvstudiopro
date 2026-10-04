import { expect, it } from "vitest";
import { MANHUA_WRITER_MODELS, manhuaWriterExpansionQuote } from "./manhuaWriterModels";
it("两模型名称不含版本，三集均报价18，局部扩写只收实际改写集", () => {
  expect(MANHUA_WRITER_MODELS.map(x => x.label)).toEqual(["GLM", "DeepSeek"]);
  expect(manhuaWriterExpansionQuote(3)).toEqual({ episodes: 3, credits: 18 });
  expect(manhuaWriterExpansionQuote(3, 2)).toEqual({ episodes: 2, credits: 12 });
  expect(manhuaWriterExpansionQuote(6, 6)).toEqual({ episodes: 1, credits: 6 });
  expect(manhuaWriterExpansionQuote(3, 12)).toEqual({ episodes: 1, credits: 6 });
});

import { describe, expect, it } from "vitest";
import {
  defaultManhuaDeliveryPackage,
  formatManhuaDeliveryPackageMarkdown,
  summarizeManhuaDeliveryPackageProgress,
} from "./manhuaDeliveryPackage";
import {
  formatCineVocabInjectBlock,
  formatCineVocabMultilingualTable,
  MANHUA_CINE_VOCAB_BANK,
} from "./manhuaCineVocabBank";

describe("manhuaDeliveryPackage + multilingual vocab", () => {
  it("builds delivery markdown with color/subtitle/dubbing", () => {
    const pkg = defaultManhuaDeliveryPackage({
      seriesTitle: "雪关同心局",
      episodeIndexes: [1, 2],
    });
    const md = formatManhuaDeliveryPackageMarkdown(pkg);
    expect(md).toContain("成色交接");
    expect(md).toContain("ACES");
    expect(md).toContain("字幕");
    expect(md).toContain("配音");
    expect(summarizeManhuaDeliveryPackageProgress(pkg).done).toBeGreaterThan(0);
  });

  it("exposes full multilingual cine vocab", () => {
    expect(MANHUA_CINE_VOCAB_BANK.every((e) => e.ja && e.ko && e.es && e.ru)).toBe(true);
    const inject = formatCineVocabInjectBlock(["mv_push", "lt_rim"], "ja");
    expect(inject).toContain("日本語");
    expect(inject).toContain("ゆっくり寄る");
    const table = formatCineVocabMultilingualTable(["sz_cu"]);
    expect(table).toContain("| zh | en | ja | ko | es | ru |");
    expect(table).toContain("特写");
  });
});

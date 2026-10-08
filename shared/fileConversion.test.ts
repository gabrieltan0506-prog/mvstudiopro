import { describe, expect, it } from "vitest";
import { assertConversionSource, conversionBilling, fileConversionFormat, validateConversionFile } from "./fileConversion";
const source = { objectName: "file-conversion/u7/sources/fixture", generation: "123", sha256: "a".repeat(64), bytes: 12, fileName: "sample.pdf" };
describe("文件转换格式与付费边界", () => {
  it("正常原件免费，不能通过配置启用未定扫描费率", () => {
    expect(conversionBilling(1, false)).toMatchObject({ credits: 0, available: true });
    expect(conversionBilling(1, true)).toMatchObject({ credits: null, available: false, billableMb: 1, rateCreditsPerMb: null });
    expect(conversionBilling(1_000_001, true).billableMb).toBe(2);
  });
  it("没有自创的整文件MB业务上限", () => {
    expect(validateConversionFile("pdf-docx", "book.PDF", 2 ** 32).to).toBe("docx");
  });
  it("拒绝未知格式、伪造扩展名、空文件和无效字节", () => {
    expect(() => fileConversionFormat("exe-pdf")).toThrow();
    expect(() => validateConversionFile("pdf-docx", "sample.exe", 12)).toThrow();
    for (const size of [0, -1, NaN, Infinity, 1.5]) expect(() => validateConversionFile("pdf-docx", "sample.pdf", size)).toThrow();
  });
  it("来源隔离用户、拒绝穿越/外链/版本丢失", () => {
    expect(() => assertConversionSource(source, "7", "pdf-docx")).not.toThrow();
    expect(() => assertConversionSource(source, "8", "pdf-docx")).toThrow();
    for (const objectName of ["https://example.invalid/a", "file-conversion/u7/sources/../u8/source", "file-conversion/u70/sources/x"])
      expect(() => assertConversionSource({ ...source, objectName }, "7", "pdf-docx")).toThrow();
    expect(() => assertConversionSource({ ...source, generation: "" }, "7", "pdf-docx")).toThrow();
  });
  it("仅检查阶段允许尚未计算摘要，转换必须携带真实摘要", () => {
    expect(() => assertConversionSource({ ...source, sha256: "" }, "7", "pdf-docx", true)).not.toThrow();
    expect(() => assertConversionSource({ ...source, sha256: "" }, "7", "pdf-docx")).toThrow();
  });
});

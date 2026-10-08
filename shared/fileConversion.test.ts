import { describe, expect, it } from "vitest";
import { assertConversionSource, conversionBilling, fileConversionFormat, validateConversionFile } from "./fileConversion";
const source = { objectName: "file-conversion/u7/sources/fixture", generation: "123", sha256: "a".repeat(64), bytes: 12, fileName: "sample.pdf" };
describe("文件转换格式与付费边界", () => {
  it("普通原件免费，扫描识别不能借免费车道收费或运行", () => {
    expect(conversionBilling(1, false)).toMatchObject({ credits: 0, available: true });
    expect(conversionBilling(1, true)).toMatchObject({ credits: null, available: false, billableMb: 1, rateCreditsPerMb: 0.2 });
    expect(conversionBilling(1_000_001, true).billableMb).toBe(2);
  });
  it("已批准普通价4积分，扫描按原报价取整后翻倍，边界不多收少收", () => {
    expect(conversionBilling(1, false, "paid")).toMatchObject({ credits: 4, available: true });
    for (let mb = 1; mb <= 200; mb++) {
      expect(conversionBilling(mb * 1_000_000, true, "paid").credits).toBe(Math.max(2, Math.ceil(mb / 10)) * 2);
    }
    for (const [bytes, credits] of [[20_000_000, 4], [20_000_001, 6], [30_000_000, 6], [30_000_001, 8], [100_000_000, 20]]) {
      expect(conversionBilling(bytes!, true, "paid").credits).toBe(credits);
    }
  });
  it("报价缺失或无效时保持付费关闭，最终扣整数积分", () => {
    const pending = { version: "test-pending", standardCredits: null, scanCreditsPerMb: null };
    expect(conversionBilling(1, false, "paid", pending)).toMatchObject({ available: false, credits: null });
    expect(conversionBilling(1, true, "paid", pending)).toMatchObject({ available: false, credits: null });
    expect(conversionBilling(1, false, "paid", { ...pending, standardCredits: 1.5 }).available).toBe(false);
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

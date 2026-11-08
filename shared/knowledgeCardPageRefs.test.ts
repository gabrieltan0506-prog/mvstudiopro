import { describe, expect, it } from "vitest";
import { normalizeKnowledgeCardPageRefs, stripKnowledgeCardPageRefs } from "./knowledgeCardPageRefs";

const key = "0123456789abcdef";
describe("参考原页标记（2026-11-08 敦煌本真实回包）", () => {
  it("单一原文件：占位符docKey、书名与区间规范为真实身份逐页标记，正文不变", () => {
    const text = "正文甲\n〔参考原页 docKey:p6-p7〕\n正文乙〔参考原页《我心归处是敦煌》p65–66〕";
    const out = normalizeKnowledgeCardPageRefs(text, [key]);
    expect(out).toBe(`正文甲\n〔参考原页 ${key}:p6,p7〕\n正文乙〔参考原页 ${key}:p65,p66〕`);
  });
  it("已有真实身份沿用；多份原文件且身份不明的标记丢弃，不臆测", () => {
    expect(normalizeKnowledgeCardPageRefs(`〔参考原页 ${key}:p3〕`, [key, "fedcba9876543210"])).toBe(`〔参考原页 ${key}:p3〕`);
    expect(normalizeKnowledgeCardPageRefs("〔参考原页 docKey:p3〕", [key, "fedcba9876543210"])).toBe("");
    expect(normalizeKnowledgeCardPageRefs("〔参考原页 docKey:见下〕", [key])).toBe("");
  });
  it("任何形态的标记都不印到读者正文/生图输入", () => {
    expect(stripKnowledgeCardPageRefs("甲〔参考原页 docKey:p6-p7〕乙〔参考原页《书》p1–2〕丙")).toBe("甲乙丙");
  });
});

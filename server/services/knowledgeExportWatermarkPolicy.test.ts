import { describe, expect, it } from "vitest";
import { knowledgeExportAppliesWatermark as applies, knowledgeExportWatermarkPolicyFor as policy } from "./knowledgeExportWatermarkPolicy";

describe("图文手册成品水印规则", () => {
  it("一般用户：照打，勾「去水印」也不生效", () => {
    const p = policy({ supervisor: false, paid: false });
    expect(p).toEqual({ watermarkByDefault: true, canRemove: false });
    expect(applies(p)).toBe(true); expect(applies(p, true)).toBe(true);
  });
  it("付费用户：不打", () => {
    const p = policy({ supervisor: false, paid: true });
    expect(applies(p)).toBe(false); expect(applies(p, false)).toBe(false);
  });
  it("站长/督导：默认照打（宣传），勾「去水印」才去掉", () => {
    const p = policy({ supervisor: true, paid: false });
    expect(applies(p)).toBe(true); expect(applies(p, false)).toBe(true); expect(applies(p, true)).toBe(false);
  });
});

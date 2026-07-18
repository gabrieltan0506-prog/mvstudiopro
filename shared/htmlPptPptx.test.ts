import { describe, expect, it } from "vitest";
import { buildDefaultHtmlPptPages } from "./htmlPptMaker";
import { buildHtmlPptPptxBlob } from "./htmlPptPptx";

describe("buildHtmlPptPptxBlob", () => {
  it("exports an editable pptx blob from the same page list", async () => {
    const pages = buildDefaultHtmlPptPages("市场汇报", 10, "数据洞察", "ivory_academic").map(
      (p, i) =>
        i === 1
          ? {
              ...p,
              series: [
                { label: "关键爆品", value: 42 },
                { label: "市场规模", value: 168 },
              ],
            }
          : p,
    );
    const blob = await buildHtmlPptPptxBlob({
      title: "市场汇报",
      styleId: "ivory_academic",
      pages,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(2000);
    expect(blob.type).toMatch(/presentation|zip|octet-stream|empty/);
  });
});

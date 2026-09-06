import { describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ fail: true }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (url: URL) => {
    if (io.fail) throw new Error("test-asset-missing");
    return url.pathname.endsWith(".css") ? ".notebook{}" : Buffer.from("89504e470d0a1a0a", "hex");
  }),
}));
import { nativeReportThemePresentation } from "./manhuaNativeReportTheme";
describe("插画缺失不可静默导出空壳，恢复资源后可重试", () => {
  it("读取失败向上抛出且清除失败缓存", async () => {
    await expect(nativeReportThemePresentation({ episodeIndex: 1 })).rejects.toThrow("报告主题资源暂不可用");
    io.fail = false;
    const result = await nativeReportThemePresentation({ episodeIndex: 1 });
    expect(result.id).toBe("celadon");
    expect(result.imageDataUri).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});

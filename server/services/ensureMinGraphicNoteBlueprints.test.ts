import { describe, expect, it } from "vitest";
import { ensureMinGraphicNoteBlueprints } from "../../shared/ensureMinGraphicNoteBlueprints";

describe("ensureMinGraphicNoteBlueprints", () => {
  it("不足 3 条图文时从尾部补齐，并同步小红书 variant", () => {
    const input = [
      { title: "a", format: "短视频", platformVariants: [{ platform: "xiaohongshu", format: "短视频", reuseMainCopy: true }] },
      { title: "b", format: "短视频", platformVariants: [{ platform: "xiaohongshu", format: "短视频" }] },
      { title: "c", format: "图文", platformVariants: [{ platform: "xiaohongshu", format: "图文" }] },
      { title: "d", format: "短视频", suitablePlatforms: ["B站"] },
      { title: "e", format: "短视频" },
      { title: "f", format: "短视频" },
    ];
    const out = ensureMinGraphicNoteBlueprints(input as any, 3);
    const graphic = out.filter((b) => String(b.format).includes("图文"));
    expect(graphic.length).toBeGreaterThanOrEqual(3);
    const last = out[out.length - 1]!;
    expect(String(last.format)).toContain("图文");
    const xhs = (last.platformVariants as any[])?.find((v) => v.platform === "xiaohongshu");
    if (xhs) {
      expect(String(xhs.format)).toContain("图文");
      expect(xhs.reuseMainCopy).toBe(false);
    }
  });
});

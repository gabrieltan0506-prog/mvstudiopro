import { describe, expect, it } from "vitest";
import { hasPhotorealReferenceUrl, isPhotorealReferenceUrl } from "./photorealMediaSignal";

describe("photoreal 参考素材信号", () => {
  it("命中素材库三种路径形态", () => {
    expect(
      isPhotorealReferenceUrl("https://x/manhua-characters/photoreal/hero_sheet.jpg"),
    ).toBe(true);
    expect(isPhotorealReferenceUrl("https://x/photoreal-age/a.png?sig=1")).toBe(true);
    expect(isPhotorealReferenceUrl("https://x/photoreal-gen/b.webp")).toBe(true);
  });

  it("纯写实风格/CG 素材不误判", () => {
    expect(isPhotorealReferenceUrl("https://x/manhua-characters/cg_drama/a.jpg")).toBe(false);
    expect(isPhotorealReferenceUrl("https://x/photorealistic-style.jpg")).toBe(false);
    expect(isPhotorealReferenceUrl("")).toBe(false);
    expect(isPhotorealReferenceUrl(undefined)).toBe(false);
  });

  it("数组任一命中即 photoreal；全空返回 false", () => {
    expect(
      hasPhotorealReferenceUrl([undefined, "https://x/a.jpg", "https://x/photoreal/c.jpg"]),
    ).toBe(true);
    expect(hasPhotorealReferenceUrl([undefined, null, "https://x/a.jpg"])).toBe(false);
    expect(hasPhotorealReferenceUrl([])).toBe(false);
  });
});

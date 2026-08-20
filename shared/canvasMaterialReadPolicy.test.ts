import { describe, expect, it } from "vitest";
import { isAllowedCanvasMaterialGcsUri } from "./canvasMaterialReadPolicy";

describe("Canvas GCS 素材读取策略", () => {
  it("仅允许明确配置的桶", () => {
    expect(isAllowedCanvasMaterialGcsUri("gs://allowed/canvas/image/a.png", ["allowed"])).toBe(true);
    expect(isAllowedCanvasMaterialGcsUri("gs://private/secret.json", ["allowed"])).toBe(false);
  });

  it("拒绝空对象和路径穿越", () => {
    expect(isAllowedCanvasMaterialGcsUri("gs://allowed/", ["allowed"])).toBe(false);
    expect(isAllowedCanvasMaterialGcsUri("gs://allowed/canvas/../secret", ["allowed"])).toBe(false);
  });
});

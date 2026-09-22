import { describe, expect, it, vi } from "vitest";

vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (path: string) => `https://api.mvstudiopro.com${path}`,
}));

import { manhuaPrevisMediaUrl } from "./manhuaPrevisMediaUrl";

describe("白模媒体正式读取地址", () => {
  it("可选分层包没有地址时保持为空", () => {
    expect(manhuaPrevisMediaUrl(undefined)).toBe("");
  });

  it("把本人白模代理路径直达 Fly API，历史外部地址不改写", () => {
    expect(manhuaPrevisMediaUrl("/api/manhua-previs-media/prv_1/preview"))
      .toBe("https://api.mvstudiopro.com/api/manhua-previs-media/prv_1/preview");
    expect(manhuaPrevisMediaUrl("https://example.com/legacy.mp4"))
      .toBe("https://example.com/legacy.mp4");
  });
});

import { describe, expect, it } from "vitest";
import {
  makeStableManhuaTemplatePublicId,
  resolveStableManhuaTemplatePublicCode,
} from "./manhuaTemplatePublicId";

describe("manhuaTemplatePublicId", () => {
  it("优先沿用已持久化随机码，密钥变化不漂移", () => {
    const card = { id: "tpl_series_secret", publicCode: "A7F2" };
    expect(makeStableManhuaTemplatePublicId(card, "secret-a")).toBe("mt_a7f2");
    expect(makeStableManhuaTemplatePublicId(card, "secret-b")).toBe("mt_a7f2");
  });

  it("无码卡使用 16 位 HMAC，稳定且不含内部 id", () => {
    const card = { id: "tpl_series_secret" };
    const first = resolveStableManhuaTemplatePublicCode(card, "test-secret");
    expect(first).toBe(resolveStableManhuaTemplatePublicCode(card, "test-secret"));
    expect(first).toMatch(/^[A-F0-9]{16}$/);
    expect(makeStableManhuaTemplatePublicId(card, "test-secret")).not.toContain("series_secret");
  });

  it("无码且无密钥时 fail-closed", () => {
    expect(makeStableManhuaTemplatePublicId({ id: "tpl_series_secret" }, "")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { resolveManhuaWriterTemplateRequest } from "./manhuaWriterTemplateRequest";

describe("manhuaWriterTemplateRequest", () => {
  it("优先读取新 publicTemplateId，并兼容旧字段里的 mt_*", () => {
    expect(resolveManhuaWriterTemplateRequest({
      publicTemplateId: "mt_a7f2",
      legacyPrivateAllowed: false,
    })).toEqual({ ok: true, requestedTemplateId: "mt_a7f2" });
    expect(resolveManhuaWriterTemplateRequest({
      legacyViralTemplateId: "mt_a7f2",
      legacyPrivateAllowed: false,
    })).toEqual({ ok: true, requestedTemplateId: "mt_a7f2" });
  });

  it("普通用户拒绝 tpl_*，监管兼容旧草稿", () => {
    expect(resolveManhuaWriterTemplateRequest({
      legacyViralTemplateId: "tpl_series_secret",
      legacyPrivateAllowed: false,
    })).toEqual({ ok: false, reason: "legacy_private_forbidden" });
    expect(resolveManhuaWriterTemplateRequest({
      legacyViralTemplateId: "tpl_series_secret",
      legacyPrivateAllowed: true,
    })).toEqual({ ok: true, requestedTemplateId: "tpl_series_secret" });
  });

  it("新旧字段不一致时拒绝，避免静默选错模板", () => {
    expect(resolveManhuaWriterTemplateRequest({
      publicTemplateId: "mt_a7f2",
      legacyViralTemplateId: "mt_beef",
      legacyPrivateAllowed: true,
    })).toEqual({ ok: false, reason: "conflict" });
  });
});

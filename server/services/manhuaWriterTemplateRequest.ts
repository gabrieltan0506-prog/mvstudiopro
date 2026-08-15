export type ManhuaWriterTemplateRequestResult =
  | { ok: true; requestedTemplateId: string }
  | { ok: false; reason: "conflict" | "legacy_private_forbidden" };

/** 新旧扩写字段的唯一兼容入口；普通用户绝不能借旧字段提交内部 tpl_*。 */
export function resolveManhuaWriterTemplateRequest(params: {
  publicTemplateId?: string | null;
  legacyViralTemplateId?: string | null;
  legacyPrivateAllowed: boolean;
}): ManhuaWriterTemplateRequestResult {
  const current = String(params.publicTemplateId || "").trim();
  const legacy = String(params.legacyViralTemplateId || "").trim();
  if (current && legacy && current.toLowerCase() !== legacy.toLowerCase()) {
    return { ok: false, reason: "conflict" };
  }
  if (/^tpl_[a-z0-9_-]{1,60}$/i.test(legacy) && !params.legacyPrivateAllowed) {
    return { ok: false, reason: "legacy_private_forbidden" };
  }
  return { ok: true, requestedTemplateId: current || legacy };
}

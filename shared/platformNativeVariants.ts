/**
 * /platform 三平台母语变体（小红书 / B站 / 视频号）+ 博主称号开关文案。
 */

export const PLATFORM_NATIVE_VARIANT_IDS = [
  "xiaohongshu",
  "bilibili",
  "weixin_channels",
] as const;

export type PlatformNativeVariantId = (typeof PLATFORM_NATIVE_VARIANT_IDS)[number];

export type PlatformNativeVariant = {
  platform: PlatformNativeVariantId | string;
  format: string;
  hook: string;
  coverHeadline: string;
  coverSubline?: string;
  tags: string[];
  blueOceanKeywords: string[];
  reuseMainCopy?: boolean;
};

export const PLATFORM_NATIVE_VARIANT_LABEL_ZH: Record<string, string> = {
  xiaohongshu: "小红书",
  bilibili: "B站",
  weixin_channels: "视频号",
  douyin: "抖音",
  kuaishou: "快手",
};

/** Stage2 / 扩写：要求输出 platformVariants 的硬约束摘要（Skill md 已详述时仍可短提醒） */
export const PLATFORM_NATIVE_VARIANTS_SCHEMA_HINT = `【platformVariants·必须】每条 contentBlueprint 须含 platformVariants 数组，恰好覆盖 xiaohongshu、bilibili、weixin_channels 三项。
每项字段：platform, format, hook, coverHeadline(8–14字), coverSubline(可选≤18字), tags(3–8), blueOceanKeywords(1–3且三平台子集不同), reuseMainCopy。
- 小红书：format 可为图文或短视频；短视频时 reuseMainCopy=true，不必另写长文案，tags/蓝海可偏女性向生活词。
- B站、视频号：默认 format=短视频。
- 主文案一套；三平台只差钩子/封面主句/标签与蓝海子集。
- 视频号钩子节奏可参照 user JSON 的 weixinChannelsDouyinHotRef（抖音近窗高热样本结构），禁止抄标题。`;

/** 默认关「接受博主称号」时注入 */
export function composeBloggerTitlePolicyPrompt(allowBloggerTitle: boolean): string {
  if (allowBloggerTitle) {
    return `【人设自称·已放开】用户勾选接受「博主/创作者」自称：文案中可使用博主、创作者等称呼，仍须写清职业专长与目标客户，避免空洞人设。`;
  }
  return `【人设空壳禁令·默认】禁止用「创作者」「博主」等空壳自称代替身份。每条须能压缩成「职业/专长 × 目标客户 × 具体场景」一句；标题与钩子用具体身份说话。`;
}

export function normalizePlatformVariants(raw: unknown): PlatformNativeVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: PlatformNativeVariant[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const platform = String(r.platform || r.id || "").trim();
    if (!platform) continue;
    const tagsRaw = r.tags ?? r.hashtags;
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10)
      : typeof tagsRaw === "string"
        ? tagsRaw.split(/[,，、#\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10)
        : [];
    const kwRaw = r.blueOceanKeywords ?? r.highlightKeywords ?? r.keywords;
    const blueOceanKeywords = Array.isArray(kwRaw)
      ? kwRaw.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 4)
      : typeof kwRaw === "string"
        ? kwRaw.split(/[,，、#\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 4)
        : [];
    out.push({
      platform,
      format: String(r.format || "").trim() || "短视频",
      hook: String(r.hook || r.openingHook || "").trim(),
      coverHeadline: String(r.coverHeadline || r.coverTitle || r.headline || "").trim().slice(0, 20),
      coverSubline: String(r.coverSubline || r.subline || "").trim().slice(0, 24) || undefined,
      tags,
      blueOceanKeywords,
      reuseMainCopy: Boolean(r.reuseMainCopy),
    });
  }
  return out.slice(0, 6);
}

/** 出图时优先取封面主句：指定平台 → 小红书 → B站 → 视频号 → 首个有主句的变体 */
export function pickCoverHeadlineFromVariants(
  variants: PlatformNativeVariant[] | undefined,
  preferredPlatform?: string | null,
): string {
  const list = variants || [];
  if (list.length === 0) return "";
  const pref = String(preferredPlatform || "").trim();
  const order = pref
    ? [pref, "xiaohongshu", "bilibili", "weixin_channels"]
    : ["xiaohongshu", "bilibili", "weixin_channels"];
  for (const id of order) {
    const hit = list.find((v) => v.platform === id && v.coverHeadline);
    if (hit?.coverHeadline) return hit.coverHeadline;
  }
  return list.find((v) => v.coverHeadline)?.coverHeadline || "";
}

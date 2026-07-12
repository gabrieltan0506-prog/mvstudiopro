/**
 * /platform 三平台母语变体（小红书 / B站 / 视频号）+ 博主称号开关文案。
 */

import { routePlatformSkillIds } from "./platformSkillRouter";
import { PLATFORM_BUILTIN_SKILL_IDS } from "./platformSkills";

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
- **图文配额**：全案 6 条中至少 3 条主 format=图文；主 format=图文时 xiaohongshu.format 必须=图文且 reuseMainCopy=false。
- 小红书：主 format=短视频时可为短视频 reuseMainCopy=true；tags/蓝海可偏女性向生活词。
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
  return pickCoverVariantFromVariants(variants, preferredPlatform).coverHeadline;
}

export type PickedCoverVariant = {
  coverHeadline: string;
  coverSubline: string;
  platform: string;
  format: string;
  hook: string;
};

/**
 * 选出图用的平台变体块（主句 + 副标 + 平台 id）。
 * `preferredPlatform` 可为 UI hint（douyin/xiaohongshu/…）或原生 id。
 */
export function pickCoverVariantFromVariants(
  variants: PlatformNativeVariant[] | undefined,
  preferredPlatform?: string | null,
): PickedCoverVariant {
  const empty: PickedCoverVariant = {
    coverHeadline: "",
    coverSubline: "",
    platform: "",
    format: "",
    hook: "",
  };
  const list = variants || [];
  if (list.length === 0) return empty;
  const nativePref = mapUiPlatformHintToNativeVariantId(preferredPlatform);
  const order = nativePref
    ? [nativePref, "xiaohongshu", "bilibili", "weixin_channels"]
    : ["xiaohongshu", "bilibili", "weixin_channels"];
  for (const id of order) {
    const hit = list.find((v) => v.platform === id && v.coverHeadline);
    if (hit?.coverHeadline) {
      return {
        coverHeadline: hit.coverHeadline,
        coverSubline: String(hit.coverSubline || "").trim(),
        platform: String(hit.platform || id),
        format: String(hit.format || "").trim(),
        hook: String(hit.hook || "").trim(),
      };
    }
  }
  const any = list.find((v) => v.coverHeadline);
  if (!any?.coverHeadline) return empty;
  return {
    coverHeadline: any.coverHeadline,
    coverSubline: String(any.coverSubline || "").trim(),
    platform: String(any.platform || ""),
    format: String(any.format || "").trim(),
    hook: String(any.hook || "").trim(),
  };
}

/**
 * UI / 决策智库 platformHint → 平台母语变体 id。
 * 抖音/快手本批无独立变体：抖音热度参照视频号；快手贴近视频号口语。
 */
export function mapUiPlatformHintToNativeVariantId(
  hint?: string | null,
): PlatformNativeVariantId | "" {
  const h = String(hint || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!h) return "";
  if (h === "xiaohongshu" || h === "xhs" || h === "小红书") return "xiaohongshu";
  if (h === "bilibili" || h === "bili" || h === "b站" || h === "哔哩") return "bilibili";
  if (
    h === "weixin_channels" ||
    h === "weixin" ||
    h === "channels" ||
    h === "视频号" ||
    h === "douyin" ||
    h === "抖音" ||
    h === "kuaishou" ||
    h === "快手"
  ) {
    return "weixin_channels";
  }
  if ((PLATFORM_NATIVE_VARIANT_IDS as readonly string[]).includes(h)) {
    return h as PlatformNativeVariantId;
  }
  return "";
}

/**
 * 封面像素层：平台母语构图/语气短指令（非全文 Skill）。
 * 只改主句气质与视觉偏好，不灌 md。
 */
export function composePlatformCoverNativeVisualDirective(
  platform?: string | null,
  opts?: { format?: string | null },
): string {
  const id = mapUiPlatformHintToNativeVariantId(platform) || String(platform || "").trim();
  const isGraphic = String(opts?.format || "").includes("图文");
  if (id === "xiaohongshu") {
    return isGraphic
      ? `【平台母语·小红书图文封面】主句偏清单感/情绪大字、一眼心动；暖色生活审美、干净留白；禁止说明书式多栏图标。`
      : `【平台母语·小红书短视频封面】主句偏情绪停滑、种草感；明快生活场域；主句大而少字，禁止百科堆字。`;
  }
  if (id === "bilibili") {
    return `【平台母语·B站封面】主句偏知识反差/信息缺口（仍≤14字）；略偏清晰信息密度与「想点开搞懂」；禁止空泛鸡汤与多图标清单栏。`;
  }
  if (id === "weixin_channels") {
    return `【平台母语·视频号封面】主句偏生活一句人话、温暖易转发；私域聊天感而非广告腔；光影有温度，禁止审讯室/葬礼感暗调。`;
  }
  return "";
}

/**
 * 出图链路专用：禁止灌入全文 Skill（会显著拖慢双语编导 / 像素模型）。
 * 仅返回与封面、图文格、手法相关的短硬约束。
 * 默认按选题路由子集；`skillRouteMode: "all"` 时对勾选池全开短约束。
 * 封面少字硬限始终附加（专治 fallback 模型把长 hook 印满屏）。
 */
export function composePlatformImageSkillHints(
  enabledSkillIds?: string[] | null,
  opts?: {
    routeContext?: string | null;
    sheetKind?: "graphic" | "video" | "unknown" | null;
    skillRouteMode?: "auto" | "all" | null;
    /** 出图任务默认 true：强制封面少字句 */
    forceCoverShortCopy?: boolean;
  },
): string {
  const mode = opts?.skillRouteMode === "all" ? "all" : "auto";
  const poolIds = Array.isArray(enabledSkillIds)
    ? enabledSkillIds.map(String).filter(Boolean)
    : null;

  let activeIds: string[] | null = poolIds;
  if (mode === "auto") {
    const pool = poolIds ?? [...PLATFORM_BUILTIN_SKILL_IDS];
    activeIds = routePlatformSkillIds({
      poolIds: pool,
      context: opts?.routeContext || "",
      sheetKind: opts?.sheetKind || "unknown",
    }).selectedIds;
  }

  const on = (id: string) => (activeIds == null ? true : activeIds.includes(id));
  const parts: string[] = [];
  const forceCover = opts?.forceCoverShortCopy !== false;
  if (forceCover || on("cover-stop-scroll")) {
    parts.push(
      "【封面出图·少字硬限】coverHeadline 须 8–14 字；屏上可见文案最多 2 行；只提亮 2–6 字重点色；禁止把长标题/整段 hook/论文式副标印满屏；有人物禁坐姿上课脸——表情多元、姿势可夸张（错愕/坏笑/失衡/网球发球/登顶等）；同批勿全坐着。",
    );
  }
  if (on("vivid-anti-boring")) {
    parts.push(
      "【文案出图联动】前3秒/封面气质须痛点+爽点前置；禁说教上课脸与说明书墙。",
    );
  }
  if (on("graphic-note-rhythm")) {
    parts.push(
      "【图文笔记出图】读者向可发笔记：钩子→痛点→误区→场景/关系/节律→问答→评论CTA；禁拍封面/拆八页/录60秒/发布SOP等技术指导格。",
    );
  }
  if (on("director-craft")) {
    parts.push("【分镜出图】只借灯光运镜情绪手法词，成稿画面与画内字禁止导演名/片名致敬。");
  }
  if (on("contrast-reversal-climax")) {
    parts.push(
      "【反差弧出图】开场身份错位；中段可精确专有词/数字；情绪态度须有可见反转（可不止一次），落点不限定仰慕；勿说明书墙。",
    );
  }
  if (on("crossover-popsci") || on("crossover-organ-popsci")) {
    parts.push(
      "【跨界科普出图】主体可拟人；电影感机制透视+生活B-roll对照；情绪共鸣优先；禁课堂挂图墙与诊疗恐吓画面。",
    );
  }
  if (on("4season-fmcg-popsci") || on("summer-fmcg-popsci") || on("label-debunk-copy")) {
    parts.push(
      "【四季畅销品轻科普出图】当季SKU食欲/开封特写+配料或营养成分表可读高亮；看不清配料则拍营养成分/宣称正反分屏；量感倒糖盐；禁诊疗恐吓。",
    );
  }
  if (on("food-popsci-lens") || on("4season-fmcg-popsci")) {
    parts.push(
      "【食品科普运镜】开封/咬入特写→包装信息圈点→工业或量感→体感生活情景→货架收束；成稿禁导演名/片名。",
    );
  }
  if (on("authority-cite-endorsement")) {
    parts.push(
      "【权威背书出图】最多一张简洁信息卡（指南名+一句阈值）；勿伪造红头文件或论文截图墙。",
    );
  }
  if (on("fmcg-popsci-monetize")) {
    parts.push(
      "【科普变现出图】末帧可留评论关键词/清单预告，勿小黄车与疗效承诺画面；半成品缺口视觉优先于卖货。",
    );
  }
  if (on("forensic-life-lens")) {
    parts.push(
      "【法医视角出图】生活保命场景（安全带/酒杯/头盔/凌晨手机）；禁解剖台、血腥、命案复盘画面；末帧清单/窗口期信息卡。",
    );
  }
  if (parts.length === 0) return "";
  return `【Platform 出图短约束】\n${parts.join("\n")}`;
}

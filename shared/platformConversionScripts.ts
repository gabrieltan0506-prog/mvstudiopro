/**
 * Platform Stage 2 · 各平台基础成交话术（快速层 · 千人千面）
 * 深度成交话术 → 引导 Deep Research Pro / Max
 */

export type PlatformBasicConversionScript = {
  platform: string;
  platformLabel: string;
  targetAudience: string;
  audiencePain?: string;
  usageScene: string;
  trustDoorFocus: string;
  /** 仅适用于本创作者的一句话锚点（须含职业/交付/痛点等不可迁移细节） */
  personalAnchor: string;
  basicClosingScript: string;
  lightGuarantee?: string;
};

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

/** 常见套话片段 — 出现即视为不合格（prompt 黑名单 + 前端软检测） */
export const CONVERSION_SCRIPT_TEMPLATE_BLACKLIST = [
  "私信我了解更多",
  "私信我",
  "扫码添加",
  "限时优惠",
  "我可以帮你",
  "打造个人IP",
  "打造个人 IP",
  "提升影响力",
  "欢迎咨询",
  "点击链接",
  "了解更多详情",
  "专业团队为您服务",
  "一站式解决方案",
  "赋能",
  "闭环",
  "降本增效",
  "助力您",
  "为您保驾护航",
  "先关注不迷路",
  "评论区扣1",
  "扣1",
  "宝子们",
  "家人们",
  "干货满满",
  "建议收藏",
] as const;

export function platformConversionLabel(platform: string): string {
  const key = String(platform || "").trim().toLowerCase();
  return PLATFORM_LABEL[key] || platform || "平台";
}

/** 软检测：话术是否含明显套话（不阻断展示，仅 UI 提示） */
export function conversionScriptLooksGeneric(script: string): boolean {
  const t = String(script || "").trim();
  if (t.length < 8) return true;
  const lower = t.toLowerCase();
  return CONVERSION_SCRIPT_TEMPLATE_BLACKLIST.some((phrase) => lower.includes(phrase.toLowerCase()));
}

/** Stage 2 LLM：生成各平台基础成交话术的 prompt 块 */
export function buildPlatformBasicConversionScriptPromptBlock(): string {
  const blacklist = CONVERSION_SCRIPT_TEMPLATE_BLACKLIST.slice(0, 16).join(" / ");
  return `【各平台基础成交话术 · Platform 快速层（必输出 · 千人千面）】
在 contentBlueprints 与 monetizationLanes 之外，**必须**额外输出 \`platformConversionScripts\` 数组。
为 user JSON 中 dynamicDecisionChain 出现的**每个平台**各生成 **1 条**（通常 3–4 条：抖音/快手/小红书/B站）。

【千人千面 · 最高优先级】
- 成交话术**必须**只适用于当前这位创作者及其目标人群；换一个人设仍成立的话术 = **不合格，须重写**。
- 每条须从 user JSON 的 **context、stage1StrategicHandoff、monetizationLanes.offerShape、contentBlueprints 痛点** 中**抽取至少 2 个不可迁移的具体细节**（职业称谓、交付物名称、典型场景物件、具体数字、地域/行业切口等）。
- **四个平台的 basicClosingScript 禁止同义改写**：句式结构、切入场景、承接动作须明显不同。
- 须填写 personalAnchor：用一句话说明「为什么这话术只能给这个人用」（含上述具体细节）。

【绝对禁止 · 套话模板黑名单】
出现以下任一词句或同义套话即判不合格：${blacklist} ……
以及任何「换行业仍成立」的万能句（如「我可以帮你…」「欢迎私信咨询」「限时福利」）。

【定位边界】
- 此处只产出**基础成交话术**（50–120 字，1–3 句），不是完整销售剧本；多轮异议处理、深度保障体系 → Deep Research Pro / Max。
- **先共鸣后承接**：说出 targetAudience 没说出口的话（audiencePain = 潜在表达），再给一小步行动。
- lightGuarantee 须与**本用户真实可交付**的降险动作绑定（如「30分钟试听」「不满意全额退咨询费」），禁止空泛「包满意」。

【平台语感 · 仍须千人千面】
抖音/快手：口语、短句、可拍画面；小红书：笔记体、具体场景；B站：理性论证+行动引导。语感可区分平台，**内容细节必须来自本用户人设**。

每条 JSON 字段（一字不差）：
- platform / platformLabel
- targetAudience（具体人群，禁止「泛用户」「创业者」等空壳）
- audiencePain（该人群未说出口的潜在表达，须与本用户赛道相关）
- usageScene（笔记结尾/私信首句/直播口播/评论区置顶）
- trustDoorFocus（有共鸣|有方法|有案例|有保障）
- personalAnchor（15–40 字：仅适用于本创作者的一句话锚点）
- basicClosingScript（50–120 字，含上述具体细节）
- lightGuarantee（与本交付绑定的降险一句，可选但建议）`;
}

export function normalizeConversionScriptRow(raw: unknown): PlatformBasicConversionScript | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const platform = String(r.platform ?? r.platformKey ?? "").trim().toLowerCase();
  const basicClosingScript = String(
    r.basicClosingScript ?? r.closingScript ?? r.script ?? r["基础成交话术"] ?? "",
  ).trim();
  if (!basicClosingScript) return null;
  const platformLabel = String(r.platformLabel ?? r["平台"] ?? platformConversionLabel(platform)).trim();
  const personalAnchor = String(
    r.personalAnchor ?? r.personal_anchor ?? r["千人千面锚点"] ?? r["专属锚点"] ?? "",
  ).trim();
  return {
    platform: platform || platformLabel,
    platformLabel,
    targetAudience: String(r.targetAudience ?? r.target_audience ?? r["目标人群"] ?? "").trim() || "（待结合人设细化）",
    audiencePain: String(r.audiencePain ?? r.pain ?? r["隐性痛点"] ?? "").trim() || undefined,
    usageScene: String(r.usageScene ?? r.scene ?? r["使用场景"] ?? "笔记结尾/私信").trim(),
    trustDoorFocus: String(r.trustDoorFocus ?? r.trustDoor ?? r["四有侧重"] ?? "有共鸣").trim(),
    personalAnchor: personalAnchor || "基于当前人设与交付物定制",
    basicClosingScript,
    lightGuarantee: String(r.lightGuarantee ?? r.guarantee ?? r["轻保障"] ?? "").trim() || undefined,
  };
}

/** 前端展示：四有门标签色 */
export const TRUST_DOOR_BADGE: Record<string, { label: string; color: string }> = {
  有共鸣: { label: "有共鸣", color: "#fb923c" },
  有方法: { label: "有方法", color: "#38bdf8" },
  有案例: { label: "有案例", color: "#a78bfa" },
  有保障: { label: "有保障", color: "#4ade80" },
};

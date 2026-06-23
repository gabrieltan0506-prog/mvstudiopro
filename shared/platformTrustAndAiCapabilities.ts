import type { PlatformDeepPositioningBrief } from "./platformPositioningDiscovery.js";

/** 四有信任体系（转化核心） */
export type PlatformTrustSystem = {
  resonance: string;
  methodology: string;
  caseProof: string;
  guarantee: string;
  journeyNote?: string;
};

/** AI 超能力实战营 · 四种核心能力 */
export type PlatformFourAiCapabilities = {
  dataAbility: string;
  contentAbility: string;
  thinkingAbility: string;
  productAbility: string;
};

export const PLATFORM_TRUST_SYSTEM_LABELS = {
  resonance: "有共鸣",
  methodology: "有方法",
  caseProof: "有案例",
  guarantee: "有保障",
} as const;

export const PLATFORM_FOUR_AI_CAPABILITY_LABELS = {
  data: "数据能力",
  content: "内容能力",
  thinking: "思考能力",
  product: "产品能力",
} as const;

export function buildTrustSystemPromptBlock(): string {
  return `【四有信任体系 · 转化优先】
获客的核心是流量，转化的核心是信任。内容须走完四有旅程：
1. 有共鸣：让用户感到「你懂我」— 用 AI 挖出用户说不出口的隐性需求，痛点须具体可感。
2. 有方法：把内隐经验变成可购买的方法论/流程/工具，拒绝空泛认知。
3. 有案例：拆解过往成功案例，精准匹配目标人群画像（故事+证明）。
4. 有保障：识别并拆解每一个购买障碍，降低决策门槛（承接动作须可执行）。
战略全景图、选题、文案、封面与分镜须四有一脉相承，不得脱节。`;
}

export function buildFourAiCapabilitiesPromptBlock(): string {
  return `【AI 超能力 · 四种核心能力】（须在选题/文案/封面/分镜中可感知体现）
1. 数据能力：如何搭建自己的 AI 知识库 — 用 trendStore/指数/搜索信号支撑论点，引用可核验数据或结构化对比，禁止编造。
2. 内容能力：如何用 AI 写出爆款文案 — 标题/钩子/结构/情绪节拍须可拍可发，对齐平台资料库与热点。
3. 思考能力：如何借助 AI 深度思考 — 洞察须打到痛点×独特方案，有判断、有优先级，非套话。
4. 产品能力：如何用 AI 编程/交付把想法变产品 — 钩子承接须指向可交付物（资料/清单/工具/咨询/课程等转化方向）。`;
}

export function buildTrustAndCapabilitiesCombinedBlock(): string {
  return `${buildTrustSystemPromptBlock()}\n\n${buildFourAiCapabilitiesPromptBlock()}`;
}

/** 封面 / 分镜 / 视觉链注入块 */
export function buildVisualTrustAndCapabilitiesContext(
  personaSummary: string,
  deepBrief: PlatformDeepPositioningBrief | null | undefined,
): string {
  const parts: string[] = [];
  const ps = String(personaSummary || "").trim();
  if (ps) parts.push(`【精神气质与内容身份】${ps.slice(0, 500)}`);

  if (deepBrief) {
    parts.push(
      `【深度定位】${deepBrief.positioningOneLiner}；独特方案：${String(deepBrief.uniqueSolution || "").slice(0, 220)}；核心痛点：${String(deepBrief.painPointSummary || "").slice(0, 220)}`,
    );
    if (deepBrief.primaryPlatform || deepBrief.primaryTrack) {
      parts.push(
        `【平台赛道】${deepBrief.primaryPlatform || ""}${deepBrief.primaryTrack ? ` · ${deepBrief.primaryTrack}` : ""}`,
      );
    }
  }

  const trust = deepBrief?.trustSystem;
  if (trust) {
    parts.push(
      `【四有信任·视觉隐喻】共鸣：${trust.resonance.slice(0, 120)}；方法：${trust.methodology.slice(0, 100)}；案例：${trust.caseProof.slice(0, 100)}；保障：${trust.guarantee.slice(0, 100)}`,
    );
  }

  const cap = deepBrief?.fourAiCapabilities;
  if (cap) {
    parts.push(
      `【四能力·画面表达】数据：${cap.dataAbility.slice(0, 80)}；内容：${cap.contentAbility.slice(0, 80)}；思考：${cap.thinkingAbility.slice(0, 80)}；产品：${cap.productAbility.slice(0, 80)}`,
    );
  } else {
    parts.push(
      "【四能力·画面表达】封面/分镜须隐喻体现：数据论据感、爆款结构感、深度洞察感、可交付产品感（勿文字堆砌，用场景与道具表达）。",
    );
  }

  return parts.join("\n").trim().slice(0, 3800);
}

/** Stage1/2 / 战略全景 context 追加块 */
export function appendTrustAndCapabilitiesToContext(baseContext: string): string {
  const base = String(baseContext || "").trim();
  const block = buildTrustAndCapabilitiesCombinedBlock();
  return base ? `${base}\n\n${block}` : block;
}

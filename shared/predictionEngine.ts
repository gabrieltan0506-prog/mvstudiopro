/**
 * 推薦與預測引擎（實驗）：啟發式 CTR、UCB 多臂賭博機、用戶偏好加權。
 * 前端可安全導入；不依賴 Node 專有 API。
 *
 * ### 接大模型前的紀律（必讀）
 * - 在把任何「自訂欄位 / 內部標記 / 非標準字元」送入供應商 API 之前，**必須核對該路徑的官方參數、
 *   JSON Schema、response_format、max_output_tokens 等限制**，否則易造成拒答、截斷或整鏈失敗。
 * - 本模組的 `predictedCtr`、`mabVariants`、`personalizationScore` 等欄位應只做 **Stage 2
 *   已解析／已歸一化結果之後**的附加層；**不應**在未經驗證的情況下回灌進下一輪 LLM system/user 文本，
 *   除非你已確認供應商接受該結構。
 */

export type MabVariantState = {
  id: string;
  title: string;
  impressions: number;
  clicks: number;
};

/** 從上下文推斷偏好主題；無命中時給 B 端默認畫像詞 */
export function inferPreferredTopicsFromContext(context: string): string[] {
  const pool = ["醫學", "跨界", "美學", "高淨值", "哈佛", "文化", "审美", "历史"];
  const c = String(context || "");
  const hits = pool.filter((t) => c.includes(t));
  return hits.length > 0 ? Array.from(new Set(hits)) : ["醫學", "跨界", "美學", "高淨值"];
}

function pickBlueprintPlatform(blueprint: Record<string, unknown>): string {
  const sp = blueprint.suitablePlatforms;
  if (Array.isArray(sp) && sp.length > 0) {
    return String(sp[0]).toLowerCase();
  }
  const p = blueprint.platform;
  if (typeof p === "string" && p.trim()) return p.toLowerCase();
  return "xiaohongshu";
}

// 1. CTR 預測（啟發式 + 輕微隨機波動，模擬模型不確定性）
export function predictContentCTR(contentBlueprint: Record<string, unknown>, platform: string): number {
  let baseScore = platform.includes("xhs") || platform.includes("hongshu") ? 8.5 : 5.0;

  const text = JSON.stringify(contentBlueprint);
  if (/降維|哈佛|医师|醫師|临床|臨床/i.test(text)) baseScore += 2.1;
  if (/美学|美學|跨界|人文|艺术|藝術/i.test(text)) baseScore += 1.5;

  const titleLen = String(contentBlueprint.title ?? "").length;
  if (titleLen > 0 && titleLen < 15) baseScore += 0.8;

  const variance = Math.random() - 0.5;
  return parseFloat(Math.min(25, Math.max(1, baseScore + variance)).toFixed(2));
}

// 2. 多臂賭博機 UCB1
export function calculateMABVariant(variants: MabVariantState[]): string {
  if (!variants.length) return "";
  const totalImpressions = variants.reduce((sum, v) => sum + v.impressions, 0);
  if (totalImpressions === 0) return variants[0].id;

  let bestVariant = variants[0].id;
  let maxUcbValue = -1;

  for (const v of variants) {
    if (v.impressions === 0) return v.id;

    const conversionRate = v.clicks / v.impressions;
    const explorationBonus = Math.sqrt((2 * Math.log(totalImpressions)) / v.impressions);
    const ucbValue = conversionRate + explorationBonus;

    if (ucbValue > maxUcbValue) {
      maxUcbValue = ucbValue;
      bestVariant = v.id;
    }
  }
  return bestVariant;
}

// 3. 用戶級個性化排序
export function applyUserPersonalization<T extends Record<string, unknown>>(
  blueprints: T[],
  userProfile: { preferredTopics: string[] },
): Array<T & { personalizationScore: number }> {
  const topics = userProfile.preferredTopics ?? [];
  return blueprints
    .map((bp) => {
      let relevanceScore = 1.0;
      const blob = JSON.stringify(bp);
      for (const topic of topics) {
        if (topic && blob.includes(topic)) relevanceScore += 0.5;
      }
      return { ...bp, personalizationScore: parseFloat(relevanceScore.toFixed(2)) };
    })
    .sort((a, b) => b.personalizationScore - a.personalizationScore);
}

export function buildMabVariantsForBlueprint(bp: Record<string, unknown>): MabVariantState[] {
  const titleA = String(bp.title ?? "").trim() || "选题 A";
  const hook = String(bp.hook ?? bp.openingHook ?? "").trim();
  const titleB =
    typeof bp.alternativeTitle === "string" && bp.alternativeTitle.trim()
      ? bp.alternativeTitle.trim()
      : hook
        ? `[情绪钩子] ${titleA.slice(0, 40)}`
        : `[情绪版] ${titleA}`;
  return [
    { id: "variant_a", title: titleA, impressions: 0, clicks: 0 },
    { id: "variant_b", title: titleB.slice(0, 200), impressions: 0, clicks: 0 },
  ];
}

export type Stage2ContentShape = {
  contentBlueprints: Record<string, unknown>[];
  monetizationLanes: unknown[];
};

/** Stage 2 通過 Zod 後注入 CTR / MAB / 個性化排序 */
export function enrichPlatformStage2Content(
  data: Stage2ContentShape,
  opts: { context?: string; preferredTopics?: string[] },
): Stage2ContentShape {
  const preferred = opts.preferredTopics?.length
    ? opts.preferredTopics
    : inferPreferredTopicsFromContext(opts.context ?? "");

  const withScores = data.contentBlueprints.map((bp) => {
    const platform = pickBlueprintPlatform(bp);
    const predictedCtr = predictContentCTR(bp, platform);
    const mabVariants = buildMabVariantsForBlueprint(bp);
    const mabRecommendedVariantId = calculateMABVariant(mabVariants);
    return {
      ...bp,
      predictedCtr,
      mabVariants,
      mabRecommendedVariantId,
    };
  });

  const sorted = applyUserPersonalization(withScores, { preferredTopics: preferred });

  return {
    ...data,
    contentBlueprints: sorted as Record<string, unknown>[],
  };
}

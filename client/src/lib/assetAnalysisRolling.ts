import { coerceDisplayText, dedupeSimilarTexts, type GrowthAnalysisScores } from "@shared/growth";

export type AssetAnalysisRollingSection = {
  id: string;
  label: string;
  content: string;
  kind: "text" | "scores" | "list";
};

export function mergePartialAnalysis(
  prev: Partial<GrowthAnalysisScores> | undefined,
  next: Partial<GrowthAnalysisScores> | undefined,
): Partial<GrowthAnalysisScores> {
  if (!next || typeof next !== "object") return prev ? { ...prev } : {};
  if (!prev) return { ...next };
  const merged: Partial<GrowthAnalysisScores> = { ...prev, ...next };
  if (next.reverseEngineering) {
    merged.reverseEngineering = {
      ...(prev.reverseEngineering || {}),
      ...next.reverseEngineering,
    };
  }
  if (next.premiumContent) {
    merged.premiumContent = {
      ...(prev.premiumContent || {}),
      ...next.premiumContent,
    };
  }
  return merged;
}

function textOrNull(value: unknown): string | null {
  const t = coerceDisplayText(value);
  return t.length > 0 ? t : null;
}

/** 按商用阅读顺序抽取可滚动展示的段落（有内容才返回） */
export function buildRollingSections(
  raw: Partial<GrowthAnalysisScores> | GrowthAnalysisScores | undefined,
): AssetAnalysisRollingSection[] {
  if (!raw || typeof raw !== "object") return [];
  const sections: AssetAnalysisRollingSection[] = [];

  const scores = [
    ["构图", raw.composition],
    ["色彩", raw.color],
    ["灯光", raw.lighting],
    ["冲击", raw.impact],
    ["传播", raw.viralPotential],
  ].filter(([, v]) => typeof v === "number" && v > 0) as Array<[string, number]>;

  if (scores.length >= 2) {
    sections.push({
      id: "scores",
      label: "视觉评分",
      kind: "scores",
      content: scores.map(([l, v]) => `${l} ${v}`).join(" · "),
    });
  }

  const summary = textOrNull(raw.summary);
  if (summary) sections.push({ id: "summary", label: "核心判断", kind: "text", content: summary });

  const visualSummary = textOrNull(raw.visualSummary);
  if (visualSummary) {
    sections.push({ id: "visualSummary", label: "画面摘要", kind: "text", content: visualSummary });
  }

  const hook = textOrNull(raw.reverseEngineering?.hookStrategy);
  if (hook) sections.push({ id: "hookStrategy", label: "抓眼策略", kind: "text", content: hook });

  const emotionalArc = textOrNull(raw.reverseEngineering?.emotionalArc);
  if (emotionalArc) {
    sections.push({ id: "emotionalArc", label: "情绪曲线", kind: "text", content: emotionalArc });
  }

  const commercialLogic = textOrNull(raw.reverseEngineering?.commercialLogic);
  if (commercialLogic) {
    sections.push({ id: "commercialLogic", label: "商业承接", kind: "text", content: commercialLogic });
  }

  const titles = (raw.titleSuggestions || []).map((t) => textOrNull(t)).filter(Boolean) as string[];
  if (titles.length) {
    sections.push({
      id: "titleSuggestions",
      label: "热词与标题方向",
      kind: "list",
      content: titles.slice(0, 6).join("\n"),
    });
  }

  const strengths = dedupeSimilarTexts(raw.strengths || [], 5);
  if (strengths.length) {
    sections.push({
      id: "strengths",
      label: "优势亮点",
      kind: "list",
      content: strengths.slice(0, 5).join("\n"),
    });
  }

  const topics = (raw.premiumContent?.actionableTopics || [])
    .map((topic) => {
      const title = textOrNull(topic.title);
      const brief = textOrNull(topic.contentBrief);
      if (!title && !brief) return "";
      return title ? (brief ? `${title}\n${brief}` : title) : brief!;
    })
    .filter(Boolean);
  if (topics.length) {
    sections.push({
      id: "topics",
      label: "可执行选题",
      kind: "list",
      content: topics.slice(0, 3).join("\n\n"),
    });
  }

  const bgm = textOrNull(raw.bgmAnalysis);
  if (bgm) sections.push({ id: "bgm", label: "配乐氛围", kind: "text", content: bgm });

  const realityCheck = textOrNull(raw.realityCheck);
  if (realityCheck) {
    sections.push({ id: "realityCheck", label: "现实查验", kind: "text", content: realityCheck });
  }

  const improvements = dedupeSimilarTexts(raw.improvements || [], 5);
  if (improvements.length) {
    sections.push({
      id: "improvements",
      label: "改进建议",
      kind: "list",
      content: improvements.slice(0, 5).join("\n"),
    });
  }

  return sections;
}

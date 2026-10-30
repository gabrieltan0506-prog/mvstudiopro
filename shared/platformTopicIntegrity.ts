import type { XhsGrowthEvidence } from "./xhsContentStrategy";
import { createXhsRelevanceMatcher } from "./xhsContentStrategy";
import { topicDisplayText, topicReasonDisplay } from "./platformTopicDisplay";

/** 本轮选题只使用近7或15天；需求里的明确窗口优先，绝不暗中退回30天。 */
export function resolveTopicWindowDays(context = "", selected?: number | null): 7 | 15 {
  if (/(?:7|七)\s*天?\s*(?:[–—~-]|到|至)\s*(?:15|十五)\s*天/.test(context)) return 15;
  if (/(?:最近|近|过去|過去)\s*(?:15|十五)\s*天|近两周|近兩週|近两星期/.test(context)) return 15;
  if (/(?:最近|近|过去|過去)\s*(?:7|七)\s*天|最近一周|近一週|近一周/.test(context)) return 7;
  return Number(selected) === 7 ? 7 : 15;
}

/** 新结果必须给完整句子；旧草稿只标记，不补写所谓原文。 */
export function assertCompleteTopicText(row: Record<string, unknown>): void {
  const title = String(row.title || "").trim();
  if (title.length < 4 || title.length > 120) throw new Error("选题标题长度不合要求，未截断或替换已有结果");
  for (const [key, label] of [["hookSketch", "切口说明"], ["conveyGoal", "传达目标"], ["viralReason", "推荐理由"]]) {
    const value = String(row[key] || "").trim();
    if (value.length < 4 || topicDisplayText(value) !== value || topicReasonDisplay(value).incomplete || !/[。！？.!?][”’」』）)]*$/.test(value)) {
      throw new Error(`选题${label}未完整结束，未替换已有结果`);
    }
    if (key !== "viralReason" && value.length > 4000) throw new Error(`选题${label}超出容量，未截断或替换已有结果`);
    if (/人设空壳禁令|硬约束|system prompt|skillsUsed|conveyGoal|viralReason/i.test(value)) {
      throw new Error(`选题${label}混入内部指令，未替换已有结果`);
    }
  }
}

export type TopicEvidenceRef = { platform: "xiaohongshu" | "douyin"; id: string };

/** 模型只能选已有样本ID。链接、日期、互动均取自原始采集证据，不能由模型填造。 */
export function bindTopicEvidence(
  refs: unknown, topicText: string, evidence: XhsGrowthEvidence | undefined,
): XhsGrowthEvidence | undefined {
  if (!evidence) return undefined;
  const platform = evidence.platform || "xiaohongshu";
  const ids = new Set((Array.isArray(refs) ? refs : []).filter((ref): ref is TopicEvidenceRef =>
    Boolean(ref && typeof ref === "object" && ref.platform === platform && typeof ref.id === "string"),
  ).map(ref => ref.id));
  const match = createXhsRelevanceMatcher(topicText, evidence.samples);
  const start = Date.parse(evidence.windowStart), end = Date.parse(evidence.windowEnd);
  const validWindow = Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 15 * 86400000;
  const samples = evidence.samples.filter(sample => {
    const at = Date.parse(sample.date);
    return validWindow && ids.has(sample.id) && sample.dateKind === "publishedAt" &&
      Number.isFinite(at) && at >= start && at <= end && /^https?:\/\//i.test(sample.url || "") &&
      (sample.likes !== undefined || sample.comments !== undefined) && match(sample).score > 0;
  });
  return { ...evidence, samples, selectedCount: samples.length,
    note: `本题引用${samples.length}条有来源、发布时间和采集时互动的样本。词面匹配只能辅助核对相关性，不能证明观点或效果；赞评为采集时累计值，不是窗口内新增量。` };
}

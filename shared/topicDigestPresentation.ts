import { z } from "zod";
import type { TopicCard } from "./topicDigest";

/** 阅读顺序是创作环节，不是效果排名；展示转换不写回模型原稿。 */
export const TOPIC_READING_GROUPS = ["工具与流程", "选题与素材", "写作与制作", "发布与反馈", "其他主题"] as const;
export type TopicReadingGroup = typeof TOPIC_READING_GROUPS[number];
const readableTopic = z.object({ title: z.string(), angle: z.string(), hook: z.string(), format: z.string(),
  outline: z.array(z.string()), tags: z.array(z.string()), sourceIds: z.array(z.string()), draftRefs: z.array(z.string()).optional() });
export type TopicReadingRow = z.infer<typeof readableTopic> & { key: string; originalIndex: number; group: TopicReadingGroup; groupReason: string };
export type TopicReadingSection = { key: "deepseek" | "glm" | "integrated"; label: string; rows: TopicReadingRow[]; unavailable: boolean };
export type TopicReadingComparison = { sections: TopicReadingSection[]; mergeNotes: string[]; scope: "batch" | "selected" };
const rules: { group: TopicReadingGroup; words: string[] }[] = [
  { group: "发布与反馈", words: ["内容透明", "AI声明", "信任", "分发", "读者反馈", "发布", "复盘"] },
  { group: "选题与素材", words: ["选题", "标题", "采访", "素材积累", "故事写作", "内容策划"] },
  { group: "写作与制作", words: ["写作", "改稿", "提示词", "短视频脚本", "AI感", "绘图", "配音", "剪辑", "内容质量"] },
  { group: "工具与流程", words: ["工具", "工作流", "本地模型", "隐私", "流程"] },
];
export function classifyTopicForReading(topic: { title: string; tags: string[] }): Pick<TopicReadingRow, "group" | "groupReason"> {
  // 具体标签优先于标题；无法判断的题保留在其他主题，不强凑流程。
  for (const field of [topic.tags.join("、"), topic.title]) {
    for (const rule of rules) {
      const word = rule.words.find(word => field.includes(word));
      if (word) return { group: rule.group, groupReason: `依据原文关键词“${word}”归类` };
    }
  }
  return { group: "其他主题", groupReason: "现有标题与标签无法明确归类，保留原题" };
}
export function groupTopicsForReading<T extends TopicReadingRow>(rows: readonly T[]) {
  return TOPIC_READING_GROUPS.map(group => ({ group, rows: rows.filter(row => row.group === group) })).filter(g => g.rows.length);
}
export function readTopicSection(key: TopicReadingSection["key"], raw: unknown): TopicReadingSection {
  const parsed = z.object({ topics: z.array(readableTopic) }).safeParse(raw);
  return { key, label: { deepseek: "原稿一", glm: "原稿二", integrated: "整合稿" }[key], unavailable: !parsed.success,
    rows: parsed.success ? parsed.data.topics.map((topic, i) => ({ ...topic, ...classifyTopicForReading(topic), key: `${key}:${i + 1}`, originalIndex: i + 1 })) : [] };
}
export function buildTopicReadingComparison(workflow: unknown, selected?: { topics: TopicCard[]; method: "deepseek" | "dual" }): TopicReadingComparison {
  const w = (workflow && typeof workflow === "object" ? workflow : {}) as Record<string, { raw?: unknown }>;
  const sections = (["deepseek", "glm", "integrated"] as const).map(key => readTopicSection(key, w[key]?.raw));
  const notes = z.object({ mergeNotes: z.array(z.string()) }).safeParse(w.integrated?.raw);
  if (!selected) return { sections, mergeNotes: notes.success ? notes.data.mergeNotes : [], scope: "batch" };
  const refs = new Set(selected.topics.flatMap(t => selected.method === "dual" ? t.draftRefs || [] : [`deepseek:${t.id.replace(/^topic-/, "")}`]));
  for (const section of sections) {
    section.rows = section.key === "integrated"
      ? section.rows.filter(row => selected.method === "dual" && selected.topics.some(t => t.title === row.title && JSON.stringify(t.draftRefs) === JSON.stringify(row.draftRefs)))
      : section.rows.filter(row => refs.has(row.key));
  }
  // 通知仅展示已投递题及其原稿来源，不能借对照展开未投递候选池。
  return { sections: selected.method === "dual" ? sections : sections.filter(s => s.key === "deepseek"), mergeNotes: [], scope: "selected" };
}
export const topicReferenceLabel = (ref: string) => ref.replace(/^deepseek:/, "原稿一 · 第").replace(/^glm:/, "原稿二 · 第") + "题";

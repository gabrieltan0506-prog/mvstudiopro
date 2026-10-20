import { z } from "zod";

export const TOPIC_DIGEST_INTERVAL_MS = 48 * 60 * 60 * 1000;
export const TOPIC_LANES = {
  parenting: "亲子关系与儿童内容", workplace: "职场与个人成长", ai: "AI工具与创作",
  business: "产品与品牌营销", lifestyle: "生活方式", storytelling: "故事与漫剧",
} as const;
export const topicLaneSchema = z.enum(["parenting", "workplace", "ai", "business", "lifestyle", "storytelling"]);
export type TopicLane = z.infer<typeof topicLaneSchema>;
export const topicPreferenceSchema = z.object({
  enabled: z.boolean(), lane: topicLaneSchema, keywords: z.string().trim().max(120),
});
export type TopicPreference = z.infer<typeof topicPreferenceSchema>;
export const topicSourceSchema = z.object({
  id: z.string(), title: z.string(), url: z.string().url().refine(v => /^https?:\/\//.test(v)),
  observedAt: z.string(), platform: z.string(),
});
export type TopicSource = z.infer<typeof topicSourceSchema>;
export const candidateSchema = z.object({
  title: z.string().trim().min(8).max(100), angle: z.string().trim().min(20).max(600),
  hook: z.string().trim().min(10).max(200), format: z.enum(["图文", "短视频", "故事"]),
  outline: z.array(z.string().trim().min(5).max(300)).min(3).max(5),
  tags: z.array(z.string().trim().min(1).max(30)).min(1).max(5),
  sourceIds: z.array(z.string()).max(2),
});
export const topicCandidatesSchema = z.object({ topics: z.array(candidateSchema).min(5).max(8) });
export type TopicCard = z.infer<typeof candidateSchema> & { id: string; kind: "热点灵感" | "常青选题"; sources: TopicSource[]; draftRefs?: string[] };
export type TopicDigest = { id: string; lane: TopicLane; createdAt: string; expiresAt: string; topics: TopicCard[] };
export const topicPeriod = (now = Date.now()) => Math.floor(now / TOPIC_DIGEST_INTERVAL_MS);

/** 来源从真实输入回填，模型不能自造链接、时效或热度。 */
export function verifyTopicCandidates(raw: unknown, sources: TopicSource[], now = Date.now()): TopicCard[] {
  const parsed = topicCandidatesSchema.parse(raw);
  const fresh = new Map(sources.filter(s => {
    const age = now - Date.parse(s.observedAt);
    return age >= 0 && age <= TOPIC_DIGEST_INTERVAL_MS && topicSourceSchema.safeParse(s).success;
  }).map(s => [s.id, s]));
  const seen = new Set<string>();
  return parsed.topics.map((t, i) => {
    const key = t.title.replace(/[\s，。！？、：；,.!?:;“”「」《》]/g, "").toLowerCase();
    if (seen.has(key)) throw new Error("模型返回重复选题");
    seen.add(key);
    if (t.sourceIds.some(id => !fresh.has(id))) throw new Error("热点来源不存在或已过期");
    const selected = t.sourceIds.map(id => fresh.get(id)!);
    return { ...t, id: `topic-${i + 1}`, kind: selected.length ? "热点灵感" : "常青选题", sources: selected };
  });
}

/** 个性偏好仅本账号匹配，共享候选池不接收用户需求或私有资料。 */
export function topicRecommendationCount(input: { role?: string | null; plan?: string | null }): 1 | 2 {
  return ["paid", "admin", "supervisor"].includes(input.role || "") || ["pro", "enterprise"].includes(input.plan || "") ? 2 : 1;
}
export function selectTopicCards(topics: TopicCard[], keywords: string, dismissed: string[] = [], limit = 5): TopicCard[] {
  const words = keywords.split(/[\s,，、;；]+/).filter(Boolean).slice(0, 12);
  const score = (t: TopicCard) => words.reduce((n, word) => n + (`${t.title} ${t.angle} ${t.tags.join(" ")}`.includes(word) ? 1 : 0), 0);
  return topics.filter(t => !dismissed.includes(t.id)).sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export function topicCreationBrief(digest: TopicDigest, topic: TopicCard): string {
  return [`【选题通知 · ${TOPIC_LANES[digest.lane]}】`, `选题：${topic.title}`, `类型：${topic.kind}`,
    `切入角度：${topic.angle}`, `开场：${topic.hook}`, `建议形式：${topic.format}`,
    `内容展开：\n${topic.outline.map((line, i) => `${i + 1}. ${line}`).join("\n")}`,
    `推荐标签：${topic.tags.join("、")}`,
    ...topic.sources.map(s => `灵感来源：${s.title}（${s.platform}，观测于${s.observedAt}）${s.url}`),
    "请结合我的真实背景改写并兑现标题，不虚构经历、数字效果或热点事实。"].join("\n");
}

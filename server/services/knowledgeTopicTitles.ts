/**
 * 主题图命题（用户 2026-11-08 令；2026-11-09 改小批并发）：为每个主题图拟定图片标题、图下内文标题与各小节内文小标题。
 * 走两档准备阶段已用的知识整理路由（FlashX / DeepSeek flash）。
 * 调用组织：主题按 ≤8 页一批拆分，按 knowledgeConcurrency 动态并发（首波错峰、429 减半）发出；
 * 每批回包逐页部分采纳，缺项主题再逐主题补缺一次，仍缺的页退回机械/原标题。
 * 每批与每个补缺主题的请求、原始回包与解析结果分别永久保存；整档汇总 parsed.json 供零调用回放。失败不阻断出图准备。
 */
import { createHash } from "node:crypto";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";
import {
  KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER,
  embedKnowledgeTopicTitles,
  knowledgeTopicKey,
  stripKnowledgeTopicTitles,
  type KnowledgeTopicTitle,
  type KnowledgeTopicTitles,
} from "../../shared/knowledgeTopicImagePlan";
import { KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST } from "./knowledgeModelCapabilities";
import { KNOWLEDGE_MODEL_CHANNEL_MAX, knowledgePooled } from "../../shared/knowledgeConcurrency";
import {
  invokeKnowledgePublicationRoutes,
  type KnowledgeModelRequest,
  type KnowledgeRouteEvidence,
} from "./knowledgePublicationRoutes";

export const KNOWLEDGE_TOPIC_TITLES_VERSION = "topic-titles-v3";
/** 每批最多几个主题（48 页 → 6 批）。 */
export const KNOWLEDGE_TOPIC_TITLE_BATCH = 8;
const MAX_TITLE = 24;
const usable = (v: unknown) => {
  const t = typeof v === "string" ? v.replace(/^#+\s*/, "").trim() : "";
  return t && t.length <= MAX_TITLE && !/[\n#|｜]/.test(t) && !KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER.test(t) ? t : undefined;
};

/** 解析模型回包：blocks[0]=图片标题，blocks[1]=图下内文标题，其后按原顺序为各小节内文小标题。 */
export function parseKnowledgeTopicTitles(report: any, topics: readonly { id: string; headlines: string[] }[]) {
  const titles: KnowledgeTopicTitles = {};
  const rejected: string[] = [];
  const pages: any[] = Array.isArray(report?.pages) ? report.pages : [];
  for (const topic of topics) {
    const page = pages.find(p => p?.id === topic.id);
    const blocks: any[] = Array.isArray(page?.reading?.blocks) ? page.reading.blocks : [];
    const distinct = (t?: string) => (t && !topic.headlines.some(h => h.trim() === t) ? t : undefined);
    const image = distinct(usable(blocks[0]?.title)), reading = distinct(usable(blocks[1]?.title));
    const sectionBlocks = blocks.slice(2);
    const sections: Record<string, string> = {};
    // 小节标题数量必须与原小节一一对应；对不上整组回退原标题，不猜位置。
    if (sectionBlocks.length === topic.headlines.length) {
      topic.headlines.forEach((h, i) => { const t = usable(sectionBlocks[i]?.title); if (t && t !== h.trim()) sections[h] = t; });
    } else rejected.push(`${topic.id}: 小节标题${sectionBlocks.length}项与原小节${topic.headlines.length}项不符，回退原标题`);
    if (!image) rejected.push(`${topic.id}: 图片标题缺失或不合格，回退机械标题`);
    if (!reading) rejected.push(`${topic.id}: 内文标题缺失或不合格，回退图片标题`);
    titles[knowledgeTopicKey(topic.headlines)] = { image, reading, sections };
  }
  return { titles, rejected };
}

/** 一个主题的命题是否齐全：图片标题、内文标题都有，且每个小节都已改写。 */
export function isKnowledgeTopicTitleComplete(entry: KnowledgeTopicTitle | undefined, headlines: readonly string[]) {
  return Boolean(entry?.image && entry?.reading && headlines.every(h => entry.sections?.[h.trim()]));
}

/** 合并两次命题：以首发为准，缺项才用补缺结果填上。 */
export function mergeKnowledgeTopicTitle(base: KnowledgeTopicTitle | undefined, patch: KnowledgeTopicTitle | undefined): KnowledgeTopicTitle {
  return {
    image: base?.image || patch?.image,
    reading: base?.reading || patch?.reading,
    sections: { ...(patch?.sections || {}), ...(base?.sections || {}) },
  };
}

const TITLE_SYSTEM_PROMPT = `你为图文知识手册的每个主题图拟定标题。每个主题含若干原小节（见body首行“原小节：”后以｜分隔）与图内要点。
为每个主题写出三类具体标题（都要是概括内容的实际短语，不能写字段名，不能写“图片标题”“内文标题”“小标题”这类字样）：
1. 图片标题：≤16字，概括本主题核心，不用“等N节”。
2. 图下内文标题：≤20字，概括图下详细内文讲什么，与图片标题互补、不重复。
3. 每个原小节的内文小标题：≤16字，忠实原意，不新增事实、不加编号；必须改写，不得与原小节标题相同。
图片标题与图下内文标题也不得与任何原小节标题相同。
只依据给定文字，不编造。标题不含#、|、换行。
输出格式：knowledge_publication_v1 JSON，pages与输入同id同顺序、一个不少。每页reading.blocks依次为：第1项=图片标题，第2项=图下内文标题，第3项起按原小节顺序每节一项=该节内文小标题；每项是{type:"prose",title:<标题>,note:"",text:<说明>}，第1项text写"image"，第2项text写"reading"，其后各项text逐字写对应的原小节标题。blocks数量=2+原小节数。
示例（虚构主题，仅示意格式，不要照抄其中字词）：输入原小节“蒸发｜凝结｜降水”，则blocks为[{type:"prose",title:"太阳驱动的水循环",note:"",text:"image"},{type:"prose",title:"三种相变的条件与去向",note:"",text:"reading"},{type:"prose",title:"受热升空的水汽",note:"",text:"蒸发"},{type:"prose",title:"冷却成云",note:"",text:"凝结"},{type:"prose",title:"雨雪回到地面",note:"",text:"降水"}]。
每页其余字段：headline照抄输入headline，body写一句话说明本主题，imageDescription:"",imageStatus:"absent",facts:[{term:"主题",statement:一句话说明}],cautions:[]，reading.version=1，reading.subtitle=""，reading.accent="jade"。顶层：kind:"knowledge_publication_v1"，sourceDigest照抄输入值，title:"主题命题"。`;

type TitleTopic = { id: string; headlines: string[]; body: string; index: number };

function buildTitleRequest(model: string | undefined, title: string, sourceDigest: string, topics: readonly TitleTopic[]): KnowledgeModelRequest {
  return {
    executionChannel: "openrouter",
    executionFamily: String(model || "").includes("glm") ? "glm" : "deepseek",
    systemInstruction: { parts: [{ text: TITLE_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ sourceDigest, source: { title, pages: topics.map(t => ({ id: t.id, headline: `主题${t.index + 1}`, body: `原小节：${t.headlines.join("｜")}\n\n${t.body}`, imageUrl: "" })) } }) }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST, responseMimeType: "application/json" },
  };
}

/**
 * 命题：首发按 ≤KNOWLEDGE_TOPIC_TITLE_BATCH（8）个主题一批拆分、各批并发发出（1109：48 页 → 6 批，避免单次长回包截断）；
 * 每批回包按页部分采纳，缺页/不合格的主题只对缺项逐主题补一次（1108g2 实测 GLM 整档首发只回 6/16 页，
 * 路由合同整批拒收导致全部回退机械标题）；补缺结果只填缺项，仍缺的回退机械/原标题。
 * 原始回包与解析结果分别永久保存（每批与每个补缺主题各自一份）；整档汇总 parsed.json，同一输入再调用零请求回放，不重复购买。
 */
export async function nameKnowledgeEditionTopics(params: {
  markdown: string;
  model?: string;
  evidence: KnowledgeRouteEvidence;
  invoke?: typeof invokeKnowledgePublicationRoutes;
  abortSignal?: AbortSignal;
}): Promise<{ markdown: string; status: "named" | "partial" | "cached" | "fallback" | "skipped"; message?: string; missing?: string[] }> {
  const base = stripKnowledgeTopicTitles(params.markdown);
  const plan = knowledgeEditionImagePlan(base);
  if (!plan || !plan.images.length) return { markdown: base, status: "skipped" };
  const digest = createHash("sha256").update(JSON.stringify({ v: KNOWLEDGE_TOPIC_TITLES_VERSION, level: plan.level, title: plan.title,
    topics: plan.images.map(image => ({ headlines: image.headlines, body: image.body })) })).digest("hex");
  // 知识整理合同要求页 id 为 UUID：由输入摘要与序号确定性生成，回放时不变。
  const uuid = (i: number) => {
    const h = createHash("sha256").update(`${digest}/topic/${i}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const topics: TitleTopic[] = plan.images.map((image, i) => ({ id: uuid(i), headlines: image.headlines, body: image.body, index: i }));
  const scope = { ...params.evidence, prefix: `${params.evidence.prefix}/topic-titles/${plan.level}-${digest.slice(0, 16)}` };
  const parsedSaved = await scope.read(`${scope.prefix}/parsed.json`);
  if (parsedSaved?.digest === digest) return { markdown: embedKnowledgeTopicTitles(base, parsedSaved.titles || {}), status: "cached", missing: parsedSaved.missing };
  const failed = await scope.read(`${scope.prefix}/failure.json`);
  if (failed?.digest === digest) return { markdown: base, status: "fallback", message: String(failed.message || "") };
  const invoke = params.invoke || invokeKnowledgePublicationRoutes;
  const fetchOverride = params.abortSignal
    ? { fetch: (url: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, params.abortSignal!]) : params.abortSignal }) }
    : {};
  /** 一次命题调用：请求先存、原始回包永久保存、解析结果另存；路由拒收或解析失败记 failure.json 并返回空结果。 */
  const call = async (prefix: string, subset: readonly TitleTopic[], sourceDigest: string) => {
    const sub = { ...scope, prefix };
    const done = await sub.read(`${prefix}/parsed.json`);
    if (done?.digest === digest) return { titles: done.titles as KnowledgeTopicTitles, rejected: (done.rejected || []) as string[], error: undefined as string | undefined };
    const request = buildTitleRequest(params.model, plan.title, sourceDigest, subset);
    const saved = await sub.read(`${prefix}/request.json`);
    if (saved && saved.digest !== digest) throw Error("主题命题输入版本变化，保留原回执");
    if (!saved) await sub.save(`${prefix}/request.json`, { digest, request });
    try {
      params.abortSignal?.throwIfAborted();
      const response = await invoke(saved?.request || request, sub, fetchOverride);
      params.abortSignal?.throwIfAborted();
      await sub.save(`${prefix}/raw.json`, { digest, responseText: response.text });
      const report = JSON.parse(JSON.parse(response.text).candidates[0].content.parts[0].text);
      const parsed = parseKnowledgeTopicTitles(report, subset);
      await sub.save(`${prefix}/parsed.json`, { digest, titles: parsed.titles, rejected: parsed.rejected, topics: subset.map(t => ({ id: t.id, headlines: t.headlines })) });
      return { ...parsed, error: undefined as string | undefined };
    } catch (error) {
      if (params.abortSignal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await sub.save(`${prefix}/failure.json`, { digest, message });
      return { titles: {} as KnowledgeTopicTitles, rejected: [] as string[], error: message };
    }
  };
  // 首发：按 ≤8 个主题一批拆分，各批并发（同通道上限），每批独立请求/回包/解析，按页部分采纳。
  const batches: TitleTopic[][] = [];
  for (let i = 0; i < topics.length; i += KNOWLEDGE_TOPIC_TITLE_BATCH) batches.push(topics.slice(i, i + KNOWLEDGE_TOPIC_TITLE_BATCH));
  const firsts: Awaited<ReturnType<typeof call>>[] = new Array(batches.length);
  await knowledgePooled(batches.length, async b => {
    const batchDigest = createHash("sha256").update(`${digest}/batch/${b}`).digest("hex");
    firsts[b] = await call(`${scope.prefix}/batch-${b}`, batches[b]!, batchDigest);
  }, KNOWLEDGE_MODEL_CHANNEL_MAX.openrouter);
  const titles: KnowledgeTopicTitles = Object.assign({}, ...firsts.map(f => f.titles));
  const rejected = firsts.flatMap(f => f.rejected);
  const incomplete = topics.filter(t => !isKnowledgeTopicTitleComplete(titles[knowledgeTopicKey(t.headlines)], t.headlines));
  const retried: number[] = [];
  const errors: string[] = firsts.flatMap((f, b) => (f.error ? [`首发第${b + 1}批：${f.error}`] : []));
  if (incomplete.length) {
    // 只对缺页/缺项逐主题补一次：每个主题独立请求（单页合同不会因别页缺失整批拒收），并发走同一通道上限。
    const outcomes: Awaited<ReturnType<typeof call>>[] = new Array(incomplete.length);
    await knowledgePooled(incomplete.length, async k => {
      const topic = incomplete[k]!;
      const topicDigest = createHash("sha256").update(`${digest}/retry/${topic.index}`).digest("hex");
      outcomes[k] = await call(`${scope.prefix}/retry/topic-${topic.index}`, [topic], topicDigest);
    }, KNOWLEDGE_MODEL_CHANNEL_MAX.openrouter);
    incomplete.forEach((topic, k) => {
      const key = knowledgeTopicKey(topic.headlines);
      const outcome = outcomes[k]!;
      retried.push(topic.index);
      titles[key] = mergeKnowledgeTopicTitle(titles[key], outcome.titles[key]);
      rejected.push(...outcome.rejected.map(r => `补缺 ${r}`));
      if (outcome.error) errors.push(`主题${topic.index + 1}补缺：${outcome.error}`);
    });
  }
  const missing = topics.filter(t => !isKnowledgeTopicTitleComplete(titles[knowledgeTopicKey(t.headlines)], t.headlines)).map(t => knowledgeTopicKey(t.headlines));
  const named = topics.filter(t => { const e = titles[knowledgeTopicKey(t.headlines)]; return e?.image || e?.reading || Object.keys(e?.sections || {}).length; }).length;
  await scope.save(`${scope.prefix}/parsed.json`, { digest, titles, rejected, retried, missing, errors, batches: batches.map((b, i) => ({ batch: i, topics: b.length, error: firsts[i]!.error })), topics: topics.map(t => ({ id: t.id, headlines: t.headlines })) });
  const message = errors.length ? errors.join("；") : undefined;
  if (!named) {
    const reason = message || `${topics.length}个主题命题均不合格：${rejected.slice(0, 3).join("；")}`;
    await scope.save(`${scope.prefix}/failure.json`, { digest, message: reason });
    console.warn(`[knowledgeTopicTitles] 主题命题失败，回退机械标题：${reason.slice(0, 200)}`);
    return { markdown: base, status: "fallback", message: reason, missing };
  }
  if (missing.length) console.warn(`[knowledgeTopicTitles] 主题命题部分采纳：${topics.length - missing.length}/${topics.length} 齐全，${missing.length} 个主题缺项回退机械/原标题`);
  return { markdown: embedKnowledgeTopicTitles(base, titles), status: missing.length ? "partial" : "named", message, missing };
}

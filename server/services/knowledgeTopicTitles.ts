/**
 * 主题图命题（用户 2026-11-08 令；2026-11-09 改小批并发）：为每个主题图拟定图片标题、图下内文标题与各小节内文小标题。
 * 走两档准备阶段已用的知识整理路由（FlashX / DeepSeek flash）。
 * 调用组织：主题按 ≤8 页一批拆分，按 knowledgeConcurrency 动态并发（首波错峰、429 减半）发出；
 * 每批独立过 auditKnowledgeTopicTitles 校验，不过只重发该批（最多再发 2 次），仍不过的页退回原标题。
 * 每批的请求、每次原始回包与解析结果分别永久保存；整档汇总 parsed.json 供零调用回放。失败不阻断出图准备。
 */
import { createHash } from "node:crypto";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";
import {
  KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER,
  auditKnowledgeTopicTitles,
  embedKnowledgeTopicTitles,
  knowledgeTopicKey,
  mechanicalKnowledgeTopicTitle,
  stripKnowledgeTopicTitles,
  type KnowledgeTopicTitles,
} from "../../shared/knowledgeTopicImagePlan";
import { KNOWLEDGE_MODEL_CHANNEL_MAX, KnowledgeRateGate, knowledgeStageConcurrency, runKnowledgeStaggeredPool } from "../../shared/knowledgeConcurrency";
import { KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST } from "./knowledgeModelCapabilities";
import {
  invokeKnowledgePublicationRoutes,
  type KnowledgeModelRequest,
  type KnowledgeRouteEvidence,
} from "./knowledgePublicationRoutes";

export const KNOWLEDGE_TOPIC_TITLES_VERSION = "topic-titles-v3";
/** 每批最多几个主题（48 页 → 6 批）。 */
export const KNOWLEDGE_TOPIC_TITLE_BATCH = 8;
/** 校验不过时同批最多再发几次。 */
export const KNOWLEDGE_TOPIC_TITLE_RESENDS = 2;
const MAX_TITLE = 24;
const usable = (v: unknown) => {
  const t = typeof v === "string" ? v.replace(/^#+\s*/, "").trim() : "";
  return t && t.length <= MAX_TITLE && !/[\n#|｜]/.test(t) && !KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER.test(t) ? t : undefined;
};

/** 解析模型回包：blocks[0]=图片标题，blocks[1]=图下内文标题，其后按原顺序为各小节内文小标题。 */
export function parseKnowledgeTopicTitles(report: any, topics: { id: string; headlines: string[] }[]) {
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

const SYSTEM_PROMPT = `你为图文知识手册的每个主题图拟定标题。每个主题含若干原小节（见body首行“原小节：”后以｜分隔）与图内要点。
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

/** 单主题是否命题齐全：图片/内文标题都有且不同，各小节小标题全部改写（解析阶段已剔除占位与照搬原标题）。 */
function topicNamed(entry: KnowledgeTopicTitles[string] | undefined, headlines: readonly string[]) {
  return Boolean(entry?.image && entry?.reading && entry.image !== entry.reading
    && headlines.every(h => entry.sections?.[h.trim()] && entry.sections[h.trim()] !== h.trim()));
}

function auditTopics(topics: readonly TitleTopic[], titles: KnowledgeTopicTitles) {
  return auditKnowledgeTopicTitles(topics.map(t => {
    const entry = titles[knowledgeTopicKey(t.headlines)];
    const title = entry?.image || mechanicalKnowledgeTopicTitle(t.headlines);
    return { headlines: t.headlines, title, readingTitle: entry?.reading || title };
  }), titles);
}

export async function nameKnowledgeEditionTopics(params: {
  markdown: string;
  model?: string;
  evidence: KnowledgeRouteEvidence;
  invoke?: typeof invokeKnowledgePublicationRoutes;
  abortSignal?: AbortSignal;
}): Promise<{ markdown: string; status: "named" | "cached" | "fallback" | "skipped"; message?: string }> {
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
  if (parsedSaved?.digest === digest) return { markdown: embedKnowledgeTopicTitles(base, parsedSaved.titles || {}), status: "cached" };
  const failed = await scope.read(`${scope.prefix}/failure.json`);
  if (failed?.digest === digest) return { markdown: base, status: "fallback", message: String(failed.message || "") };
  const invoke = params.invoke || invokeKnowledgePublicationRoutes;
  const fetchOptions = params.abortSignal
    ? { fetch: (url: any, init?: any) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, params.abortSignal!]) : params.abortSignal }) }
    : {};
  const batches: TitleTopic[][] = [];
  for (let i = 0; i < topics.length; i += KNOWLEDGE_TOPIC_TITLE_BATCH) batches.push(topics.slice(i, i + KNOWLEDGE_TOPIC_TITLE_BATCH));
  const titles: KnowledgeTopicTitles = {};
  const rejected: string[] = [];
  const summaries: { batch: number; topics: number; attempts: number; ok: boolean; named: number; error?: string }[] = [];

  /** 一批：请求保存一次；每次尝试的原始回包单独保存；校验不过重发，最多再发 KNOWLEDGE_TOPIC_TITLE_RESENDS 次；仍不过的页退回原标题。 */
  const runBatch = async (batch: TitleTopic[], b: number) => {
    const prefix = `${scope.prefix}/batch-${b}`;
    const batchDigest = createHash("sha256").update(`${digest}/batch/${b}/${batch.map(t => t.id).join(",")}`).digest("hex");
    const request: KnowledgeModelRequest = {
      executionChannel: "openrouter",
      executionFamily: String(params.model || "").includes("glm") ? "glm" : "deepseek",
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ sourceDigest: batchDigest, source: { title: plan.title, pages: batch.map(t => ({ id: t.id, headline: `主题${t.index + 1}`, body: `原小节：${t.headlines.join("｜")}\n\n${t.body}`, imageUrl: "" })) } }) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST, responseMimeType: "application/json" },
    };
    const saved = await scope.read(`${prefix}/request.json`);
    if (saved && saved.digest !== digest) throw Error("主题命题输入版本变化，保留原回执");
    if (!saved) await scope.save(`${prefix}/request.json`, { digest, batchDigest, request });
    let best: KnowledgeTopicTitles = {}, bestNamed = -1, bestRejected: string[] = [], attempts = 0, lastError: string | undefined;
    for (; attempts <= KNOWLEDGE_TOPIC_TITLE_RESENDS; ) {
      params.abortSignal?.throwIfAborted();
      attempts++;
      try {
        const response = await invoke(saved?.request || request, { ...scope, prefix: `${prefix}/attempt-${attempts}` }, fetchOptions);
        params.abortSignal?.throwIfAborted();
        // 原始回包先永久保存，再解析；解析结果另存，不覆盖原始对象。
        await scope.save(`${prefix}/raw-${attempts}.json`, { digest, attempt: attempts, responseText: response.text });
        const report = JSON.parse(JSON.parse(response.text).candidates[0].content.parts[0].text);
        const parsed = parseKnowledgeTopicTitles(report, batch);
        const named = batch.filter(t => topicNamed(parsed.titles[knowledgeTopicKey(t.headlines)], t.headlines)).length;
        if (named > bestNamed) { best = parsed.titles; bestNamed = named; bestRejected = parsed.rejected; }
        if (auditTopics(batch, parsed.titles).ok) break;
        lastError = `第${b + 1}批第${attempts}次校验未过：命题齐全${named}/${batch.length}`;
      } catch (error) {
        if (params.abortSignal?.aborted) throw error;
        lastError = `第${b + 1}批第${attempts}次失败：${error instanceof Error ? error.message : String(error)}`;
        if (attempts > KNOWLEDGE_TOPIC_TITLE_RESENDS) throw Object.assign(new Error(lastError), { cause: error });
      }
    }
    // 仍不过的页退回原标题：只保留逐页命题齐全的主题，其余不写入（出图/内文回退机械标题与原小节标题）。
    const kept: KnowledgeTopicTitles = {};
    for (const t of batch) {
      const key = knowledgeTopicKey(t.headlines), entry = best[key];
      if (topicNamed(entry, t.headlines)) kept[key] = entry!;
      else bestRejected.push(`${t.id}: 重发${attempts - 1}次后仍未命题齐全，退回原标题`);
    }
    const ok = auditTopics(batch, kept).ok;
    await scope.save(`${prefix}/parsed.json`, { digest, attempts, ok, named: Object.keys(kept).length, titles: kept, rejected: bestRejected, topics: batch.map(t => ({ id: t.id, headlines: t.headlines })), error: ok ? undefined : lastError });
    return { kept, rejected: bestRejected, attempts, ok, error: ok ? undefined : lastError };
  };

  const concurrency = knowledgeStageConcurrency(batches.length, { max: KNOWLEDGE_MODEL_CHANNEL_MAX.openrouter });
  const { results, errors } = await runKnowledgeStaggeredPool(batches, {
    lanes: Array.from({ length: concurrency }, () => "openrouter" as const),
    gates: { openrouter: new KnowledgeRateGate(KNOWLEDGE_MODEL_CHANNEL_MAX.openrouter) },
    worker: runBatch,
  });
  if (params.abortSignal?.aborted) throw errors[0]?.error ?? new Error("aborted");
  results.forEach((r, b) => {
    if (!r) { summaries.push({ batch: b, topics: batches[b]!.length, attempts: KNOWLEDGE_TOPIC_TITLE_RESENDS + 1, ok: false, named: 0, error: String(errors.find(e => e.index === b)?.error instanceof Error ? (errors.find(e => e.index === b)!.error as Error).message : errors.find(e => e.index === b)?.error ?? "") }); return; }
    Object.assign(titles, r.kept); rejected.push(...r.rejected);
    summaries.push({ batch: b, topics: batches[b]!.length, attempts: r.attempts, ok: r.ok, named: Object.keys(r.kept).length, error: r.error });
  });
  if (!Object.keys(titles).length) {
    const message = summaries.map(s => s.error).filter(Boolean).join("；") || "全部批次均未命题";
    await scope.save(`${scope.prefix}/failure.json`, { digest, message, batches: summaries });
    console.warn(`[knowledgeTopicTitles] 主题命题失败，回退机械标题：${message.slice(0, 200)}`);
    return { markdown: base, status: "fallback", message };
  }
  await scope.save(`${scope.prefix}/parsed.json`, { digest, titles, rejected, topics: topics.map(t => ({ id: t.id, headlines: t.headlines })), batches: summaries });
  return { markdown: embedKnowledgeTopicTitles(base, titles), status: "named", message: summaries.some(s => !s.ok) ? summaries.filter(s => !s.ok).map(s => s.error).join("；") : undefined };
}

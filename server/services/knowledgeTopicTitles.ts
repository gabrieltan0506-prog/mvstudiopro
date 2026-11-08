/**
 * 主题图命题（用户 2026-11-08 令）：每册每档一次廉价批量调用，为每个主题图拟定
 * 图片标题、图下内文标题与各小节内文小标题。走两档准备阶段已用的知识整理路由（FlashX / DeepSeek flash）。
 * 原始回包与解析结果分别永久保存；失败时回退机械标题与原小节标题，不阻断出图准备。
 */
import { createHash } from "node:crypto";
import { knowledgeEditionImagePlan } from "../../shared/knowledgeCardPagination";
import {
  KNOWLEDGE_TOPIC_TITLE_PLACEHOLDER,
  embedKnowledgeTopicTitles,
  knowledgeTopicKey,
  stripKnowledgeTopicTitles,
  type KnowledgeTopicTitles,
} from "../../shared/knowledgeTopicImagePlan";
import { KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST } from "./knowledgeModelCapabilities";
import {
  invokeKnowledgePublicationRoutes,
  type KnowledgeModelRequest,
  type KnowledgeRouteEvidence,
} from "./knowledgePublicationRoutes";

export const KNOWLEDGE_TOPIC_TITLES_VERSION = "topic-titles-v3";
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
  const topics = plan.images.map((image, i) => ({ id: uuid(i), headlines: image.headlines, body: image.body }));
  const scope = { ...params.evidence, prefix: `${params.evidence.prefix}/topic-titles/${plan.level}-${digest.slice(0, 16)}` };
  const parsedSaved = await scope.read(`${scope.prefix}/parsed.json`);
  if (parsedSaved?.digest === digest) return { markdown: embedKnowledgeTopicTitles(base, parsedSaved.titles || {}), status: "cached" };
  const failed = await scope.read(`${scope.prefix}/failure.json`);
  if (failed?.digest === digest) return { markdown: base, status: "fallback", message: String(failed.message || "") };
  const sourceDigest = digest;
  const request: KnowledgeModelRequest = {
    executionChannel: "openrouter",
    executionFamily: String(params.model || "").includes("glm") ? "glm" : "deepseek",
    systemInstruction: { parts: [{ text: `你为图文知识手册的每个主题图拟定标题。每个主题含若干原小节（见body首行“原小节：”后以｜分隔）与图内要点。
为每个主题写出三类具体标题（都要是概括内容的实际短语，不能写字段名，不能写“图片标题”“内文标题”“小标题”这类字样）：
1. 图片标题：≤16字，概括本主题核心，不用“等N节”。
2. 图下内文标题：≤20字，概括图下详细内文讲什么，与图片标题互补、不重复。
3. 每个原小节的内文小标题：≤16字，忠实原意，不新增事实、不加编号；必须改写，不得与原小节标题相同。
图片标题与图下内文标题也不得与任何原小节标题相同。
只依据给定文字，不编造。标题不含#、|、换行。
输出格式：knowledge_publication_v1 JSON，pages与输入同id同顺序、一个不少。每页reading.blocks依次为：第1项=图片标题，第2项=图下内文标题，第3项起按原小节顺序每节一项=该节内文小标题；每项是{type:"prose",title:<标题>,note:"",text:<说明>}，第1项text写"image"，第2项text写"reading"，其后各项text逐字写对应的原小节标题。blocks数量=2+原小节数。
示例（虚构主题，仅示意格式，不要照抄其中字词）：输入原小节“蒸发｜凝结｜降水”，则blocks为[{type:"prose",title:"太阳驱动的水循环",note:"",text:"image"},{type:"prose",title:"三种相变的条件与去向",note:"",text:"reading"},{type:"prose",title:"受热升空的水汽",note:"",text:"蒸发"},{type:"prose",title:"冷却成云",note:"",text:"凝结"},{type:"prose",title:"雨雪回到地面",note:"",text:"降水"}]。
每页其余字段：headline照抄输入headline，body写一句话说明本主题，imageDescription:"",imageStatus:"absent",facts:[{term:"主题",statement:一句话说明}],cautions:[]，reading.version=1，reading.subtitle=""，reading.accent="jade"。顶层：kind:"knowledge_publication_v1"，sourceDigest照抄输入值，title:"主题命题"。` }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ sourceDigest, source: { title: plan.title, pages: topics.map((t, i) => ({ id: t.id, headline: `主题${i + 1}`, body: `原小节：${t.headlines.join("｜")}\n\n${t.body}`, imageUrl: "" })) } }) }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST, responseMimeType: "application/json" },
  };
  const saved = await scope.read(`${scope.prefix}/request.json`);
  if (saved && saved.digest !== digest) throw Error("主题命题输入版本变化，保留原回执");
  if (!saved) await scope.save(`${scope.prefix}/request.json`, { digest, request });
  try {
    params.abortSignal?.throwIfAborted();
    const invoke = params.invoke || invokeKnowledgePublicationRoutes;
    const response = await invoke(saved?.request || request, scope, params.abortSignal
      ? { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, params.abortSignal!]) : params.abortSignal }) }
      : {});
    params.abortSignal?.throwIfAborted();
    // 原始回包先永久保存，再解析；解析结果另存，不覆盖原始对象。
    await scope.save(`${scope.prefix}/raw.json`, { digest, responseText: response.text });
    const report = JSON.parse(JSON.parse(response.text).candidates[0].content.parts[0].text);
    const { titles, rejected } = parseKnowledgeTopicTitles(report, topics);
    await scope.save(`${scope.prefix}/parsed.json`, { digest, titles, rejected, topics: topics.map(t => ({ id: t.id, headlines: t.headlines })) });
    return { markdown: embedKnowledgeTopicTitles(base, titles), status: "named" };
  } catch (error) {
    if (params.abortSignal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await scope.save(`${scope.prefix}/failure.json`, { digest, message });
    console.warn(`[knowledgeTopicTitles] 主题命题失败，回退机械标题：${message.slice(0, 200)}`);
    return { markdown: base, status: "fallback", message };
  }
}

import { knowledgeEditionParts } from "@shared/knowledgeCardEdition";
import { knowledgeCardCreditsForPages, knowledgeEditionImageChars, knowledgeEditionImagePlan, planKnowledgeCardPages, type KnowledgeCardPagePlan, type KnowledgeEditionImagePlan } from "@shared/knowledgeCardPagination";
import { knowledgeEditionBudgetCheck } from "@shared/knowledgeEditionBudget";
import { auditKnowledgeTopicTitles, knowledgeTopicTitleWarning, readKnowledgeTopicTitles } from "@shared/knowledgeTopicImagePlan";
import { knowledgeCardInputFingerprint, knowledgeCardInputKey } from "@shared/knowledgeCardSourceIdentity";
import type { LayoutSource } from "@shared/editableLayout";

/**
 * 1120 L8：大稿（6.7MB 完整版）在前端每次渲染、每次切档都重算两版规划，切档极卡。
 * 这里按「正文内容」做小型缓存：同一份正文无论渲染多少次、切档多少次只解析一次。
 * Map 以字符串内容为键（同一引用时比较是 O(1)），只留最近几份，避免长期占内存。
 */
const CACHE_LIMIT = 8;
function remember<V>(cache: Map<string, V>, key: string, compute: () => V): V {
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key); cache.set(key, hit);
    return hit;
  }
  const value = compute();
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return value;
}

/** 与 knowledgeEditionParts 同一判定：文本开头有两档标记才是两档稿；合线时由 shared 的同名导出统一。 */
export function isKnowledgeEditionManuscript(text: string | null | undefined): boolean {
  return typeof text === "string" && /^<!-- knowledge-edition:v2:(full|concise) -->/.test(text);
}

const imagePlanCache = new Map<string, { plan: KnowledgeEditionImagePlan | null; error: boolean }>();
/** knowledgeEditionImagePlan 的缓存版；解析抛错时返回 undefined（与调用方原 try/catch 语义一致）。 */
export function cachedKnowledgeEditionImagePlan(markdown: string): KnowledgeEditionImagePlan | null | undefined {
  const hit = remember(imagePlanCache, markdown, () => {
    try { return { plan: knowledgeEditionImagePlan(markdown), error: false }; }
    catch { return { plan: null, error: true }; }
  });
  return hit.error ? undefined : hit.plan;
}

const pagePlanCache = new Map<string, Map<string, KnowledgeCardPagePlan>>();
/** planKnowledgeCardPages 的缓存版（按正文 + 档位模型）。 */
export function cachedKnowledgeCardPagePlan(text: string, model?: string | null): KnowledgeCardPagePlan {
  const byModel = remember(pagePlanCache, text, () => new Map<string, KnowledgeCardPagePlan>());
  const modelKey = String(model ?? "");
  let plan = byModel.get(modelKey);
  if (!plan) { plan = planKnowledgeCardPages(text, model); byModel.set(modelKey, plan); }
  return plan;
}

const serverImagePages = new Map<string, number>();
/** 服务端两档整理时已按同一分页器算好的图片张数（editionPageCounts），按正文登记，前端直接取用。 */
export function rememberKnowledgeEditionServerPages(markdown: string | null | undefined, imagePages: unknown) {
  if (!markdown || !isKnowledgeEditionManuscript(markdown)) return;
  const n = Number(imagePages);
  if (!Number.isInteger(n) || n < 0) return;
  serverImagePages.delete(markdown); serverImagePages.set(markdown, n);
  while (serverImagePages.size > CACHE_LIMIT) serverImagePages.delete(serverImagePages.keys().next().value as string);
}

export type KnowledgeEditionChoiceCount = { pending: "selecting" | "awaiting_edition" } | { pending: null; pageCount: number; credits: number };
/** 选档面板的张数：服务端已给就用服务端；否则本地算一次（缓存）。没有两档标记的原稿不给张数。 */
export function knowledgeEditionChoiceCount(text: string | null | undefined, model: string): KnowledgeEditionChoiceCount {
  if (!text) return { pending: "selecting" };
  if (!isKnowledgeEditionManuscript(text)) return { pending: "awaiting_edition" };
  const server = serverImagePages.get(text);
  const pageCount = server ?? cachedKnowledgeCardPagePlan(text, model).pageCount;
  return { pending: null, pageCount, credits: knowledgeCardCreditsForPages(pageCount, model) };
}

const readingSummaryCache = new Map<string, ReturnType<typeof computeReadingSummary>>();
function computeReadingSummary(markdown: string) {
  const parts = knowledgeEditionParts(markdown);
  if (!parts) return null;
  const topics = cachedKnowledgeEditionImagePlan(markdown);
  if (!topics) return null;
  // 图数按主题定（每图≤1200字的核心图解）；图外细节与独立文字一起计入内文。
  const check = knowledgeEditionBudgetCheck(parts.level, topics.images.length, topics.readingChars, knowledgeEditionImageChars(topics));
  // 命题核查：缺项会以机械标题出图，确认前提示。
  const titleWarning = knowledgeTopicTitleWarning(auditKnowledgeTopicTitles(topics.images, readKnowledgeTopicTitles(markdown)));
  return { ...check, titleWarning };
}
/** 阅读页数摘要（KnowledgeEditionReadingCount 用），按正文缓存。 */
export function knowledgeEditionReadingSummary(markdown: string | null) {
  if (!markdown || !isKnowledgeEditionManuscript(markdown)) return null;
  return remember(readingSummaryCache, markdown, () => computeReadingSummary(markdown));
}

/**
 * 出图前确认的「文字页数」（1119 C2）。只读计算，不发请求、不收费；算不出时返回 null。
 */
export function knowledgeCardPlannedTextPages(illustrationMarkdown: string, source: Pick<LayoutSource, "pages"> | null, cardsOnly = false): number | null {
  if (cardsOnly) return 0;
  const parts = knowledgeEditionParts(illustrationMarkdown);
  if (parts) {
    const topics = cachedKnowledgeEditionImagePlan(illustrationMarkdown);
    if (!topics) return null;
    return knowledgeEditionBudgetCheck(parts.level, topics.images.length, topics.readingChars, knowledgeEditionImageChars(topics)).plannedTextPages;
  }
  const pages = source?.pages;
  if (!pages) return null;
  return pages.filter((page) => !page.imageJobId).length;
}

/**
 * 比较键（1120 L8）：原先每次渲染把正文与完整稿 JSON.stringify 成约 900 万字的键。
 * 改为给每份正文分配一个小编号（同内容同编号），键只含编号与短字段，渲染路径 O(1)。
 * 语义不变：键相等 ⇔ 原 knowledgeCardInputKey 的各字段逐字相等（编号表淘汰后只会更保守地判为不同）。
 */
const textIds = new Map<string, number>();
let nextTextId = 1;
function textId(text: string): number {
  return remember(textIds, text, () => nextTextId++);
}
type InputParts = { owner: string | null; text: string; full: string; level: string; template: string | null | undefined; model: string };
const inputPartsByKey = new Map<string, InputParts>();
export function knowledgeCardInputIdentityKey(input: InputParts): string {
  const text = input.text.trim(), full = input.full.trim();
  const key = JSON.stringify(["kc-input-id", input.owner, textId(text), textId(full), input.level, input.template || "", input.model]);
  remember(inputPartsByKey, key, () => ({ ...input, text, full }));
  return key;
}
const fingerprintCache = new Map<string, Promise<string>>();
/**
 * 指纹：仍是 SHA-256(原 knowledgeCardInputKey 全文 JSON)，与云稿 publication.inputFingerprint 逐字一致；
 * 只在 effect 里按编号键算一次并缓存，切回同一档不再重算。
 */
export function knowledgeCardInputIdentityFingerprint(identityKey: string): Promise<string> {
  const parts = inputPartsByKey.get(identityKey);
  if (!parts) return Promise.reject(new Error("比较键已过期"));
  return remember(fingerprintCache, identityKey, () => {
    const pending = knowledgeCardInputFingerprint(knowledgeCardInputKey(parts));
    pending.catch(() => fingerprintCache.delete(identityKey));
    return pending;
  });
}

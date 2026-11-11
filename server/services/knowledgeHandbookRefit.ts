/**
 * 图文手册「压缩适配」（用户 2026-11-11：34 图总页数控制在 48–54 页，用文字模型把正文压进版面，不只靠函数）。
 *
 * 对象：一本已审校、已确认（可已采用顾问整册排版）的稿件。沿用原图、不重新生图、不重新审校、不改原稿与已确认正文：
 * 所有改动只在整册视图的副本上进行，派生正文与回执永久写入 `knowledge-publications/user-<owner>/<doc>/refit/<digest>/`，
 * 成品写到带版本标记的独立导出目录（exportKnowledgePublication 的 derived.prefixTag）。
 *
 * 流程（全书合计 ≤2 次文字模型调用，复用 #1765 篇幅压缩链：函数去重 → 三跳路由 GLM@EvoLink → GLM@OpenRouter → DeepSeek）：
 * 1. 页数分配：knowledgeHandbookPagePlan（完整版 = 图数 × 1.41～1.59，≤72）；跨页章正文上限 420 字、图文同页章 700 字。
 * 2. 第 1 次调用：按字数找出超出本章版面的章，连同各自目标字数放进同一请求压缩。
 * 3. 预分页实测（排版服务逐章计页，新版服务另报实际版式与留白）：跨页章退回图文同页或超 2 页、图文同页章超 1 页，即为仍超。
 * 4. 第 2 次调用（仅仍超的章）：按实测页数换算更紧的目标字数再压一轮；之后仍超的章排成续页并报出，不截断。
 * 5. 总页数超过上限：先收跨页名额（图内文字最少的跨页章先改图文同页，再实测）；低于下限不凑页。
 */
import { createHash } from "node:crypto";
import type { EditableLayout } from "../../shared/editableLayout";
import type { KnowledgeReview, KnowledgeSource } from "../../shared/knowledgePublication";
import { knowledgeHandbookPagePlan, KNOWLEDGE_SPREAD_PAGE_CHARS, type KnowledgeHandbookPagePlan } from "../../shared/knowledgeHandbookPagePlan";
import { KNOWLEDGE_READING_CONTRACT, knowledgeReadingCharBudgets, type KnowledgeReadingOverflow } from "../../shared/knowledgeEditionBudget";
import { knowledgeReadingMarkdown } from "../../shared/knowledgePublicationLayout";
import { knowledgePublicationChapter, knowledgePublicationHead } from "../../shared/knowledgePublicationHtml";
import type { KnowledgeBookletImageMode } from "../../shared/knowledgeBooklet";
import { compressKnowledgeReviewToBudget, knowledgePublicationAdvisorDeps, knowledgeReviewPageChars, type KnowledgePublicationAdvisorDeps } from "./knowledgePublicationAdvisor";
import type { KnowledgeBookletMeasure } from "./pdfWorkerClient";
import type { KnowledgeDerivedExport } from "./knowledgePublicationExport";

export const KNOWLEDGE_REFIT_VERSION = "knowledge-refit-1111-v1";
/** 压缩适配每轮的模型调用上限：全书 2 轮、每轮 1 次请求（所有需要压的章放在同一请求）。 */
export const KNOWLEDGE_REFIT_MAX_CALLS = 2;

/** 整册视图（loadKnowledgeBookLayoutView 的返回）；派生视图原样交给 exportKnowledgePublication。 */
type View = NonNullable<KnowledgeDerivedExport["view"]>;
type ReviewPage = KnowledgeReview["pages"][number];
export type KnowledgeRefitDeps = {
  advisor?: KnowledgePublicationAdvisorDeps;
  /** 排版服务预分页（逐章一个片段）。 */
  measure: (html: string) => Promise<KnowledgeBookletMeasure>;
  /** 配图地址（签名 https 地址，与导出同源）。 */
  imageUrl: (uri: string) => Promise<string>;
  /** 预分页并发上限。 */
  concurrency?: number;
};
export type KnowledgeRefitRound = { round: number; targets: KnowledgeReadingOverflow[]; adopted: string[]; after: KnowledgeReadingOverflow[]; error?: string; usage?: unknown; model?: string; gateway?: string; routeSummary?: unknown; calls: number };
export type KnowledgeRefitResult = {
  view: View; imageModes: KnowledgeBookletImageMode[]; prefixTag: string; evidencePrefix: string; plan: KnowledgeHandbookPagePlan;
  summary: {
    chapters: number; images: number; range: KnowledgeHandbookPagePlan["range"]; spreadSlots: number;
    compressedChapters: number; modelCalls: number; rounds: KnowledgeRefitRound[];
    charsBefore: number; charsAfter: number; totalPages: number; spreadChapters: number; retractedSpreads: number;
    overflowChapters: { id: string; headline: string; pages: number; mode: string }[]; maxWhitespace: number | null; measuredDetails: boolean;
  };
};

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bodyOf = (page: ReviewPage) => (page.reading ? knowledgeReadingMarkdown(page.reading) : page.body);

async function pool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]!);
  }));
}

/** 读取一轮压缩的原始回包，取实际模型、网关、用量与路由摘要（不含正文）。 */
async function roundEvidence(advisor: KnowledgePublicationAdvisorDeps, prefix: string) {
  const raw = await advisor.read(`${prefix}/raw-0.json`);
  if (!raw?.response?.text) return { calls: 0 };
  try {
    const envelope = JSON.parse(raw.response.text);
    return { calls: 1, model: envelope.modelVersion, gateway: envelope.gateway, usage: envelope.usageMetadata, routeSummary: envelope.routeSummary };
  } catch { return { calls: 1 }; }
}

export async function refitKnowledgeHandbook(owner: number, view: View, deps: KnowledgeRefitDeps): Promise<KnowledgeRefitResult> {
  const advisor = deps.advisor ?? knowledgePublicationAdvisorDeps();
  const pub = view.doc.publication;
  if (!pub?.source) throw new Error("稿件缺少原稿资料，未做压缩适配");
  const source: KnowledgeSource = pub.source;
  const level = source.detailLevel;
  const plan = knowledgeHandbookPagePlan(level, source.pages.map(p => ({ id: p.id, body: p.body, hasImage: Boolean(p.imageUrl || p.imageJobId) })));
  // 版面预算：完整版按页数分配（跨页 420 / 图文同页 700）；其他档位沿用原逐章预算。
  const budgets = new Map<string, number>(level === "full"
    ? plan.chapters.map(c => [c.id, c.maxChars])
    : level ? knowledgeReadingCharBudgets(level, source.pages).pages.map(p => [p.id, p.maxChars]) : []);
  const allotted = new Map(plan.chapters.map(c => [c.id, c.mode]));
  const evidencePrefix = `knowledge-publications/user-${owner}/${view.doc.id}/refit/${sha([KNOWLEDGE_REFIT_VERSION, view.prefix, plan.chapters])}`;
  // 压缩只看整册视图里实际要印的正文（含顾问整册排版的展示稿）；去掉旧 reading，按正文计字。
  const original = view.doc.pages.map(p => p.body);
  let pages: ReviewPage[] = view.review.pages.map((r, i) => { const { reading: _reading, ...rest } = r; return { ...rest, body: view.doc.pages[i]!.body }; });
  const headline = new Map(view.doc.pages.map(p => [p.id, p.headline]));
  const overflowBy = (limits: Map<string, number>) => (list: ReviewPage[]): KnowledgeReadingOverflow[] => list.flatMap(p => {
    const max = limits.get(p.id), chars = knowledgeReviewPageChars(p);
    return max !== undefined && chars > max ? [{ id: p.id, headline: headline.get(p.id) || p.headline, chars, maxChars: max, excess: chars - max }] : [];
  });
  // 指令沿用新版正文合同（图中已有的不复述）；摘要沿用原审校，回包须回带同一摘要。
  const compressSource: KnowledgeSource = { ...source, readingContract: KNOWLEDGE_READING_CONTRACT };
  const rounds: KnowledgeRefitRound[] = [];
  const adopted = new Set<string>();
  const compress = async (round: number, limits: Map<string, number>) => {
    const prefix = `${evidencePrefix}/round-${round}`;
    const result = await compressKnowledgeReviewToBudget({ deps: advisor, prefix, attempt: 0, digest: view.review.sourceDigest, source: compressSource, pages, maxRounds: 1, measureOverflow: overflowBy(limits) });
    pages = result.pages;
    result.adopted.forEach(id => adopted.add(id));
    rounds.push({ round, targets: result.before, adopted: result.adopted, after: result.after, ...(result.error ? { error: result.error } : {}), ...await roundEvidence(advisor, prefix) });
  };

  if (overflowBy(budgets)(pages).length) await compress(1, budgets);

  const derivedDoc = (): EditableLayout => ({ ...view.doc, pages: view.doc.pages.map((p, i) => ({ ...p, body: bodyOf(pages[i]!) })) });
  const modes: KnowledgeBookletImageMode[] = view.doc.pages.map(p => (p.imageUrl && allotted.get(p.id) === "spread" ? "spread" : "inline"));
  const addresses = new Map<string, Promise<string>>();
  const addressOf = (uri: string) => { if (!addresses.has(uri)) addresses.set(uri, deps.imageUrl(uri)); return addresses.get(uri)!; };
  const measured: { pages: number; mode?: string; maxWhitespace?: number }[] = new Array(view.doc.pages.length);
  let measuredDetails = true;
  const measure = async (indexes: number[]) => {
    const doc = derivedDoc();
    await pool(indexes, deps.concurrency ?? 8, async i => {
      const page = doc.pages[i]!, next = doc.pages[i + 1];
      const html = knowledgePublicationHead(doc.title) + knowledgePublicationChapter(doc, view.review, i, page.imageUrl ? await addressOf(page.imageUrl) : "", false, next?.imageUrl ? await addressOf(next.imageUrl) : "", modes[i]) + "</body></html>";
      const result = await deps.measure(html);
      const detail = result.booklets[0];
      if (!detail) measuredDetails = false;
      measured[i] = { pages: result.pages, mode: detail?.imageModes?.[page.id], maxWhitespace: detail?.maxWhitespace };
    });
  };
  // 仍超：跨页章没排成跨页（或超过 2 页）、图文同页章超过 1 页。旧版排版服务不报版式时只按页数判断。
  const over = (i: number) => {
    const m = measured[i]!;
    return modes[i] === "spread" ? m.pages > 2 || (m.mode !== undefined && m.mode !== "spread") : m.pages > 1;
  };
  const all = view.doc.pages.map((_, i) => i);
  await measure(all);

  const still = all.filter(over);
  if (still.length) {
    // 第 2 次调用：按实测换算目标——跨页退回者压到跨页容量以内；超页者按「现有字数 ÷ 实测页数 × 允许页数」再留 5% 余量。
    const tighter = new Map<string, number>();
    for (const i of still) {
      const page = pages[i]!, chars = knowledgeReviewPageChars(page), m = measured[i]!;
      const fellBack = modes[i] === "spread" && m.mode !== undefined && m.mode !== "spread";
      const target = fellBack ? Math.min(chars * 0.8, KNOWLEDGE_SPREAD_PAGE_CHARS * 0.95) : chars * (modes[i] === "spread" ? 2 : 1) / Math.max(m.pages, 2) * 0.9;
      tighter.set(page.id, Math.max(80, Math.min(budgets.get(page.id) ?? chars, Math.floor(target))));
    }
    await compress(2, tighter);
    await measure(still);
  }

  // 总页数守上限：先收跨页名额（图内文字最少者先收），每收一章即实测该章。
  let retracted = 0;
  const total = () => measured.reduce((n, m) => n + m.pages, 0);
  if (plan.range) {
    const byDensity = new Map(plan.chapters.map(c => [c.id, c.density]));
    const order = all.filter(i => modes[i] === "spread").sort((a, b) => (byDensity.get(view.doc.pages[a]!.id)! - byDensity.get(view.doc.pages[b]!.id)!) || b - a);
    for (const i of order) {
      if (total() <= plan.range.max) break;
      modes[i] = "inline"; retracted++;
      await measure([i]);
    }
  }

  const doc = derivedDoc();
  const charsBefore = original.reduce((n, b) => n + b.replace(/\s+/g, "").length, 0);
  const charsAfter = doc.pages.reduce((n, p) => n + p.body.replace(/\s+/g, "").length, 0);
  const prefixTag = `refit-${sha([KNOWLEDGE_REFIT_VERSION, doc.pages.map(p => p.body), modes]).slice(0, 16)}`;
  const overflowChapters = all.filter(i => (modes[i] === "spread" ? measured[i]!.pages > 2 : measured[i]!.pages > 1))
    .map(i => ({ id: doc.pages[i]!.id, headline: doc.pages[i]!.headline, pages: measured[i]!.pages, mode: modes[i]! }));
  const whitespace = measured.map(m => m.maxWhitespace).filter((w): w is number => typeof w === "number");
  const summary = {
    chapters: doc.pages.length, images: plan.images, range: plan.range, spreadSlots: plan.spreadSlots,
    compressedChapters: adopted.size, modelCalls: rounds.reduce((n, r) => n + r.calls, 0), rounds,
    charsBefore, charsAfter, totalPages: total(),
    spreadChapters: all.filter(i => modes[i] === "spread" && (measured[i]!.mode ?? "spread") === "spread").length,
    retractedSpreads: retracted, overflowChapters, maxWhitespace: whitespace.length ? Math.max(...whitespace) : null, measuredDetails,
  };
  // 原正文与派生正文、逐章版式、各轮回执摘要永久保存：可回退、可复核；原稿本身从未被改写。
  await advisor.save(`${evidencePrefix}/derived.json`, {
    version: KNOWLEDGE_REFIT_VERSION, documentId: view.doc.id, sourceDigest: view.review.sourceDigest, viewPrefix: view.prefix, prefixTag,
    pages: doc.pages.map((p, i) => ({ id: p.id, headline: p.headline, original: original[i], derived: p.body, mode: modes[i], measuredPages: measured[i]!.pages, measuredMode: measured[i]!.mode })),
    summary,
  });
  return { view: { ...view, doc }, imageModes: modes, prefixTag, evidencePrefix, plan, summary };
}

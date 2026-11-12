/**
 * 图文手册「压缩适配」（用户 2026-11-11：34 图总页数控制在 48–54 页，用文字模型把正文压进版面，不只靠函数）。
 *
 * 对象：一本已审校、已确认（可已采用顾问整册排版）的稿件。沿用原图、不重新生图、不重新审校、不改原稿与已确认正文：
 * 所有改动只在整册视图的副本上进行，派生正文与回执永久写入 `knowledge-publications/user-<owner>/<doc>/refit/<digest>/`，
 * 成品写到带版本标记的独立导出目录（exportKnowledgePublication 的 derived.prefixTag）。
 *
 * 流程（全书合计 ≤2 轮文字模型压缩，复用 #1765 篇幅压缩链：函数去重 → 三跳路由 GLM@EvoLink → GLM@OpenRouter → DeepSeek；
 *   2026-11-13 起每轮超出章三章一组、各组并发发出——全部超出章放进同一请求会超过整条链约 10 分钟上限）：
 * 版式（2026-11-13 站长：不再切图）：取消跨页，所有章一律图文同页——整张横版图在上、两栏正文在下、放不完接纯文字续页。
 * 1. 页数分配：knowledgeHandbookPagePlan（完整版 = 图数 × 1.41～1.59，≤72，只作上限校核与报告）；不分配跨页名额，
 *    每章正文上限一律图文同页档 700 字（KNOWLEDGE_LEAD_PAGE_CHARS）。
 * 2. 第 1 轮：按字数找出超出本章版面的章，三章一组、各带各自目标字数，各组并发压缩。
 * 3. 预分页实测（排版服务逐章计页，新版服务另报实际版式与留白）：超过 1 页即为仍超。
 * 4. 第 2 轮（仅仍超的章）：按实测页数换算更紧的目标字数再压一轮；之后仍超的章排成续页并报出，不截断。
 * 5. 总页数超过上限：已无跨页名额可收，只如实报出（retractedSpreads 恒为 0、spreadChapters 恒为 0，字段保留）；低于下限不凑页。
 */
import { createHash } from "node:crypto";
import type { EditableLayout } from "../../shared/editableLayout";
import type { KnowledgeReview, KnowledgeSource } from "../../shared/knowledgePublication";
import { knowledgeHandbookPagePlan, type KnowledgeHandbookPagePlan } from "../../shared/knowledgeHandbookPagePlan";
import { KNOWLEDGE_READING_CONTRACT, knowledgeReadingCharBudgets, type KnowledgeReadingOverflow } from "../../shared/knowledgeEditionBudget";
import { knowledgeReadingMarkdown } from "../../shared/knowledgePublicationLayout";
import { knowledgePublicationChapter, knowledgePublicationHead } from "../../shared/knowledgePublicationHtml";
import type { KnowledgeBookletImageMode } from "../../shared/knowledgeBooklet";
import { compressKnowledgeReviewToBudget, knowledgePublicationAdvisorDeps, knowledgeReviewPageChars, type KnowledgePublicationAdvisorDeps } from "./knowledgePublicationAdvisor";
import type { KnowledgeBookletMeasure } from "./pdfWorkerClient";
import type { KnowledgeDerivedExport } from "./knowledgePublicationExport";

export const KNOWLEDGE_REFIT_VERSION = "knowledge-refit-1111-v1";
/** 压缩适配的轮数上限：全书 2 轮；每轮三章一组、各组并发发出（不多于一组时即一次请求）。 */
export const KNOWLEDGE_REFIT_MAX_ROUNDS = 2;

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
async function roundEvidence(advisor: KnowledgePublicationAdvisorDeps, prefixes: readonly string[]) {
  // 每个回执目录一次请求（整批一个目录；分组并发时每组一个）；用量按请求列出，不合并估算。
  const raws = (await Promise.all(prefixes.map(prefix => advisor.read(`${prefix}/raw-0.json`)))).filter(raw => raw?.response?.text);
  if (!raws.length) return { calls: 0 };
  const envelopes = raws.map(raw => { try { return JSON.parse(raw.response.text); } catch { return undefined; } });
  const first = envelopes.find(Boolean);
  if (raws.length === 1) return first ? { calls: 1, model: first.modelVersion, gateway: first.gateway, usage: first.usageMetadata, routeSummary: first.routeSummary } : { calls: 1 };
  return { calls: raws.length, model: first?.modelVersion, usage: envelopes.map(e => ({ gateway: e?.gateway, usage: e?.usageMetadata })) };
}

export async function refitKnowledgeHandbook(owner: number, view: View, deps: KnowledgeRefitDeps): Promise<KnowledgeRefitResult> {
  const advisor = deps.advisor ?? knowledgePublicationAdvisorDeps();
  const pub = view.doc.publication;
  if (!pub?.source) throw new Error("稿件缺少原稿资料，未做压缩适配");
  const source: KnowledgeSource = pub.source;
  const level = source.detailLevel;
  const plan = knowledgeHandbookPagePlan(level, source.pages.map(p => ({ id: p.id, body: p.body, hasImage: Boolean(p.imageUrl || p.imageJobId) })));
  // 版面预算：完整版一律图文同页档（700）；其他档位沿用原逐章预算。
  const budgets = new Map<string, number>(level === "full"
    ? plan.chapters.map(c => [c.id, c.maxChars])
    : level ? knowledgeReadingCharBudgets(level, source.pages).pages.map(p => [p.id, p.maxChars]) : []);
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
    rounds.push({ round, targets: result.before, adopted: result.adopted, after: result.after, ...(result.error ? { error: result.error } : {}), ...await roundEvidence(advisor, result.receiptPrefixes) });
  };

  if (overflowBy(budgets)(pages).length) await compress(1, budgets);

  const derivedDoc = (): EditableLayout => ({ ...view.doc, pages: view.doc.pages.map((p, i) => ({ ...p, body: bodyOf(pages[i]!) })) });
  // 不再切图：所有章一律图文同页。
  const modes: KnowledgeBookletImageMode[] = view.doc.pages.map(() => "inline");
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
  // 仍超：图文同页章超过 1 页。
  const over = (i: number) => measured[i]!.pages > 1;
  const all = view.doc.pages.map((_, i) => i);
  await measure(all);

  const still = all.filter(over);
  if (still.length) {
    // 第 2 次调用：按实测换算目标——「现有字数 ÷ 实测页数 × 允许页数（1）」再留余量。
    const tighter = new Map<string, number>();
    for (const i of still) {
      const page = pages[i]!, chars = knowledgeReviewPageChars(page), m = measured[i]!;
      const target = chars / Math.max(m.pages, 2) * 0.9;
      tighter.set(page.id, Math.max(80, Math.min(budgets.get(page.id) ?? chars, Math.floor(target))));
    }
    await compress(2, tighter);
    await measure(still);
  }

  // 总页数：取消跨页后没有名额可收；超上限只如实报出（totalPages 对照 range.max），不截断、不加调用。
  const total = () => measured.reduce((n, m) => n + m.pages, 0);

  const doc = derivedDoc();
  const charsBefore = original.reduce((n, b) => n + b.replace(/\s+/g, "").length, 0);
  const charsAfter = doc.pages.reduce((n, p) => n + p.body.replace(/\s+/g, "").length, 0);
  const prefixTag = `refit-${sha([KNOWLEDGE_REFIT_VERSION, doc.pages.map(p => p.body), modes]).slice(0, 16)}`;
  const overflowChapters = all.filter(over)
    .map(i => ({ id: doc.pages[i]!.id, headline: doc.pages[i]!.headline, pages: measured[i]!.pages, mode: modes[i]! }));
  const whitespace = measured.map(m => m.maxWhitespace).filter((w): w is number => typeof w === "number");
  const summary = {
    chapters: doc.pages.length, images: plan.images, range: plan.range, spreadSlots: plan.spreadSlots,
    compressedChapters: adopted.size, modelCalls: rounds.reduce((n, r) => n + r.calls, 0), rounds,
    charsBefore, charsAfter, totalPages: total(),
    // 字段保留：无跨页，恒为 0。
    spreadChapters: 0,
    retractedSpreads: 0, overflowChapters, maxWhitespace: whitespace.length ? Math.max(...whitespace) : null, measuredDetails,
  };
  // 原正文与派生正文、逐章版式、各轮回执摘要永久保存：可回退、可复核；原稿本身从未被改写。
  await advisor.save(`${evidencePrefix}/derived.json`, {
    version: KNOWLEDGE_REFIT_VERSION, documentId: view.doc.id, sourceDigest: view.review.sourceDigest, viewPrefix: view.prefix, prefixTag,
    pages: doc.pages.map((p, i) => ({ id: p.id, headline: p.headline, original: original[i], derived: p.body, mode: modes[i], measuredPages: measured[i]!.pages, measuredMode: measured[i]!.mode })),
    summary,
  });
  return { view: { ...view, doc }, imageModes: modes, prefixTag, evidencePrefix, plan, summary };
}

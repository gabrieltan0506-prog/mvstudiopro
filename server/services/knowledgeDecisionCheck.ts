/**
 * 图文知识手册·审校后参考自查（1113，Gemini Decision 1 选择题判定）。
 *
 * 只做参考：不新增阻断类别、不改稿、不触发压缩、不扣费；结果只落证据目录供管理/审计查看。
 * 缺省关闭：KNOWLEDGE_DECISION_CHECK=1 才执行（合并本改动不改变任何生产行为）。
 *
 * 只对「图主文辅」新稿（readingContract=image-primary-v1）中带图的章执行：
 *   图内文字 = 原稿该章 body；图下说明 = 审校稿 reading（无 reading 时为审校稿 body）。
 * 每章两题（每题一个 id）：
 *   restate   —— 图下说明是否只是复述图内文字，还是补充了新信息；
 *   unsourced —— 图下说明里是否有本章（图内文字 + 本章来源）找不到依据的数字或论断。
 * 多章合并为一次调用（每批 KNOWLEDGE_DECISION_CHECK_BATCH 章，缺省 4 章 = 8 题）。
 *
 * 证据：<root>/decision-check/<pagesSha>/batch-<n>/{request,raw-1,raw-2,parsed,failure}.json（只增，按内容摘要分目录，
 * 同一内容重入零调用）；汇总 <root>/decision-check/<pagesSha>/summary.json，另写指针 <root>/decision-check/latest.json。
 */
import { createHash, randomUUID } from "node:crypto";
import { KNOWLEDGE_READING_CONTRACT } from "../../shared/knowledgeEditionBudget";
import { knowledgeReadingMarkdown } from "../../shared/knowledgePublicationLayout";
import type { KnowledgeSource } from "../../shared/knowledgePublication";
import { runGeminiDecision, type GeminiDecisionQuestion, type GeminiDecisionResult } from "./geminiDecisionGateway";

export const KNOWLEDGE_DECISION_CHECK_ENV = "KNOWLEDGE_DECISION_CHECK";
export const KNOWLEDGE_DECISION_CHECK_BATCH_ENV = "KNOWLEDGE_DECISION_CHECK_BATCH";
export const KNOWLEDGE_DECISION_CHECK_DEFAULT_BATCH = 4;

type Env = Record<string, string | undefined>;
export function knowledgeDecisionCheckEnabled(env: Env = process.env): boolean {
  return String(env[KNOWLEDGE_DECISION_CHECK_ENV] ?? "").trim() === "1";
}
export function knowledgeDecisionCheckBatchSize(env: Env = process.env): number {
  const n = Number(String(env[KNOWLEDGE_DECISION_CHECK_BATCH_ENV] ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : KNOWLEDGE_DECISION_CHECK_DEFAULT_BATCH;
}

export const KNOWLEDGE_DECISION_RESTATE_OPTIONS = [
  { id: "restates", description: "图下说明基本只是把图内文字换个说法再讲一遍，几乎没有新信息" },
  { id: "partial", description: "图下说明有一部分重复图内文字，也补充了一些图内没有的信息" },
  { id: "adds", description: "图下说明主要在补充图内没有的新信息（背景、原因、例子、做法等）" },
] as const;
export const KNOWLEDGE_DECISION_UNSOURCED_OPTIONS = [
  { id: "none", description: "图下说明中的数字和明确论断都能在本章图内文字或本章来源中找到依据" },
  { id: "some", description: "有少量数字或明确论断在本章图内文字和本章来源中找不到依据" },
  { id: "many", description: "有多处数字或明确论断在本章图内文字和本章来源中找不到依据" },
] as const;

export type KnowledgeDecisionPage = {
  id: string;
  headline: string;
  body: string;
  reading?: Parameters<typeof knowledgeReadingMarkdown>[0];
  sources?: { title?: string; url?: string }[];
};

export type KnowledgeDecisionChapter = { index: number; pageId: string; headline: string; imageText: string; prose: string; sources: string[] };

/** 纯函数：选出要自查的章（图主文辅新稿、带图、图内文字与说明都非空）。 */
export function knowledgeDecisionChapters(source: Pick<KnowledgeSource, "readingContract" | "pages">, pages: readonly KnowledgeDecisionPage[]): KnowledgeDecisionChapter[] {
  if (source.readingContract !== KNOWLEDGE_READING_CONTRACT) return [];
  const originals = new Map(source.pages.map((p) => [p.id, p]));
  const out: KnowledgeDecisionChapter[] = [];
  pages.forEach((page, index) => {
    const original = originals.get(page.id);
    if (!original || !(original.imageJobId || original.imageUrl || original.role === "illustration")) return;
    const imageText = String(original.body || "").trim();
    const prose = (page.reading ? knowledgeReadingMarkdown(page.reading) : page.body).trim();
    if (!imageText || !prose) return;
    const sources = (page.sources || []).map((s) => [s.title, s.url].filter(Boolean).join(" ")).filter(Boolean);
    out.push({ index, pageId: page.id, headline: page.headline, imageText, prose, sources });
  });
  return out;
}

/** 纯函数：一批章节 → 一次判定的 input 与题目（每章两题，题 id = c<章序>_restate / c<章序>_unsourced）。 */
export function buildKnowledgeDecisionBatch(chapters: readonly KnowledgeDecisionChapter[]): { input: string; questions: GeminiDecisionQuestion[] } {
  const input = [
    "以下是一本图文手册中的若干章。每章由一张信息图（图内文字已转写）和图下的说明文字组成。",
    "请只依据每道题指定的那一章作答，不要用其他章的内容判断。",
    ...chapters.map((c) => [
      `===== 第${c.index + 1}章：${c.headline} =====`,
      "【图内文字】",
      c.imageText,
      "【图下说明】",
      c.prose,
      "【本章来源】",
      c.sources.length ? c.sources.join("\n") : "（无）",
    ].join("\n")),
  ].join("\n\n");
  const questions: GeminiDecisionQuestion[] = chapters.flatMap((c) => [
    {
      id: `c${c.index + 1}_restate`,
      instructions: `只看第${c.index + 1}章「${c.headline}」：比较【图下说明】与【图内文字】，图下说明是在复述图内文字，还是补充了新信息？`,
      options: KNOWLEDGE_DECISION_RESTATE_OPTIONS,
    },
    {
      id: `c${c.index + 1}_unsourced`,
      instructions: `只看第${c.index + 1}章「${c.headline}」：【图下说明】中的数字、比例、年份和明确论断，能否在本章【图内文字】或【本章来源】中找到依据？常识性表述不算。`,
      options: KNOWLEDGE_DECISION_UNSOURCED_OPTIONS,
    },
  ]);
  return { input, questions };
}

export type KnowledgeDecisionChapterResult = {
  pageId: string;
  headline: string;
  restate: { choice: string | null; confidence: number | null; probabilities: Record<string, number> | null } | null;
  unsourced: { choice: string | null; confidence: number | null; probabilities: Record<string, number> | null } | null;
};
export type KnowledgeDecisionSummary = {
  kind: "knowledge_decision_check_v1";
  advisory: true;
  sourceDigest: string;
  pagesSha256: string;
  checkedAt: string;
  chapterCount: number;
  batches: { index: number; pageIds: string[]; status: GeminiDecisionResult["status"]; reason?: string; model?: string; attempts: number; totalInputTokens?: number | null; costUsd?: number | null }[];
  chapters: KnowledgeDecisionChapterResult[];
  /** 汇总计数（只作参考，不进入阻断判定）。 */
  flagged: { restates: string[]; unsourced: string[] };
};

type Deps = {
  read: (name: string) => Promise<any>;
  save: (name: string, value: unknown) => Promise<void>;
  decide?: typeof runGeminiDecision;
  env?: Env;
};

const inFlight = new Map<string, Promise<KnowledgeDecisionSummary | null>>();

/**
 * 审校收尾后的参考自查。永不抛错、不改输入；关闭时零调用零读写。
 * 返回汇总（关闭 / 无可查章节时为 null）。
 */
export async function runKnowledgeDecisionCheck(params: {
  deps: Deps;
  root: string;
  digest: string;
  source: Pick<KnowledgeSource, "readingContract" | "pages">;
  pages: readonly KnowledgeDecisionPage[];
}): Promise<KnowledgeDecisionSummary | null> {
  const env = params.deps.env ?? process.env;
  if (!knowledgeDecisionCheckEnabled(env)) return null;
  try {
    const chapters = knowledgeDecisionChapters(params.source, params.pages);
    if (!chapters.length) return null;
    const pagesSha256 = createHash("sha256").update(JSON.stringify(chapters)).digest("hex");
    const base = `${params.root}/decision-check/${pagesSha256.slice(0, 16)}`;
    const key = `${base}|${params.digest}`;
    const running = inFlight.get(key);
    if (running) return await running;
    const job = (async () => {
      const prior = await params.deps.read(`${base}/summary.json`);
      if (prior?.pagesSha256 === pagesSha256 && prior?.sourceDigest === params.digest) return prior as KnowledgeDecisionSummary;
      const size = knowledgeDecisionCheckBatchSize(env);
      const decide = params.deps.decide ?? runGeminiDecision;
      const runId = randomUUID().slice(0, 8);
      const groups: KnowledgeDecisionChapter[][] = [];
      for (let i = 0; i < chapters.length; i += size) groups.push(chapters.slice(i, i + size));
      // 顺序发送：判定很便宜也很快，不与审校主链争并发。
      const batches: KnowledgeDecisionSummary["batches"] = [];
      const results: GeminiDecisionResult[] = [];
      for (let n = 0; n < groups.length; n++) {
        const { input, questions } = buildKnowledgeDecisionBatch(groups[n]);
        const prefix = `${base}/run-${runId}/batch-${n}`;
        const result = await decide({
          input,
          questions,
          label: `knowledge:${params.digest.slice(0, 8)}:b${n}`,
          save: async (name, value) => { await params.deps.save(`${prefix}/${name}.json`, value); },
          env,
        });
        results.push(result);
        batches.push({
          index: n,
          pageIds: groups[n].map((c) => c.pageId),
          status: result.status,
          attempts: result.attempts,
          model: result.model,
          ...(result.status === "ok" ? { totalInputTokens: result.totalInputTokens, costUsd: result.costUsd } : { reason: result.reason }),
        });
      }
      const pick = (result: GeminiDecisionResult, id: string) => {
        if (result.status !== "ok") return null;
        const a = result.answers[id];
        return a ? { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities } : null;
      };
      const chapterResults: KnowledgeDecisionChapterResult[] = groups.flatMap((group, n) => group.map((c) => ({
        pageId: c.pageId,
        headline: c.headline,
        restate: pick(results[n], `c${c.index + 1}_restate`),
        unsourced: pick(results[n], `c${c.index + 1}_unsourced`),
      })));
      const summary: KnowledgeDecisionSummary = {
        kind: "knowledge_decision_check_v1",
        advisory: true,
        sourceDigest: params.digest,
        pagesSha256,
        checkedAt: new Date().toISOString(),
        chapterCount: chapters.length,
        batches,
        chapters: chapterResults,
        flagged: {
          restates: chapterResults.filter((c) => c.restate?.choice === "restates").map((c) => c.pageId),
          unsourced: chapterResults.filter((c) => c.unsourced?.choice && c.unsourced.choice !== "none").map((c) => c.pageId),
        },
      };
      // 只有全部批次都取得结果才写可复用汇总；有不可用批次时只写本轮记录，下次重入再试。
      if (batches.every((b) => b.status === "ok")) await params.deps.save(`${base}/summary.json`, summary);
      await params.deps.save(`${base}/run-${runId}/summary.json`, summary);
      await params.deps.save(`${params.root}/decision-check/latest.json`, { ...summary, summaryKey: `${base}/run-${runId}/summary.json` });
      console.log(`[knowledgeDecisionCheck] digest=${params.digest.slice(0, 8)} chapters=${chapters.length} batches=${batches.length} ok=${batches.filter((b) => b.status === "ok").length} restates=${summary.flagged.restates.length} unsourced=${summary.flagged.unsourced.length}`);
      return summary;
    })();
    inFlight.set(key, job);
    try { return await job; } finally { inFlight.delete(key); }
  } catch (error) {
    console.warn(`[knowledgeDecisionCheck] 参考自查未完成（不影响审校）：${error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)}`);
    return null;
  }
}

/** 管理/审计读取：最近一次参考自查汇总（未开启或未跑过为 null）。 */
export async function readKnowledgeDecisionCheck(read: (name: string) => Promise<any>, root: string): Promise<KnowledgeDecisionSummary | null> {
  try {
    const saved = await read(`${root}/decision-check/latest.json`);
    return saved?.kind === "knowledge_decision_check_v1" ? saved : null;
  } catch {
    return null;
  }
}

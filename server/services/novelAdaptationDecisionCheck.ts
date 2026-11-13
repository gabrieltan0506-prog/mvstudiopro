/**
 * 小说改编·参考自查（1113，Gemini Decision 1 选择题判定）。
 *
 * 在 runManhuaNovelAdaptation 定稿小说（含碎句修订）之后、与剧本阶段并行执行；只做参考：
 * 不阻断、不改稿、不重写、不扣费（不碰任何积分代码），结果随改编结果返回并永久落证据。
 * 缺省关闭：NOVEL_ADAPTATION_DECISION_CHECK=1 才执行。
 *
 * 三题（一次调用）：
 *   opening_hook   —— 开篇前几段是否给出钩子；
 *   protagonist    —— 主角的身份、困境、目标是否交代齐全；
 *   core_setting   —— 是否保留底本的核心设定（人物、世界规则、核心事件）。
 * 证据：gemini-decision/novel-adaptation/<日期>/<uuid>/{request,raw-1,raw-2,parsed,failure,summary}.json（只增不覆盖）。
 */
import { createHash } from "node:crypto";
import type { ManhuaNovelAdaptation } from "../../shared/manhuaNovelAdaptation";
import type { ManhuaNovelExcerpt } from "../../shared/manhuaNovelSource";
import {
  createGeminiDecisionGcsSaver,
  geminiDecisionEvidencePrefix,
  runGeminiDecision,
  type GeminiDecisionQuestion,
  type GeminiDecisionSave,
} from "./geminiDecisionGateway";

export const NOVEL_ADAPTATION_DECISION_CHECK_ENV = "NOVEL_ADAPTATION_DECISION_CHECK";
type Env = Record<string, string | undefined>;
export function novelAdaptationDecisionCheckEnabled(env: Env = process.env): boolean {
  return String(env[NOVEL_ADAPTATION_DECISION_CHECK_ENV] ?? "").trim() === "1";
}

export const NOVEL_ADAPTATION_DECISION_QUESTIONS: readonly GeminiDecisionQuestion[] = [
  {
    id: "opening_hook",
    instructions: "只看【改编小说】开头的前几段（约前五段）：是否尽早给出让读者想继续读下去的钩子（悬念、冲突、反常或强烈的人物处境）？",
    options: [
      { id: "clear", description: "前几段就有明确的钩子" },
      { id: "weak", description: "有铺垫但钩子不够明确或出现得偏晚" },
      { id: "none", description: "前几段基本没有钩子，主要是背景交代或平铺叙述" },
    ],
  },
  {
    id: "protagonist",
    instructions: "通读【改编小说】：主角的身份（是谁）、困境（眼下面对的阻力或危机）、目标（想要达成什么）是否都交代清楚了？",
    options: [
      { id: "complete", description: "身份、困境、目标三项都交代清楚" },
      { id: "partial", description: "三项中缺一项或有一项含糊" },
      { id: "missing", description: "三项中有两项或以上缺失或含糊" },
    ],
  },
  {
    id: "core_setting",
    instructions: "对照【底本选段】与【改编小说】（可参考【改编说明】）：改编是否保留了底本的核心设定——主要人物、世界规则和核心事件？风格、视角或桥段的改动不算丢失。",
    options: [
      { id: "kept", description: "核心设定基本保留" },
      { id: "partly", description: "部分核心设定被改动或遗漏" },
      { id: "changed", description: "核心设定大多被替换或遗漏" },
    ],
  },
];

/** 纯函数：一次判定的 input（纯文本）。 */
export function buildNovelAdaptationDecisionInput(params: { source: ManhuaNovelExcerpt; novel: Pick<ManhuaNovelAdaptation, "title" | "text" | "adaptationNotes"> }): string {
  return [
    "以下是一段底本选段，以及据此改编的小说正文和改编说明。请按每道题的要求作答。",
    `【底本选段】${params.source.label ? `（${params.source.label}）` : ""}`,
    params.source.text,
    `【改编小说】《${params.novel.title}》`,
    params.novel.text,
    "【改编说明】",
    params.novel.adaptationNotes,
  ].join("\n\n");
}

export type NovelAdaptationDecisionAdvisory = {
  kind: "novel_adaptation_decision_check_v1";
  advisory: true;
  status: "ok" | "unavailable";
  reason?: string;
  model?: string;
  checkedAt: string;
  novelSha256: string;
  evidencePrefix?: string;
  answers: Record<string, { choice: string | null; confidence: number | null; probabilities: Record<string, number> | null } | null>;
  totalInputTokens?: number | null;
  costUsd?: number | null;
};

/**
 * 永不抛错；关闭时立即返回 null（零调用零读写）。
 */
export async function runNovelAdaptationDecisionCheck(
  params: { source: ManhuaNovelExcerpt; novel: ManhuaNovelAdaptation; requestId: string },
  deps: { env?: Env; decide?: typeof runGeminiDecision; save?: GeminiDecisionSave & { prefix?: string } } = {},
): Promise<NovelAdaptationDecisionAdvisory | null> {
  const env = deps.env ?? process.env;
  if (!novelAdaptationDecisionCheckEnabled(env)) return null;
  try {
    const save = deps.save ?? createGeminiDecisionGcsSaver(geminiDecisionEvidencePrefix("novel-adaptation"));
    const tag = createHash("sha256").update(params.requestId).digest("hex").slice(0, 12);
    const result = await (deps.decide ?? runGeminiDecision)({
      input: buildNovelAdaptationDecisionInput(params),
      questions: NOVEL_ADAPTATION_DECISION_QUESTIONS,
      label: `novel-adaptation:${tag}`,
      save,
      env,
    });
    const advisory: NovelAdaptationDecisionAdvisory = {
      kind: "novel_adaptation_decision_check_v1",
      advisory: true,
      status: result.status,
      model: result.model,
      checkedAt: new Date().toISOString(),
      novelSha256: createHash("sha256").update(params.novel.text).digest("hex"),
      ...(save.prefix ? { evidencePrefix: save.prefix } : {}),
      answers: Object.fromEntries(NOVEL_ADAPTATION_DECISION_QUESTIONS.map((q) => {
        const a = result.status === "ok" ? result.answers[q.id] : undefined;
        return [q.id, a ? { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities } : null];
      })),
      ...(result.status === "ok" ? { totalInputTokens: result.totalInputTokens, costUsd: result.costUsd } : { reason: result.reason }),
    };
    await Promise.resolve(save("summary", { requestTag: tag, sourceSha256: params.novel.sourceSha256, ...advisory })).catch(() => undefined);
    return advisory;
  } catch (error) {
    console.warn(`[novelAdaptationDecisionCheck] 参考自查未完成（不影响改编）：${error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)}`);
    return null;
  }
}

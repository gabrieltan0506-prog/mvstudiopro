/**
 * Gemini Decision 1（选择题判定）经 EvoLink「Decisions API」的最小网关（1113）。
 *
 * 用途：只做**参考性**的选择题判定（图文手册逐章自查、小说改编自查等），结果永远不阻断、不自动改稿、不扣用户积分。
 *
 * 线上合同（来自文档笔记，**截至 1113 尚未用真实调用验证**，以下标 UNVERIFIED 的字段均待首个真实回包校准）：
 *   POST {GEMINI_DECISION_API_URL 缺省 https://api.evolink.ai/v1beta/decisions}
 *   Authorization: Bearer <EVOLINK_API_KEY>（复用 getEvolinkApiKey，不新增密钥）
 *   body 只能有三个字段：model / input / questions —— 多发任何字段（stream、temperature…）会 HTTP 400。
 *     - model: "gemini-decision-1"（经 shared/geminiModelConfig 领域 geminiDecision 解析，可由 GEMINI_DECISION_MODEL 覆盖）
 *     - input: 纯文本（本网关只发文本；不发 parts、不发 base64 / inlineData 媒体）
 *     - questions: { <id>: { type: "choice", instructions: string, criteria: ... } }
 *         UNVERIFIED：criteria 的确切形状。本网关发「选项 id → 选项说明」对象（见 toWireCriteria，唯一出口，校准时只改这里）。
 *   回包：answers.<id>.choice / answers.<id>.probabilities / answers.<id>.confidence；usage.total_input_tokens
 *     UNVERIFIED：choice 是字符串还是对象、probabilities 是对象还是数组、confidence 是否必有、answers 是否可能为数组 ——
 *     解析器（parseGeminiDecisionResponse）对这些都做了宽容处理，缺失字段记 null，不抛错。
 *   计费：只按输入 token，$0.10 / 1M（GEMINI_DECISION_INPUT_USD_PER_MILLION）。UNVERIFIED：是否另有按题计费。
 *
 * 硬规则：
 *   - 原始回包在任何解析之前先永久落 GCS（只增不覆盖：uploadBufferToGcsIfAbsent / 调用方注入的 save）；失败、拒收、重试都不删。
 *   - 单发超时 + 最多重试 1 次；任何失败都返回 { status: "unavailable" }，绝不向调用方抛错。
 *   - 不在此处读取或打印密钥；日志只留标签、状态、耗时与 token 数。
 */
import { createHash, randomUUID } from "node:crypto";
import { resolveGeminiModel, type GeminiModelEnv } from "../../shared/geminiModelConfig";
import { getEvolinkApiKey } from "./gpt56CopywritingGateway";

export const GEMINI_DECISION_DEFAULT_URL = "https://api.evolink.ai/v1beta/decisions";
export const GEMINI_DECISION_URL_ENV = "GEMINI_DECISION_API_URL";
export const GEMINI_DECISION_TIMEOUT_ENV = "GEMINI_DECISION_TIMEOUT_MS";
export const GEMINI_DECISION_DEFAULT_TIMEOUT_MS = 45_000;
/** 单发失败后最多再试一次（共两发）。 */
export const GEMINI_DECISION_MAX_ATTEMPTS = 2;
/** 计费：只按输入 token，$0.10 / 1M（文档笔记，UNVERIFIED）。 */
export const GEMINI_DECISION_INPUT_USD_PER_MILLION = 0.1;

export const GEMINI_DECISION_QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const GEMINI_DECISION_OPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type GeminiDecisionOption = { id: string; description: string };
export type GeminiDecisionQuestion = {
  id: string;
  instructions: string;
  options: readonly GeminiDecisionOption[];
};

export type GeminiDecisionWireQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type GeminiDecisionWireRequest = {
  model: string;
  input: string;
  questions: Record<string, GeminiDecisionWireQuestion>;
};

export type GeminiDecisionAnswer = {
  /** 模型选中的选项 id；缺失或无法识别时为 null。 */
  choice: string | null;
  /** 选中项不在本题选项内（原值保留在 rawChoice）。 */
  unknownChoice: boolean;
  rawChoice?: unknown;
  /** 各选项概率；回包没有或形状不认识时为 null。 */
  probabilities: Record<string, number> | null;
  /** 0..1 置信度；回包没有时为 null。 */
  confidence: number | null;
};

export type GeminiDecisionParsed = {
  answers: Record<string, GeminiDecisionAnswer>;
  /** 本次提问但回包里没有答案的题 id。 */
  missing: string[];
  totalInputTokens: number | null;
  costUsd: number | null;
};

export type GeminiDecisionEvidenceRef = { objectName?: string; bytes?: number; sha256?: string } | void;
export type GeminiDecisionSave = (name: string, value: unknown) => Promise<GeminiDecisionEvidenceRef | unknown>;

export type GeminiDecisionResult =
  | ({ status: "ok"; model: string; attempts: number; elapsedMs: number; evidencePrefix?: string } & GeminiDecisionParsed)
  | { status: "unavailable"; reason: string; model?: string; attempts: number; elapsedMs: number; evidencePrefix?: string };

/** 选项 → 线上 criteria。UNVERIFIED：确切形状未经真实调用确认；校准时只改这一处。 */
export function toWireCriteria(options: readonly GeminiDecisionOption[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.description]));
}

/**
 * 纯函数：构造请求体。只含 model / input / questions 三个字段（多发会 400）。
 * 题目或选项不合法时抛错（由网关捕获并返回 unavailable）。
 */
export function buildGeminiDecisionRequest(params: {
  model: string;
  input: string;
  questions: readonly GeminiDecisionQuestion[];
}): GeminiDecisionWireRequest {
  const model = String(params.model || "").trim();
  if (!model) throw new Error("decision: model 为空");
  if (typeof params.input !== "string" || !params.input.trim()) throw new Error("decision: input 为空");
  if (/;base64,/i.test(params.input)) throw new Error("decision: input 不得含 base64 媒体");
  if (!params.questions.length) throw new Error("decision: 没有题目");
  const questions: Record<string, GeminiDecisionWireQuestion> = {};
  for (const q of params.questions) {
    if (!GEMINI_DECISION_QUESTION_ID_PATTERN.test(q.id)) throw new Error(`decision: 题目 id 不合法 ${JSON.stringify(q.id)}`);
    if (questions[q.id]) throw new Error(`decision: 题目 id 重复 ${q.id}`);
    const instructions = String(q.instructions || "").trim();
    if (!instructions) throw new Error(`decision: 题目 ${q.id} 缺少说明`);
    if (q.options.length < 2) throw new Error(`decision: 题目 ${q.id} 至少要两个选项`);
    const seen = new Set<string>();
    for (const o of q.options) {
      if (!GEMINI_DECISION_OPTION_ID_PATTERN.test(o.id)) throw new Error(`decision: 题目 ${q.id} 选项 id 不合法 ${JSON.stringify(o.id)}`);
      if (seen.has(o.id)) throw new Error(`decision: 题目 ${q.id} 选项 id 重复 ${o.id}`);
      if (!String(o.description || "").trim()) throw new Error(`decision: 题目 ${q.id} 选项 ${o.id} 缺少说明`);
      seen.add(o.id);
    }
    questions[q.id] = { type: "choice", instructions, criteria: toWireCriteria(q.options) };
  }
  return { model, input: params.input, questions };
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function readChoiceId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["id", "choice", "option", "label", "value", "name"]) {
      if (typeof o[key] === "string" && String(o[key]).trim()) return String(o[key]).trim();
    }
  }
  return null;
}

/** 概率：对象 { a: 0.7 } 或数组 [{ choice|option|id|label: "a", probability|p|score: 0.7 }] 都认。 */
function readProbabilities(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object") return null;
  const out: Record<string, number> = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = readChoiceId(o);
      const p = finiteNumber(o.probability ?? o.p ?? o.score ?? o.value);
      if (id && p !== null) out[id] = p;
    }
  } else {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const p = finiteNumber(raw && typeof raw === "object" ? (raw as Record<string, unknown>).probability : raw);
      if (p !== null) out[key] = p;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** answers 可能是 { id: {...} }，也可能是 [{ id|question|question_id: ..., ... }]（UNVERIFIED，两种都认）。 */
function readAnswerMap(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = [o.id, o.question, o.question_id, o.questionId].find((v) => typeof v === "string" && v);
      if (typeof id === "string") out[id] = o;
    }
    return out;
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * 纯函数：宽容解析回包。缺 probabilities / confidence 记 null；选中项不在选项里记 unknownChoice；
 * 回包里缺的题记入 missing。只在根本不是对象时抛错。
 */
export function parseGeminiDecisionResponse(
  body: unknown,
  questions: readonly GeminiDecisionQuestion[],
): GeminiDecisionParsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("decision: 回包不是 JSON 对象");
  const root = body as Record<string, unknown>;
  const answerMap = readAnswerMap(root.answers);
  const answers: Record<string, GeminiDecisionAnswer> = {};
  const missing: string[] = [];
  for (const q of questions) {
    const raw = answerMap[q.id];
    if (raw === undefined || raw === null) { missing.push(q.id); continue; }
    const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : { choice: raw };
    const rawChoice = o.choice ?? o.answer ?? o.selected;
    const choiceId = readChoiceId(rawChoice);
    const probabilities = readProbabilities(o.probabilities ?? o.probs);
    let confidence = finiteNumber(o.confidence);
    if (confidence !== null && (confidence < 0 || confidence > 1)) confidence = confidence > 1 && confidence <= 100 ? confidence / 100 : null;
    const known = choiceId !== null && q.options.some((opt) => opt.id === choiceId);
    answers[q.id] = {
      choice: known ? choiceId : null,
      unknownChoice: choiceId !== null && !known,
      ...(known ? {} : rawChoice !== undefined ? { rawChoice } : {}),
      probabilities,
      confidence,
    };
  }
  const usage = root.usage && typeof root.usage === "object" ? (root.usage as Record<string, unknown>) : {};
  const totalInputTokens = finiteNumber(usage.total_input_tokens ?? usage.input_tokens ?? usage.prompt_tokens);
  return {
    answers,
    missing,
    totalInputTokens,
    costUsd: totalInputTokens === null ? null : (totalInputTokens * GEMINI_DECISION_INPUT_USD_PER_MILLION) / 1_000_000,
  };
}

export function geminiDecisionEndpoint(env: GeminiModelEnv = process.env): string {
  const raw = String(env[GEMINI_DECISION_URL_ENV] ?? "").trim();
  return /^https:\/\/\S+$/i.test(raw) ? raw : GEMINI_DECISION_DEFAULT_URL;
}

export function geminiDecisionTimeoutMs(env: GeminiModelEnv = process.env): number {
  const n = Number(String(env[GEMINI_DECISION_TIMEOUT_ENV] ?? "").trim());
  return Number.isFinite(n) && n >= 1_000 && n <= 300_000 ? Math.floor(n) : GEMINI_DECISION_DEFAULT_TIMEOUT_MS;
}

/** 缺省证据目录：gemini-decision/<area>/<日期>/<uuid>。 */
export function geminiDecisionEvidencePrefix(area: string, now = new Date()): string {
  return `gemini-decision/${area.replace(/[^a-zA-Z0-9._/-]+/g, "_")}/${now.toISOString().slice(0, 10)}/${randomUUID()}`;
}

/** 缺省证据存储：GCS `<prefix>/<name>.json`，只增不覆盖（同名已存在即报错，不覆盖已付费回包）。 */
export function createGeminiDecisionGcsSaver(prefix: string): GeminiDecisionSave & { prefix: string } {
  const clean = prefix.replace(/\/+$/, "");
  const save = async (name: string, value: unknown) => {
    const { uploadBufferToGcsIfAbsent } = await import("./gcs");
    const buffer = Buffer.from(JSON.stringify(value));
    const objectName = `${clean}/${name}.json`;
    const saved = await uploadBufferToGcsIfAbsent({ objectName, buffer, contentType: "application/json; charset=utf-8" });
    if (!saved.created) throw new Error("decision 证据已存在，未覆盖原记录");
    return { objectName, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  };
  return Object.assign(save, { prefix: clean });
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * 发一次判定（含一次重试）。永不抛错：任何失败返回 { status: "unavailable", reason }。
 * 证据顺序：request → raw-<n>（每发原始回包，解析前）→ parsed / failure。
 */
export async function runGeminiDecision(params: {
  input: string;
  questions: readonly GeminiDecisionQuestion[];
  /** 日志标签（不含正文、地址、密钥）。 */
  label: string;
  /** 证据存储；缺省 GCS gemini-decision/<area>/<日期>/<uuid>/。 */
  save?: GeminiDecisionSave;
  area?: string;
  env?: GeminiModelEnv;
  fetchImpl?: typeof fetch;
  apiKey?: () => string;
  sleep?: (ms: number) => Promise<void>;
}): Promise<GeminiDecisionResult> {
  const started = Date.now();
  const env = params.env ?? (process.env as GeminiModelEnv);
  const label = String(params.label || "-").replace(/\s+/g, " ").slice(0, 80);
  let attempts = 0;
  let model: string | undefined;
  let evidencePrefix: string | undefined;
  const unavailable = (reason: string): GeminiDecisionResult => {
    const result = { status: "unavailable" as const, reason: reason.slice(0, 300), model, attempts, elapsedMs: Date.now() - started, ...(evidencePrefix ? { evidencePrefix } : {}) };
    console.warn(`[geminiDecision] ${label} unavailable attempts=${attempts} ms=${result.elapsedMs} reason=${result.reason.slice(0, 120)}`);
    return result;
  };
  try {
    let save = params.save;
    if (!save) {
      const gcsSave = createGeminiDecisionGcsSaver(geminiDecisionEvidencePrefix(params.area || "misc"));
      evidencePrefix = gcsSave.prefix;
      save = gcsSave;
    }
    model = resolveGeminiModel("geminiDecision", env);
    let request: GeminiDecisionWireRequest;
    try {
      request = buildGeminiDecisionRequest({ model, input: params.input, questions: params.questions });
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
    const endpoint = geminiDecisionEndpoint(env);
    await save("request", { endpoint, label, request, inputSha256: createHash("sha256").update(params.input).digest("hex"), at: new Date().toISOString() });
    const key = (params.apiKey ?? getEvolinkApiKey)();
    if (!key) {
      await Promise.resolve(save("failure", { reason: "missing_key", at: new Date().toISOString() })).catch(() => undefined);
      return unavailable("missing_key");
    }
    const doFetch = params.fetchImpl ?? fetch;
    const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const timeoutMs = geminiDecisionTimeoutMs(env);
    let lastReason = "unknown";
    for (let attempt = 1; attempt <= GEMINI_DECISION_MAX_ATTEMPTS; attempt++) {
      attempts = attempt;
      if (attempt > 1) await sleep(2_000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const sentAt = Date.now();
      let status = 0;
      let text = "";
      let contentType = "";
      try {
        const response = await doFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        status = response.status;
        contentType = response.headers?.get?.("content-type") || "";
        text = await response.text();
      } catch (error) {
        clearTimeout(timer);
        lastReason = controller.signal.aborted ? `timeout_${timeoutMs}ms` : `network:${error instanceof Error ? error.message : String(error)}`;
        await save(`raw-${attempt}`, { attempt, status: 0, error: lastReason, elapsedMs: Date.now() - sentAt, at: new Date().toISOString() });
        continue;
      }
      clearTimeout(timer);
      // 原始回包先落盘，再做任何解析（落盘失败即整次不可用，不解析）。
      await save(`raw-${attempt}`, {
        attempt,
        status,
        contentType,
        bytes: Buffer.byteLength(text),
        sha256: createHash("sha256").update(text).digest("hex"),
        elapsedMs: Date.now() - sentAt,
        text,
        at: new Date().toISOString(),
      });
      if (status < 200 || status >= 300) {
        lastReason = `http_${status}`;
        if (retryableStatus(status)) continue;
        break;
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        lastReason = "invalid_json";
        continue;
      }
      let parsed: GeminiDecisionParsed;
      try {
        parsed = parseGeminiDecisionResponse(body, params.questions);
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        continue;
      }
      await save("parsed", { attempt, model, ...parsed, at: new Date().toISOString() });
      const elapsedMs = Date.now() - started;
      console.log(`[geminiDecision] ${label} ok attempts=${attempt} ms=${elapsedMs} questions=${params.questions.length} missing=${parsed.missing.length} inputTokens=${parsed.totalInputTokens ?? "?"}`);
      return { status: "ok", model, attempts: attempt, elapsedMs, ...(evidencePrefix ? { evidencePrefix } : {}), ...parsed };
    }
    await Promise.resolve(save("failure", { reason: lastReason, attempts, at: new Date().toISOString() })).catch(() => undefined);
    return unavailable(lastReason);
  } catch (error) {
    return unavailable(`evidence_or_internal:${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * OpenAI Responses API（官方）· GPT-5.6 Sol
 * Pro = reasoning.mode: "pro"（非独立 model slug）
 * 官方失败时回退 Chat Completions（标准模式，走现有网关）。
 */

import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import {
  EVOLINK_CHAT_MODEL_GPT56_SOL,
  getEvolinkGpt56SolModel,
  normalizeEvolinkChatModel,
} from "./evolinkChatModel.js";
import { getOfficialOpenAiApiKey } from "./gpt56CopywritingGateway.js";

export const OPENAI_OFFICIAL_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type Gpt56ReasoningMode = "standard" | "pro";
export type Gpt56ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type Gpt56ResponsesInputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | {
      type: "input_file";
      filename: string;
      /** data:mime;base64,... */
      file_data: string;
      /** PDF 页图清晰度；仅 PDF 有效 */
      detail?: "auto" | "low" | "high";
    };

export type InvokeGpt56ResponsesOpts = {
  /** 纯文本 input；与 inputParts 二选一（有 parts 时优先 parts） */
  input?: string;
  /** 多模态：文本 + 图片 URL / data URL */
  inputParts?: Gpt56ResponsesInputPart[];
  instructions?: string;
  modelName?: string;
  reasoningMode?: Gpt56ReasoningMode;
  reasoningEffort?: Gpt56ReasoningEffort;
  /** 默认 false：不落库会话 */
  store?: boolean;
  /** 要求 JSON 对象（Responses text.format） */
  jsonObject?: boolean;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  /** 为 false 时官方 Responses 失败不回退 Chat Completions */
  fallbackChatCompletions?: boolean;
};

export type InvokeGpt56ResponsesResult = {
  text: string;
  responseId?: string;
  via: "responses" | "chat_completions";
  reasoningMode: Gpt56ReasoningMode;
};

function extractResponsesOutputText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const root = json as Record<string, unknown>;
  const direct = String(root.output_text || "").trim();
  if (direct) return direct;

  const output = Array.isArray(root.output) ? root.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "message" && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "output_text" || p.type === "text") {
          const t = String(p.text || "").trim();
          if (t) chunks.push(t);
        }
      }
    }
  }
  return chunks.join("\n").trim();
}

async function postOfficialResponses(opts: InvokeGpt56ResponsesOpts): Promise<InvokeGpt56ResponsesResult> {
  const apiKey = getOfficialOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing/invalid for Responses API");
  }
  const modelName = normalizeEvolinkChatModel(
    opts.modelName || getEvolinkGpt56SolModel(),
    EVOLINK_CHAT_MODEL_GPT56_SOL,
  );
  const reasoningMode: Gpt56ReasoningMode = opts.reasoningMode === "pro" ? "pro" : "standard";
  const reasoningEffort = opts.reasoningEffort || "medium";
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 180_000, 30_000), 600_000);

  const parts = Array.isArray(opts.inputParts) ? opts.inputParts.filter(Boolean) : [];
  const inputPayload =
    parts.length > 0
      ? [
          {
            role: "user",
            content: parts.map((p) => {
              if (p.type === "input_image") {
                return { type: "input_image", image_url: p.image_url };
              }
              if (p.type === "input_file") {
                return {
                  type: "input_file",
                  filename: p.filename,
                  file_data: p.file_data,
                  ...(p.detail ? { detail: p.detail } : {}),
                };
              }
              return { type: "input_text", text: String(p.text || "") };
            }),
          },
        ]
      : String(opts.input || "");

  const body: Record<string, unknown> = {
    model: modelName,
    input: inputPayload,
    store: opts.store === true,
    reasoning: {
      mode: reasoningMode,
      effort: reasoningEffort,
    },
  };
  const instructions = String(opts.instructions || "").trim();
  if (instructions) body.instructions = instructions;
  if (opts.jsonObject) {
    body.text = { format: { type: "json_object" } };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.abortSignal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(OPENAI_OFFICIAL_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err =
        json && typeof json === "object" && (json as { error?: { message?: string } }).error?.message
          ? String((json as { error: { message: string } }).error.message)
          : `HTTP ${res.status}`;
      throw new Error(err);
    }
    const text = extractResponsesOutputText(json);
    if (!text) throw new Error("Responses API returned empty output_text");
    const responseId =
      json && typeof json === "object" && typeof (json as { id?: unknown }).id === "string"
        ? String((json as { id: string }).id)
        : undefined;
    return { text, responseId, via: "responses", reasoningMode };
  } finally {
    clearTimeout(timer);
    opts.abortSignal?.removeEventListener("abort", onAbort);
  }
}

async function fallbackChatCompletions(opts: InvokeGpt56ResponsesOpts): Promise<InvokeGpt56ResponsesResult> {
  const modelName = normalizeEvolinkChatModel(
    opts.modelName || getEvolinkGpt56SolModel(),
    EVOLINK_CHAT_MODEL_GPT56_SOL,
  );
  const instructions = String(opts.instructions || "").trim();
  const parts = Array.isArray(opts.inputParts) ? opts.inputParts : [];
  const textFromParts = parts
    .filter((p): p is Extract<Gpt56ResponsesInputPart, { type: "input_text" }> => p.type === "input_text")
    .map((p) => p.text)
    .join("\n\n");
  const imageUrls = parts
    .filter((p): p is Extract<Gpt56ResponsesInputPart, { type: "input_image" }> => p.type === "input_image")
    .map((p) => p.image_url)
    .filter(Boolean);
  const fileNames = parts
    .filter((p): p is Extract<Gpt56ResponsesInputPart, { type: "input_file" }> => p.type === "input_file")
    .map((p) => p.filename);
  const fileNote =
    fileNames.length > 0
      ? `\n\n【附件】本次含文件：${fileNames.join("、")}（Chat Completions 回退无法完整解析 PDF/Office，请重试官方 Responses）。`
      : "";
  const userText = String(opts.input || textFromParts || "").trim() + fileNote;
  if (!userText.trim() && imageUrls.length === 0) throw new Error("Responses input is empty");

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };
  const userContent: string | ContentPart[] =
    imageUrls.length === 0
      ? userText
      : [
          ...(userText ? [{ type: "text" as const, text: userText }] : []),
          ...imageUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ];

  const messages: Array<{ role: "system" | "user"; content: string | ContentPart[] }> = [];
  if (instructions) messages.push({ role: "system", content: instructions });
  messages.push({ role: "user", content: userContent });

  const response = await invokeLLM({
    provider: "openai",
    modelName,
    max_tokens: 16_384,
    temperature: 0.8,
    reasoningEffort: opts.reasoningEffort === "none" ? "minimal" : "medium",
    messages: messages as Parameters<typeof invokeLLM>[0]["messages"],
    response_format: opts.jsonObject ? { type: "json_object" } : undefined,
    abortSignal: opts.abortSignal,
  });
  const text = extractFirstChoicePlainText(response).trim();
  if (!text) throw new Error("Chat Completions fallback returned empty content");
  return {
    text,
    via: "chat_completions",
    reasoningMode: "standard",
  };
}

/** 官方 Responses（可 Pro）→ 失败则 Chat Completions 标准模式 */
export async function invokeGpt56Responses(opts: InvokeGpt56ResponsesOpts): Promise<InvokeGpt56ResponsesResult> {
  const hasParts = Array.isArray(opts.inputParts) && opts.inputParts.length > 0;
  const input = String(opts.input || "").trim();
  if (!hasParts && !input) throw new Error("Responses input is empty");

  try {
    return await postOfficialResponses(opts);
  } catch (err) {
    const allowFallback = opts.fallbackChatCompletions !== false;
    if (!allowFallback) throw err;
    console.warn(
      "[gpt56Responses] official failed, fallback chat completions:",
      err instanceof Error ? err.message.slice(0, 240) : err,
    );
    return fallbackChatCompletions(opts);
  }
}

/** 只要纯文本 */
export async function invokeGpt56ResponsesText(opts: InvokeGpt56ResponsesOpts): Promise<string> {
  const r = await invokeGpt56Responses(opts);
  return r.text;
}

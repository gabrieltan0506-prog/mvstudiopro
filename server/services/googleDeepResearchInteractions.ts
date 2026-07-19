/**
 * Google Deep Research Agent · `@google/genai` `interactions`（背景任務 + 輪詢）
 *
 * - **Pro**（平台頁封面／2×4 前置簡報）：`deep-research-preview-04-2026`
 * - **Max**（上帝視角長研報）：`deep-research-max-preview-04-2026`
 *
 * 解析優先使用 API 標準欄位 `outputs`；若僅有 `steps` / `model_output`，仍嘗試抽出正文與圖片。
 *
 * **建立任務**：`interactions.create` 走 REST `fetch`+JSON（UTF‑8 中文 `input` 可過）。
 * Node 下 `@google/genai` 2.x 對含 CJK 的 body 曾觸發 `ByteString` 錯誤，故不經 SDK create。
 */
import { GoogleGenAI } from "@google/genai";

const INTERACTIONS_REST_CREATE = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** 平台顧問：文案／封面／分鏡前置 */
export const DEEP_RESEARCH_PRO_AGENT_ID = "deep-research-preview-04-2026";

/** 上帝視角等重型研報 */
export const DEEP_RESEARCH_MAX_AGENT_ID = "deep-research-max-preview-04-2026";

/** 與官方 Agent 範例一致：啟用聯網語境 */
export const DR_URL_CONTEXT_TOOLS = [{ type: "url_context" as const }];

/** SDK `DeepResearchAgentConfig` 型別較窄；實際 API 支援 collaborative_planning / visualization */
export function drAgentConfig(opts: { collaborativePlanning: boolean }): Record<string, unknown> {
  return {
    type: "deep-research",
    thinking_summaries: "auto",
    visualization: "auto",
    collaborative_planning: opts.collaborativePlanning,
  };
}

let cachedClient: GoogleGenAI | null = null;

export function requireGeminiApiKey(): string {
  let apiKey = String(process.env.GEMINI_API_KEY || "").trim().replace(/^\uFEFF/, "");
  if (!apiKey) throw new Error("缺少 GEMINI_API_KEY");
  for (let i = 0; i < apiKey.length; i++) {
    if (apiKey.charCodeAt(i) > 127) {
      throw new Error(
        "GEMINI_API_KEY 含非 ASCII 字符（常为误粘贴中文、全角符号或整段说明文字）。请改用 Google AI Studio 的纯英文密钥（通常以 AIza 开头）。",
      );
    }
  }
  return apiKey;
}

export function getGoogleGenAI(): GoogleGenAI {
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  return cachedClient;
}

function extractTextFromSteps(steps: unknown[]): string {
  if (!steps.length) return "";
  const last = steps[steps.length - 1] as Record<string, unknown>;
  if (last?.type !== "model_output" || !Array.isArray(last.content)) return "";
  const parts = last.content as Array<Record<string, unknown>>;
  const textPart = [...parts].reverse().find((p) => p?.type === "text" && typeof p.text === "string");
  return textPart ? String(textPart.text) : "";
}

function collectImagesFromSteps(steps: unknown[]): Array<{ type: "image"; data?: string }> {
  const out: Array<{ type: "image"; data?: string }> = [];
  for (const st of steps) {
    const step = st as Record<string, unknown>;
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const p of step.content as Array<Record<string, unknown>>) {
      if (p?.type === "image" && p.data) out.push({ type: "image", data: String(p.data) });
    }
  }
  return out;
}

/**
 * 從 Interaction GET 回傳中抽出最終正文與 Agent 圖片區塊（若有）。
 */
export function extractDeepResearchTextAndImages(interaction: unknown): {
  text: string;
  imageParts: Array<{ type: "image"; data?: string }>;
} {
  const obj = interaction as Record<string, unknown>;
  const outputs = Array.isArray(obj.outputs) ? (obj.outputs as Array<Record<string, unknown>>) : [];

  let text = "";
  const imageParts: Array<{ type: "image"; data?: string }> = [];

  if (outputs.length > 0) {
    const textOut = [...outputs].reverse().find((o) => !o?.type || o?.type === "text");
    text = String(textOut?.text ?? "").trim();
    for (const o of outputs) {
      if (o?.type === "image" && o.data) imageParts.push({ type: "image", data: String(o.data) });
    }
  }

  const steps = Array.isArray(obj.steps) ? (obj.steps as unknown[]) : [];
  if ((!text || text.length < 40) && steps.length > 0) {
    const stepText = extractTextFromSteps(steps).trim();
    if (stepText) text = stepText;
  }
  if (imageParts.length === 0 && steps.length > 0) {
    imageParts.push(...collectImagesFromSteps(steps));
  }

  return { text, imageParts };
}

/** 轉成 {@link ./deepResearchService.ts} `pollInteraction` 舊消費端期待的 `outputs[]` */
export function interactionToLegacyOutputs(interaction: unknown): Array<Record<string, unknown>> {
  const raw = interaction as Record<string, unknown>;
  if (Array.isArray(raw.outputs) && raw.outputs.length > 0) {
    return raw.outputs as Array<Record<string, unknown>>;
  }
  const { text, imageParts } = extractDeepResearchTextAndImages(interaction);
  const out: Array<Record<string, unknown>> = [];
  if (text) out.push({ type: "text", text });
  for (const im of imageParts) out.push(im);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type PollInteractionOptions = {
  maxMs: number;
  pollIntervalMs: number;
  abortSignal?: AbortSignal;
  logLabel?: string;
  onTick?: (elapsedSec: number, maxSec: number) => void | Promise<void>;
};

/**
 * 有上限輪詢：總等待不超過 `maxMs`（非無窮迴圈）。
 */
export async function pollInteractionUntilDone(
  interactionId: string,
  opts: PollInteractionOptions,
): Promise<Record<string, unknown>> {
  const ai = getGoogleGenAI();
  const pollStart = Date.now();
  const maxSec = Math.round(opts.maxMs / 1000);
  const label = opts.logLabel ?? "deep-research";

  while (Date.now() - pollStart < opts.maxMs) {
    if (opts.abortSignal?.aborted) {
      throw new Error(`${label} 已中止（interactionId=${interactionId}）`);
    }

    await sleep(opts.pollIntervalMs);
    const elapsed = Math.round((Date.now() - pollStart) / 1000);

    let row: Record<string, unknown>;
    try {
      row = (await ai.interactions.get(interactionId)) as unknown as Record<string, unknown>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("AbortError") || (e as { name?: string })?.name === "AbortError") throw e;
      console.warn(`[${label}] ⚠️ interactions.get 异常 elapsed=${elapsed}s：${msg}`);
      continue;
    }

    const status = String(row?.status ?? "unknown");
    if (opts.onTick) {
      try {
        await opts.onTick(elapsed, maxSec);
      } catch (tickErr: unknown) {
        const m = tickErr instanceof Error ? tickErr.message : String(tickErr);
        if (m === "USER_CANCELLED") throw tickErr;
      }
    }

    if (status === "failed" || status === "cancelled") {
      const errObj = row.error as { message?: string; code?: string } | undefined;
      const errMsg = errObj?.message || JSON.stringify(row.error ?? row).slice(0, 400);
      throw new Error(`${label}：Agent ${status} · ${errMsg}`);
    }

    if (status === "completed") {
      return row;
    }
  }

  throw new Error(
    `${label}：輪詢超时（>${Math.round(opts.maxMs / 60000)} 分钟）interactionId=${interactionId}`,
  );
}

export type CreateDrInteractionParams = {
  agentId: string;
  input: string | unknown[];
  collaborativePlanning: boolean;
  previousInteractionId?: string;
  /** 預設啟用 url_context */
  tools?: typeof DR_URL_CONTEXT_TOOLS;
};

export async function createDeepResearchInteraction(params: CreateDrInteractionParams): Promise<{ id: string }> {
  const apiKey = requireGeminiApiKey();
  const body: Record<string, unknown> = {
    agent: params.agentId,
    input: params.input,
    background: true,
    tools: params.tools ?? DR_URL_CONTEXT_TOOLS,
    agent_config: drAgentConfig({ collaborativePlanning: params.collaborativePlanning }),
  };
  if (params.previousInteractionId) body.previous_interaction_id = params.previousInteractionId;

  const res = await fetch(INTERACTIONS_REST_CREATE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-goog-api-key": apiKey,
      "X-Goog-Api-Client": "genai-node/deep-research-rest-create",
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: { id?: string; error?: { message?: string; code?: string } } = {};
  try {
    parsed = JSON.parse(raw || "{}") as typeof parsed;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg = parsed.error?.message || parsed.error?.code || raw.slice(0, 800);
    throw new Error(`interactions.create HTTP ${res.status}: ${msg}`);
  }
  const id = parsed.id;
  if (!id) throw new Error(`Deep Research create 未返回 id · ${raw.slice(0, 400)}`);
  return { id };
}

export type RunStandaloneDrTaskOptions = {
  abortSignal?: AbortSignal;
};

/** Pro · 15 分鐘上限 · 10s 間隔（90 次） */
export async function runDeepResearchProTask(
  prompt: string,
  options?: RunStandaloneDrTaskOptions,
): Promise<string | null> {
  const MAX_MS = 15 * 60 * 1000;
  const POLL_MS = 10_000;

  try {
    const { id } = await createDeepResearchInteraction({
      agentId: DEEP_RESEARCH_PRO_AGENT_ID,
      input: prompt,
      collaborativePlanning: false,
    });
    console.log(`[DR-Pro] 任務建立 (ID: ${id})，開始輪詢…`);

    const row = await pollInteractionUntilDone(id, {
      maxMs: MAX_MS,
      pollIntervalMs: POLL_MS,
      abortSignal: options?.abortSignal,
      logLabel: "[DR-Pro]",
      onTick: async (elapsed) => {
        if (elapsed > 0 && elapsed % 60 === 0) console.log(`[DR-Pro] 仍在生成… ${elapsed}s`);
      },
    });

    const { text } = extractDeepResearchTextAndImages(row);
    if (text) console.log(`[DR-Pro] ✅ 完成`);
    return text || null;
  } catch (e: unknown) {
    console.error(`[DR-Pro] 失敗：`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Max · 90 分鐘上限 · 10s 間隔（可由 DEEP_RESEARCH_MAX_STANDALONE_TIMEOUT_MS 覆寫，≥60000） */
export async function runDeepResearchMaxTask(
  prompt: string,
  options?: RunStandaloneDrTaskOptions,
): Promise<string | null> {
  const raw = Number(process.env.DEEP_RESEARCH_MAX_STANDALONE_TIMEOUT_MS);
  const MAX_MS = Number.isFinite(raw) && raw >= 60_000 ? raw : 90 * 60 * 1000;
  const POLL_MS = 10_000;

  try {
    const { id } = await createDeepResearchInteraction({
      agentId: DEEP_RESEARCH_MAX_AGENT_ID,
      input: prompt,
      collaborativePlanning: false,
    });
    console.log(`[DR-Max] 任務建立 (ID: ${id})，開始長時輪詢…`);

    const row = await pollInteractionUntilDone(id, {
      maxMs: MAX_MS,
      pollIntervalMs: POLL_MS,
      abortSignal: options?.abortSignal,
      logLabel: "[DR-Max]",
      onTick: async (elapsed) => {
        if (elapsed > 0 && elapsed % 60 === 0) console.log(`[DR-Max] 深度挖掘中… ${Math.floor(elapsed / 60)} 分鐘`);
      },
    });

    const { text } = extractDeepResearchTextAndImages(row);
    if (text) console.log(`[DR-Max] ✅ 完成`);
    return text || null;
  } catch (e: unknown) {
    console.error(`[DR-Max] 失敗：`, e instanceof Error ? e.message : e);
    return null;
  }
}

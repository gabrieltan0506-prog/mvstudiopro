import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { ENV } from "./env";
import { isGsUri } from "../services/gcs";
import {
  COMETAPI_GPT_5_1_MODEL_ID,
  getCometApiBaseUrl,
  getCometApiKey,
} from "../services/cometapi";

export type Role = "developer" | "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" | "video/quicktime";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  temperature?: number;
  topP?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  provider?: Provider;
  modelName?: string;
  /** GPT-5 系：推理强度 {@link https://developers.openai.com/api/docs/guides/reasoning}；与 gpt-5.5 默认一致推 `medium`。 */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** When aborted (e.g. client disconnected), in-flight provider requests are cancelled. */
  abortSignal?: AbortSignal;
  /**
   * 若傳入：返回前會寫入經 {@link truncateForMemory} 裁剪的 messages 摘要與首條選擇正文，避免巨型 diagnostics 長期佔 Heap。
   */
  memorySafeDiagnostics?: MemorySafeLlmDiagnostics;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  provider?: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

/** invokeLLM 可選填入的裁剪診斷（由調用端持有物件位址）。 */
export type MemorySafeLlmDiagnostics = {
  phase?: string;
  prompt?: string;
  response?: string;
};

/**
 * Diagnostics / 長字串持有者：將字串裁剪至 maxLen，避免雙階 LLM 中間稿撐爆堆。
 */
export const truncateForMemory = (str: unknown, maxLen = 3000): string => {
  const safeStr = typeof str === "string" ? str : JSON.stringify(str ?? "");
  if (safeStr.length <= maxLen) return safeStr;
  return `${safeStr.substring(0, maxLen)}\n\n... [為了記憶體安全已截斷 ${safeStr.length - maxLen} 字] ...`;
};

function summarizeMessagesForPeek(messages: Message[], maxChars = 24_000): string {
  const parts: string[] = [];
  for (const m of messages) {
    const { role, content } = m;
    if (typeof content === "string") {
      parts.push(`${role}: ${content}`);
      continue;
    }
    if (!Array.isArray(content)) continue;
    const flat = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        if (part.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    parts.push(`${role}: ${flat}`);
    if (parts.join("\n---\n").length > maxChars) break;
  }
  const joined = parts.join("\n---\n").trim();
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

export function extractFirstChoicePlainText(result: InvokeResult): string {
  const choice = result?.choices?.[0];
  const c = choice?.message?.content;
  if (typeof c === "string" && c.trim()) return c;
  if (Array.isArray(c)) {
    const joined = c
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
    if (joined.trim()) return joined;
  }
  // GPT-5 reasoning 系列：content 可能為 null，實際文字在 output_text 或其他欄位
  const raw = result as any;
  if (typeof raw?.output_text === "string" && raw.output_text.trim()) return raw.output_text;
  if (Array.isArray(raw?.output)) {
    for (const item of raw.output) {
      if (item?.type === "message" && Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (part?.type === "output_text" && typeof part?.text === "string" && part.text.trim()) {
            return part.text;
          }
        }
      }
    }
  }
  if (typeof (choice as any)?.message?.refusal === "string") {
    console.warn("[extractFirstChoicePlainText] model refused:", (choice as any).message.refusal);
  }
  console.warn("[extractFirstChoicePlainText] empty content. keys:", Object.keys(raw || {}).join(","), "choice keys:", Object.keys((choice as any) || {}).join(","));
  return "";
}

function applyMemorySafeDiagnostics(
  params: InvokeParams & { model?: ModelTier },
  result: InvokeResult,
) {
  const sink = params.memorySafeDiagnostics;
  if (!sink) return;
  sink.prompt = truncateForMemory(summarizeMessagesForPeek(params.messages));
  sink.response = truncateForMemory(extractFirstChoicePlainText(result));
}

type ModelTier = "flash" | "pro" | "gpt5" | "gpt54";
type Provider = "vertex" | "gemini" | "cometapi" | "openai";

type LlmTarget = {
  provider: Provider;
  modelName: string;
  apiUrl?: string;
  apiKey: string;
};

/**
 * Default LLM request wall-clock timeout. Must be long enough for GPT-5.5 Stage 2 (which can take
 * 10+ minutes on complex prompts). The platform_build_content job allows up to 20 min; this default
 * must stay below that. Override via env LLM_TIMEOUT_MS.
 */
const DEFAULT_LLM_TIMEOUT_MS = 660_000; // 11 min (was 8 min — too short for GPT-5.5 Stage 2)

function getLlmTimeoutMs() {
  const raw = Number(process.env.LLM_TIMEOUT_MS || "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LLM_TIMEOUT_MS;
}

/** Combine LLM wall-clock timeout with an optional client disconnect signal (either aborts the fetch). */
function mergeWithLlmTimeout(clientAbort?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(getLlmTimeoutMs());
  if (!clientAbort) return timeoutSignal;
  const combined = new AbortController();
  const onAbort = () => {
    try {
      combined.abort();
    } catch {
      /* noop */
    }
  };
  if (clientAbort.aborted || timeoutSignal.aborted) {
    onAbort();
    return combined.signal;
  }
  clientAbort.addEventListener("abort", onAbort, { once: true });
  timeoutSignal.addEventListener("abort", onAbort, { once: true });
  return combined.signal;
}

async function withLlmTimeout<T>(promise: Promise<T>, clientAbort?: AbortSignal): Promise<T> {
  const timeoutMs = getLlmTimeoutMs();
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`LLM 请求超时，已等待 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const racers: Array<Promise<T | never>> = [promise, timeoutPromise];

  if (clientAbort) {
    const abortPromise = new Promise<never>((_, reject) => {
      if (clientAbort.aborted) {
        reject(new Error("LLM 请求已取消（客户端已断开）"));
        return;
      }
      clientAbort.addEventListener(
        "abort",
        () => reject(new Error("LLM 请求已取消（客户端已断开）")),
        { once: true },
      );
    });
    racers.push(abortPromise);
  }

  try {
    return await Promise.race(racers);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType?: string; fileUri: string } };

const ensureArray = (
  value: MessageContent | MessageContent[],
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent,
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text" || part.type === "image_url" || part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const role = message.role === "system" ? "developer" : message.role;
  const { name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return { role, name, tool_call_id, content };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role, name, content: contentParts[0].text };
  }

  return { role, name, content: contentParts };
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error("responseFormat json_schema requires a defined schema object");
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined,
): ToolChoiceExplicit | ToolChoicePrimitive | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error("tool_choice 'required' was provided but no tools were configured");
    }

    if (tools.length > 1) {
      throw new Error("tool_choice 'required' needs a single tool or specify the tool name explicitly");
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const getGeminiModelName = (modelTier: ModelTier | undefined) =>
  modelTier === "pro" ? "gemini-3.1-pro-preview" : "gemini-2.5-flash";

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
// Use direct.evolink.ai for better long-connection support (avoids Cloudflare 524)
const EVOLINK_CHAT_COMPLETIONS_URL = "https://direct.evolink.ai/v1/chat/completions";

function getOpenAiModelName(modelTier: ModelTier | undefined) {
  if (modelTier === "gpt54" || modelTier === "gpt5") {
    return String(process.env.OPENAI_GPT54_MODEL || "gpt-5.4").trim() || "gpt-5.4";
  }
  return String(process.env.OPENAI_GPT54_MODEL || "gpt-5.4").trim() || "gpt-5.4";
}

function getEvolinkApiKey(): string {
  return String(process.env.EVOLINK_API_KEY || "").trim();
}

function hasVertexEnv() {
  return Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() &&
    String(process.env.VERTEX_PROJECT_ID || "").trim(),
  );
}

function baseUrlForVertex(location: string) {
  return location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`;
}

async function getVertexAccessToken() {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw) throw new Error("missing_env_GOOGLE_APPLICATION_CREDENTIALS_JSON");

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    serviceAccount = JSON.parse(
      raw.replace(
        /"private_key"\s*:\s*"([\s\S]*?)"/m,
        (_match, privateKey) => `"private_key": ${JSON.stringify(String(privateKey || ""))}`,
      ),
    );
  }
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("invalid_GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(serviceAccount.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(getLlmTimeoutMs()),
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const json = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json?.access_token) {
    throw new Error(`vertex_token_failed:${tokenRes.status}`);
  }
  return String(json.access_token);
}

const resolveTarget = (
  modelTier: ModelTier | undefined,
  preferredProvider?: Provider,
  explicitModelName?: string,
): LlmTarget => {
  if (preferredProvider === "openai" || modelTier === "gpt5" || modelTier === "gpt54") {
    const resolvedModelName =
      String(explicitModelName || getOpenAiModelName(modelTier)).trim() || getOpenAiModelName(modelTier);

    /**
     * Both GPT-5.4 and GPT-5.5 use Evolink API key (EVOLINK_API_KEY) and Evolink base URL.
     * Native OpenAI API key is not used for these models.
     * Refs:
     *   https://docs.evolink.ai/en/api-manual/language-series/gpt-5.4/gpt-5.4-reference
     *   https://docs.evolink.ai/en/api-manual/language-series/gpt-5.5/gpt-5.5-reference
     */
    const evolinkKey = getEvolinkApiKey();
    if (!evolinkKey) {
      throw new Error("EVOLINK_API_KEY is not configured");
    }
    return {
      provider: "openai",
      apiUrl: EVOLINK_CHAT_COMPLETIONS_URL,
      apiKey: evolinkKey,
      modelName: resolvedModelName,
    };
  }

  if (preferredProvider === "cometapi") {
    const cometApiKey = getCometApiKey();
    if (!cometApiKey) {
      throw new Error("COMET_API_KEY is not configured");
    }

    return {
      provider: "cometapi",
      apiUrl: `${getCometApiBaseUrl()}/v1/chat/completions`,
      apiKey: cometApiKey,
      modelName: COMETAPI_GPT_5_1_MODEL_ID,
    };
  }

  if (preferredProvider === "vertex") {
    if (!hasVertexEnv()) {
      throw new Error("VERTEX environment is not configured");
    }
    const location = String(process.env.VERTEX_GEMINI_LOCATION || "global").trim() || "global";
    const modelName = String(explicitModelName || process.env.VERTEX_GEMINI_MODEL || getGeminiModelName(modelTier)).trim() || getGeminiModelName(modelTier);
    const projectId = String(process.env.VERTEX_PROJECT_ID || "").trim();
    return {
      provider: "vertex",
      apiKey: projectId,
      apiUrl: `${baseUrlForVertex(location)}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:generateContent`,
      modelName,
    };
  }

  if (preferredProvider === "gemini") {
    if (!ENV.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    return {
      provider: "gemini",
      apiKey: ENV.geminiApiKey,
      modelName: String(explicitModelName || getGeminiModelName(modelTier)).trim() || getGeminiModelName(modelTier),
    };
  }

  if (hasVertexEnv()) {
    const location = String(process.env.VERTEX_GEMINI_LOCATION || "global").trim() || "global";
    const modelName = String(explicitModelName || process.env.VERTEX_GEMINI_MODEL || getGeminiModelName(modelTier)).trim() || getGeminiModelName(modelTier);
    const projectId = String(process.env.VERTEX_PROJECT_ID || "").trim();
    return {
      provider: "vertex",
      apiKey: projectId,
      apiUrl: `${baseUrlForVertex(location)}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:generateContent`,
      modelName,
    };
  }

  if (!ENV.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  return {
    provider: "gemini",
    apiKey: ENV.geminiApiKey,
    modelName: String(explicitModelName || getGeminiModelName(modelTier)).trim() || getGeminiModelName(modelTier),
  };
};

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function fetchUrlAsBase64(url: string, fallbackMimeType?: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed_to_fetch_file:${response.status}`);
  }
  const mimeType = response.headers.get("content-type") || fallbackMimeType || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType,
    data: buffer.toString("base64"),
  };
}

async function contentPartToGeminiPart(part: TextContent | ImageContent | FileContent): Promise<GeminiPart> {
  if (part.type === "text") {
    return { text: part.text };
  }

  if (part.type === "image_url") {
    const dataUrl = parseDataUrl(part.image_url.url);
    if (dataUrl) {
      return {
        inlineData: {
          mimeType: dataUrl.mimeType,
          data: dataUrl.data,
        },
      };
    }

    const fetched = await fetchUrlAsBase64(part.image_url.url, "image/jpeg");
    return {
      inlineData: {
        mimeType: fetched.mimeType,
        data: fetched.data,
      },
    };
  }

  const dataUrl = parseDataUrl(part.file_url.url);
  if (dataUrl) {
    return {
      inlineData: {
        mimeType: part.file_url.mime_type || dataUrl.mimeType,
        data: dataUrl.data,
      },
    };
  }

  if (isGsUri(part.file_url.url)) {
    return {
      fileData: {
        mimeType: part.file_url.mime_type,
        fileUri: part.file_url.url,
      },
    };
  }

  const fetched = await fetchUrlAsBase64(part.file_url.url, part.file_url.mime_type);
  return {
    inlineData: {
      mimeType: fetched.mimeType,
      data: fetched.data,
    },
  };
}

async function toGeminiContents(messages: Message[]) {
  const normalized = messages.map(normalizeMessage);
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  const systemTexts: string[] = [];

  for (const message of normalized) {
    if (message.role === "developer") {
      systemTexts.push(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
      continue;
    }
    if (message.role === "tool" || message.role === "function") {
      continue;
    }

    const partsSource = Array.isArray(message.content)
      ? message.content
      : [{ type: "text", text: message.content } as TextContent];

    const parts: GeminiPart[] = [];
    for (const part of partsSource) {
      parts.push(await contentPartToGeminiPart(part));
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  return {
    systemInstruction: systemTexts.join("\n\n").trim() || undefined,
    contents,
  };
}

function getGeminiConfig(format: ReturnType<typeof normalizeResponseFormat>) {
  if (!format) return {};
  if (format.type === "json_object" || format.type === "json_schema") {
    const config: Record<string, unknown> = {
      responseMimeType: "application/json",
    };
    if (format.type === "json_schema") {
      config.responseSchema = format.json_schema.schema;
    }
    return config;
  }
  return {};
}

function isGemini31Model(modelName: string) {
  return /gemini-3\.1/i.test(modelName);
}

function isGemini31ProModel(modelName: string) {
  return /gemini-3\.1.*pro/i.test(String(modelName || ""));
}

/** Gemini 2.5 Pro 文本（排除 Flash 等變體） */
function isGemini25ProModel(modelName: string) {
  const m = String(modelName || "").toLowerCase();
  if (!m.includes("gemini-2.5") || !m.includes("pro")) return false;
  if (m.includes("flash")) return false;
  return true;
}

/** Gemini 3.5 Flash 文本（如 gemini-3.5-flash） */
function isGemini35FlashModel(modelName: string) {
  return /gemini-3\.5[-_]?flash/i.test(String(modelName || ""));
}

/** Gemini 3 Flash 文本（如 gemini-3-flash-preview；不含 gemini-3.1*、不含 image 生图 ID） */
function isGemini3FlashTextModel(modelName: string) {
  if (isGemini35FlashModel(modelName)) return true;
  const m = String(modelName || "").toLowerCase();
  if (!m.includes("flash") || m.includes("image")) return false;
  if (/gemini-3\.1/i.test(m)) return false;
  return /^gemini-3-flash/i.test(m) || /^gemini-3(?!\.1).*flash/i.test(m);
}

function isGemini25Model(modelName: string) {
  return /gemini-2\.5/i.test(modelName);
}

function readNumberEnv(name: string): number | undefined {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readStringEnv(name: string): string | undefined {
  const raw = String(process.env[name] || "").trim();
  return raw || undefined;
}

function normalizeVertexThinkingLevel(envName: string, fallback: string): string {
  const raw = String(readStringEnv(envName) ?? fallback).trim().toUpperCase();
  const allowed = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
  return allowed.has(raw) ? raw : fallback;
}

function buildGeminiGenerationConfig(
  modelName: string,
  format: ReturnType<typeof normalizeResponseFormat>,
  maxOutputTokens?: number,
  temperature?: number,
  topP?: number,
) {
  const config: Record<string, unknown> = {
    ...getGeminiConfig(format),
  };

  let effectiveMax = maxOutputTokens;
  if (effectiveMax == null || !Number.isFinite(effectiveMax) || effectiveMax <= 0) {
    if (isGemini31ProModel(modelName)) {
      effectiveMax = 65536;
    } else if (isGemini25ProModel(modelName) || isGemini3FlashTextModel(modelName)) {
      effectiveMax = 32768;
    }
  }
  if (typeof effectiveMax === "number" && Number.isFinite(effectiveMax) && effectiveMax > 0) {
    config.maxOutputTokens = Math.floor(effectiveMax);
  }

  if (isGemini31ProModel(modelName)) {
    config.temperature = temperature ?? readNumberEnv("VERTEX_GEMINI_31_TEMPERATURE") ?? 0.9;
    config.topP = topP ?? readNumberEnv("VERTEX_GEMINI_31_TOP_P") ?? 0.95;
    // Vertex 部分预览模型不支持 thinking_level；勿传 thinkingConfig 以免 400 INVALID_ARGUMENT
    return config;
  }

  if (isGemini25ProModel(modelName)) {
    config.temperature = temperature ?? readNumberEnv("VERTEX_GEMINI_25_TEMPERATURE") ?? 0.8;
    config.topP = topP ?? readNumberEnv("VERTEX_GEMINI_25_TOP_P") ?? 0.95;
    config.thinkingConfig = {
      thinkingBudget: readNumberEnv("VERTEX_GEMINI_25_THINKING_BUDGET") ?? 1024,
    };
    return config;
  }

  if (isGemini35FlashModel(modelName)) {
    config.temperature =
      temperature ?? readNumberEnv("VERTEX_GEMINI_35_FLASH_TEMPERATURE") ?? readNumberEnv("VERTEX_GEMINI_3_FLASH_TEMPERATURE") ?? 0.8;
    config.topP = topP ?? readNumberEnv("VERTEX_GEMINI_35_FLASH_TOP_P") ?? readNumberEnv("VERTEX_GEMINI_3_FLASH_TOP_P") ?? 0.9;
    return config;
  }

  if (isGemini3FlashTextModel(modelName)) {
    config.temperature =
      temperature ?? readNumberEnv("VERTEX_GEMINI_3_FLASH_TEMPERATURE") ?? readNumberEnv("VERTEX_GEMINI_25_TEMPERATURE") ?? 0.8;
    config.topP = topP ?? readNumberEnv("VERTEX_GEMINI_3_FLASH_TOP_P") ?? readNumberEnv("VERTEX_GEMINI_25_TOP_P") ?? 0.95;
    return config;
  }

  if (isGemini31Model(modelName)) {
    config.temperature = temperature ?? readNumberEnv("VERTEX_GEMINI_31_TEMPERATURE") ?? 0.2;
    config.topP = topP ?? readNumberEnv("VERTEX_GEMINI_31_TOP_P") ?? 0.95;
    return config;
  }

  if (isGemini25Model(modelName)) {
    config.temperature = temperature ?? readNumberEnv("VERTEX_GEMINI_25_TEMPERATURE") ?? 0.5;
    config.topP = topP ?? readNumberEnv("VERTEX_GEMINI_25_TOP_P") ?? 0.95;
    config.thinkingConfig = {
      thinkingBudget: readNumberEnv("VERTEX_GEMINI_25_THINKING_BUDGET") ?? 1024,
    };
    return config;
  }

  return config;
}

async function invokeGemini(params: InvokeParams & { model?: ModelTier }, target: LlmTarget): Promise<InvokeResult> {
  const ai = new GoogleGenAI({ apiKey: target.apiKey });
  const normalizedResponseFormat = normalizeResponseFormat(params);
  const { systemInstruction, contents } = await toGeminiContents(params.messages);

  const maxFromParamsGemini =
    typeof params.maxTokens === "number" && Number.isFinite(params.maxTokens)
      ? params.maxTokens
      : typeof params.max_tokens === "number" && Number.isFinite(params.max_tokens)
        ? params.max_tokens
        : undefined;

  const response = await withLlmTimeout(
    ai.models.generateContent({
      model: target.modelName,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...buildGeminiGenerationConfig(
          target.modelName,
          normalizedResponseFormat,
          maxFromParamsGemini,
          params.temperature,
          params.topP,
        ),
      },
    }),
    params.abortSignal,
  );

  const text =
    response.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";

  return {
    id: response.responseId || `gemini-${Date.now()}`,
    created: Date.now(),
    model: target.modelName,
    provider: "gemini",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: null,
      },
    ],
    usage: response.usageMetadata
      ? {
          prompt_tokens: Number(response.usageMetadata.promptTokenCount || 0),
          completion_tokens: Number(response.usageMetadata.candidatesTokenCount || 0),
          total_tokens: Number(response.usageMetadata.totalTokenCount || 0),
        }
      : undefined,
  };
}

async function invokeVertex(params: InvokeParams & { model?: ModelTier }, target: LlmTarget): Promise<InvokeResult> {
  const normalizedResponseFormat = normalizeResponseFormat(params);
  const { systemInstruction, contents } = await toGeminiContents(params.messages);
  const accessToken = await getVertexAccessToken();

  const maxFromParams =
    typeof params.maxTokens === "number" && Number.isFinite(params.maxTokens)
      ? params.maxTokens
      : typeof params.max_tokens === "number" && Number.isFinite(params.max_tokens)
        ? params.max_tokens
        : undefined;
  const modelDefaultMax = (() => {
    if (isGemini31ProModel(target.modelName)) return 65536;
    if (isGemini25ProModel(target.modelName)) return 32768;
    if (isGemini3FlashTextModel(target.modelName)) return 32768;
    return undefined;
  })();
  const maxOutputTokens =
    maxFromParams ??
    readNumberEnv("VERTEX_GEMINI_MAX_OUTPUT_TOKENS") ??
    modelDefaultMax ??
    (normalizedResponseFormat?.type === "json_object" || normalizedResponseFormat?.type === "json_schema"
      ? readNumberEnv("VERTEX_GEMINI_JSON_MAX_OUTPUT_TOKENS") ?? 8192
      : undefined);

  const response = await fetch(String(target.apiUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: mergeWithLlmTimeout(params.abortSignal),
    body: JSON.stringify({
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents,
      generationConfig: buildGeminiGenerationConfig(
        target.modelName,
        normalizedResponseFormat,
        maxOutputTokens,
        params.temperature,
        params.topP,
      ),
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`vertex_llm_failed:${response.status}:${JSON.stringify(json || {})}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";

  return {
    id: json?.responseId || `vertex-${Date.now()}`,
    created: Date.now(),
    model: target.modelName,
    provider: "vertex",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: null,
      },
    ],
    usage: json?.usageMetadata
      ? {
          prompt_tokens: Number(json.usageMetadata.promptTokenCount || 0),
          completion_tokens: Number(json.usageMetadata.candidatesTokenCount || 0),
          total_tokens: Number(json.usageMetadata.totalTokenCount || 0),
        }
      : undefined,
  };
}

async function invokeCometApi(params: InvokeParams, target: LlmTarget): Promise<InvokeResult> {
  const normalizedResponseFormat = normalizeResponseFormat(params);
  const payload: Record<string, unknown> = {
    model: target.modelName,
    messages: params.messages.map(normalizeMessage),
  };

  if (typeof params.temperature === "number") {
    payload.temperature = params.temperature;
  }

  if (typeof params.topP === "number") {
    payload.top_p = params.topP;
  }

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(String(target.apiUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.apiKey}`,
    },
    signal: mergeWithLlmTimeout(params.abortSignal),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  return (await response.json()) as InvokeResult;
}

const GPT5_REASONING_EFFORT_LEVELS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function parseGpt5ReasoningEffortEnv(envName: string, defaultEffort: string): string {
  const raw = String(process.env[envName] || "").trim().toLowerCase();
  if (GPT5_REASONING_EFFORT_LEVELS.has(raw)) return raw;
  return defaultEffort;
}

/** 供 Stage 2 diagnostics / Debug 面板：OpenAI GPT‑5 系在未傳 `reasoningEffort` 時的解析結果與原始 env。 */
export function getOpenAiGpt5ReasoningEffortDiagnostics(): {
  jsonFallbackEffective: string;
  textFallbackEffective: string;
  envJson: string;
  envText: string;
} {
  return {
    jsonFallbackEffective: parseGpt5ReasoningEffortEnv("OPENAI_GPT5_JSON_REASONING_EFFORT", "medium"),
    textFallbackEffective: parseGpt5ReasoningEffortEnv("OPENAI_GPT5_TEXT_REASONING_EFFORT", "medium"),
    envJson: String(process.env.OPENAI_GPT5_JSON_REASONING_EFFORT ?? "").trim() || "(unset)",
    envText: String(process.env.OPENAI_GPT5_TEXT_REASONING_EFFORT ?? "").trim() || "(unset)",
  };
}

async function invokeOpenAI(params: InvokeParams & { model?: ModelTier }, target: LlmTarget): Promise<InvokeResult> {
  const normalizedResponseFormat = normalizeResponseFormat(params);
  const supportsSamplingControls = !/^gpt-5(?:[.-]|$)/i.test(String(target.modelName || "").trim());
  const isGpt5Family = /^gpt-5(?:[.-]|$)/i.test(String(target.modelName || "").trim());
  /** gpt-5.5 官方默认 medium；JSON 与纯文本重试分别可用环境变量覆盖。 */
  const jsonReasoningFallback = parseGpt5ReasoningEffortEnv("OPENAI_GPT5_JSON_REASONING_EFFORT", "medium");
  const textReasoningFallback = parseGpt5ReasoningEffortEnv("OPENAI_GPT5_TEXT_REASONING_EFFORT", "medium");
  const wantsStructured =
    normalizedResponseFormat?.type === "json_object" || normalizedResponseFormat?.type === "json_schema";
  let reasoningEffort: string | undefined;
  if (isGpt5Family) {
    if (params.reasoningEffort) {
      reasoningEffort = params.reasoningEffort;
    } else if (wantsStructured) {
      reasoningEffort = jsonReasoningFallback;
    } else {
      reasoningEffort = textReasoningFallback;
    }
  }

  const payload: Record<string, unknown> = {
    model: target.modelName,
    messages: params.messages.map(normalizeMessage),
  };
  if (reasoningEffort) {
    payload.reasoning_effort = reasoningEffort;
  }

  const maxCompletionTokens =
    typeof params.maxTokens === "number" && Number.isFinite(params.maxTokens)
      ? params.maxTokens
      : typeof params.max_tokens === "number" && Number.isFinite(params.max_tokens)
        ? params.max_tokens
        : undefined;

  if (typeof maxCompletionTokens === "number" && maxCompletionTokens > 0) {
    payload.max_completion_tokens = Math.floor(maxCompletionTokens);
  }

  if (supportsSamplingControls && typeof params.temperature === "number") {
    payload.temperature = params.temperature;
  }

  if (supportsSamplingControls && typeof params.topP === "number") {
    payload.top_p = params.topP;
  }

  if (params.tools?.length) {
    payload.tools = params.tools;
  }

  const normalizedToolChoice = normalizeToolChoice(params.toolChoice || params.tool_choice, params.tools);
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(String(target.apiUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.apiKey}`,
    },
    signal: mergeWithLlmTimeout(params.abortSignal),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Evolink API error ${response.status}: ${response.statusText} – ${errorText.slice(0, 400)}`);
  }

  // Guard against Cloudflare / proxy returning an HTML error page with status 200
  // (e.g. 524 timeout pages that arrive with 200 OK from intermediate CDN layers).
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(
      `Evolink returned HTML instead of JSON (status ${response.status}) — possible 524 timeout or Cloudflare error page`,
    );
  }
  if (!contentType.includes("application/json") && !contentType.includes("text/event-stream") && contentType !== "") {
    throw new Error(
      `Evolink returned unexpected Content-Type "${contentType}" (status ${response.status}) — expected application/json`,
    );
  }

  return (await response.json()) as InvokeResult;
}

export async function invokeLLM(params: InvokeParams & { model?: ModelTier }): Promise<InvokeResult> {
  const target = resolveTarget(params.model, params.provider, params.modelName);

  let raw: InvokeResult;
  if (target.provider === "vertex") {
    raw = await invokeVertex(params, target);
  } else if (target.provider === "gemini") {
    raw = await invokeGemini(params, target);
  } else if (target.provider === "openai") {
    raw = await invokeOpenAI(params, target);
  } else {
    raw = await invokeCometApi(params, target);
  }

  applyMemorySafeDiagnostics(params, raw);
  return raw;
}

/**
 * extractJsonString — Robust JSON extraction from LLM text output.
 * Handles Markdown code fences (```json ... ```) and extracts the first
 * valid JSON object or array from any surrounding text.
 * Use this before JSON.parse() on any LLM response to prevent parse crashes.
 */
export function extractJsonString(text: string): string {
  // Strip Markdown code fences first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  // Greedy bracket extraction — find outermost { } or [ ]
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  const isObj = start === objStart && objStart !== -1;
  const end = isObj ? text.lastIndexOf("}") : text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1).trim();
  }
  return text.trim();
}

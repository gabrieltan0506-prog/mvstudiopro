import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { ENV } from "./env";
import {
  COMETAPI_GPT_5_1_MODEL_ID,
  getCometApiBaseUrl,
  getCometApiKey,
} from "../services/cometapi";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

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
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
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
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  provider?: Provider;
  modelName?: string;
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

type ModelTier = "flash" | "pro" | "gpt5";
type Provider = "vertex" | "gemini" | "cometapi";

type LlmTarget = {
  provider: Provider;
  modelName: string;
  apiUrl?: string;
  apiKey: string;
};

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
  const { role, name, tool_call_id } = message;

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

const getGeminiModelName = (modelTier: ModelTier | undefined) =>
  modelTier === "pro" ? "gemini-2.5-pro" : "gemini-2.5-flash";

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

  const serviceAccount = JSON.parse(raw);
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
  if (preferredProvider === "cometapi" || modelTier === "gpt5") {
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
    if (message.role === "system") {
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
    return {
      responseMimeType: "application/json",
    };
  }
  return {};
}

function isGemini31Model(modelName: string) {
  return /gemini-3\.1/i.test(modelName);
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

function buildGeminiGenerationConfig(
  modelName: string,
  format: ReturnType<typeof normalizeResponseFormat>,
  maxOutputTokens?: number,
) {
  const config: Record<string, unknown> = {
    ...getGeminiConfig(format),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };

  if (isGemini31Model(modelName)) {
    config.temperature = readNumberEnv("VERTEX_GEMINI_31_TEMPERATURE") ?? 0.2;
    config.topP = readNumberEnv("VERTEX_GEMINI_31_TOP_P") ?? 0.95;
    config.thinkingConfig = {
      includeThoughts: false,
      thinkingLevel: readStringEnv("VERTEX_GEMINI_31_THINKING_LEVEL") ?? "MEDIUM",
    };
    return config;
  }

  if (isGemini25Model(modelName)) {
    config.temperature = readNumberEnv("VERTEX_GEMINI_25_TEMPERATURE") ?? 0.5;
    config.topP = readNumberEnv("VERTEX_GEMINI_25_TOP_P") ?? 0.95;
    config.thinkingBudget = readNumberEnv("VERTEX_GEMINI_25_THINKING_BUDGET") ?? 1024;
    return config;
  }

  return config;
}

async function invokeGemini(params: InvokeParams & { model?: ModelTier }, target: LlmTarget): Promise<InvokeResult> {
  const ai = new GoogleGenAI({ apiKey: target.apiKey });
  const normalizedResponseFormat = normalizeResponseFormat(params);
  const { systemInstruction, contents } = await toGeminiContents(params.messages);
  const maxOutputTokens = params.maxTokens || params.max_tokens;

  const response = await ai.models.generateContent({
    model: target.modelName,
    contents,
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...buildGeminiGenerationConfig(target.modelName, normalizedResponseFormat, maxOutputTokens),
    },
  });

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
  const maxOutputTokens = params.maxTokens || params.max_tokens;

  const response = await fetch(String(target.apiUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents,
      generationConfig: buildGeminiGenerationConfig(target.modelName, normalizedResponseFormat, maxOutputTokens),
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
    max_tokens: params.maxTokens || params.max_tokens || 32768,
  };

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(String(target.apiUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  return (await response.json()) as InvokeResult;
}

export async function invokeLLM(params: InvokeParams & { model?: ModelTier }): Promise<InvokeResult> {
  const target = resolveTarget(params.model, params.provider, params.modelName);

  if (target.provider === "vertex") {
    return invokeVertex(params, target);
  }

  if (target.provider === "gemini") {
    return invokeGemini(params, target);
  }

  return invokeCometApi(params, target);
}

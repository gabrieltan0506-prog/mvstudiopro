/**
 * 管理者专用 Pro Agent 多轮对话：Responses API · reasoning.mode=pro。
 * 附件：PDF/文档 → input_file；图片 → input_image。
 * 视频：官方 Responses 暂不支持原生视频输入（见 OpenAI file-inputs 指南）。
 */
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import {
  invokeGpt56ResponsesText,
  type Gpt56ResponsesInputPart,
} from "./gpt56ResponsesClient.js";

export type ProAgentMessage = { role: "user" | "assistant"; content: string };

export type ProAgentAttachment = {
  name: string;
  mimeType: string;
  /** data:...;base64,... 或纯 base64（服务端会补全） */
  dataBase64: string;
  /** 字节长度（可选，用于限额） */
  byteLength?: number;
};

const PRO_AGENT_INSTRUCTIONS = `你是 mvstudiopro 内部产品参谋（管理者专用 Pro Agent）。
用简洁中文回答；可讨论平台选题、Skill 池、趋势库用法、信息架构与运维口径。
若用户附带 PDF/文档/图片，请基于附件内容分析，指出关键结论与可执行建议。
禁止编造未给出的成交额/精确搜索量；不确定就标明假设。
不要输出代码围栏包裹的整站重构；给可执行建议即可。`;

const MAX_ATTACHMENTS = 4;
/** 单文件上限（与 OpenAI 50MB 请求级限制对齐，偏保守） */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const FILE_MIME_OR_EXT: Array<{ mime?: RegExp; ext: RegExp; mimeOut: string }> = [
  { mime: /^application\/pdf$/i, ext: /\.pdf$/i, mimeOut: "application/pdf" },
  {
    mime: /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/i,
    ext: /\.docx$/i,
    mimeOut: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { mime: /^application\/msword$/i, ext: /\.docx?$/i, mimeOut: "application/msword" },
  {
    mime: /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/i,
    ext: /\.pptx$/i,
    mimeOut: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  {
    mime: /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/i,
    ext: /\.xlsx$/i,
    mimeOut: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  { mime: /^text\/csv$/i, ext: /\.csv$/i, mimeOut: "text/csv" },
  { mime: /^text\/plain$/i, ext: /\.(txt|log|text)$/i, mimeOut: "text/plain" },
  { mime: /^text\/markdown$/i, ext: /\.(md|markdown)$/i, mimeOut: "text/markdown" },
  { mime: /^application\/json$/i, ext: /\.json$/i, mimeOut: "application/json" },
  { mime: /^text\/html$/i, ext: /\.html?$/i, mimeOut: "text/html" },
  { mime: /^text\/xml$/i, ext: /\.xml$/i, mimeOut: "text/xml" },
  { mime: /^text\/(javascript|typescript|css|x-.*)$/i, ext: /\.(js|ts|tsx|jsx|css|py|go|rs|java)$/i, mimeOut: "text/plain" },
];

function isVideoMimeOrName(mime: string, name: string): boolean {
  return /^video\//i.test(mime) || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(name);
}

function normalizeDataUrl(raw: string, mimeOut: string): string {
  const s = String(raw || "").trim();
  if (/^data:/i.test(s)) return s;
  const b64 = s.replace(/^base64,/i, "");
  return `data:${mimeOut};base64,${b64}`;
}

function classifyAttachment(att: ProAgentAttachment): {
  kind: "image" | "file";
  mimeOut: string;
  detail?: "auto" | "low" | "high";
} {
  const name = String(att.name || "file").trim() || "file";
  const mime = String(att.mimeType || "").trim().toLowerCase();
  if (IMAGE_MIME.has(mime) || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
    const mimeOut =
      mime === "image/jpg" ? "image/jpeg" : mime && IMAGE_MIME.has(mime) ? mime : "image/png";
    return { kind: "image", mimeOut };
  }
  for (const row of FILE_MIME_OR_EXT) {
    if ((row.mime && row.mime.test(mime)) || row.ext.test(name)) {
      return {
        kind: "file",
        mimeOut: row.mimeOut,
        detail: /\.pdf$/i.test(name) || mime === "application/pdf" ? "auto" : undefined,
      };
    }
  }
  // 未知类型：若有 filename 仍尝试当 input_file（API 会校验）
  if (mime.startsWith("text/") || mime === "application/octet-stream") {
    return { kind: "file", mimeOut: mime.startsWith("text/") ? mime : "text/plain" };
  }
  throw new Error(
    `不支持的附件类型：${name}（${mime || "unknown"}）。请上传 PDF / 图片 / 文本或 Office 文档。`,
  );
}

export function buildProAgentInputParts(params: {
  transcript: string;
  attachments?: ProAgentAttachment[] | null;
}): Gpt56ResponsesInputPart[] {
  const parts: Gpt56ResponsesInputPart[] = [
    {
      type: "input_text",
      text: params.transcript,
    },
  ];
  const list = Array.isArray(params.attachments) ? params.attachments.slice(0, MAX_ATTACHMENTS) : [];
  for (const raw of list) {
    const name = String(raw?.name || "file").trim().slice(0, 180) || "file";
    const mime = String(raw?.mimeType || "").trim();
    if (isVideoMimeOrName(mime, name)) {
      throw new Error(
        `视频「${name}」暂不支持：OpenAI Responses API 目前无原生视频 input（仅 input_text / input_image / input_file）。请改传关键帧截图或说明文稿。`,
      );
    }
    const byteLen = Number(raw.byteLength) || 0;
    if (byteLen > MAX_FILE_BYTES) {
      throw new Error(`「${name}」超过 ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB 上限`);
    }
    const data = String(raw.dataBase64 || "").trim();
    if (!data) throw new Error(`「${name}」内容为空`);
    const { kind, mimeOut, detail } = classifyAttachment({ ...raw, name, mimeType: mime });
    const dataUrl = normalizeDataUrl(data, mimeOut);
    if (kind === "image") {
      parts.push({ type: "input_image", image_url: dataUrl });
    } else {
      parts.push({
        type: "input_file",
        filename: name,
        file_data: dataUrl,
        ...(detail ? { detail } : {}),
      });
    }
  }
  return parts;
}

export async function chatPlatformProAgent(params: {
  messages: ProAgentMessage[];
  attachments?: ProAgentAttachment[] | null;
  abortSignal?: AbortSignal;
}): Promise<{ reply: string; via: string; attachmentCount: number }> {
  const trimmed = (params.messages || [])
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").trim().slice(0, 6000),
    }))
    .filter((m) => m.content.length > 0)
    .slice(-16);

  const attCount = Array.isArray(params.attachments) ? params.attachments.length : 0;
  if (!trimmed.length && attCount === 0) throw new Error("请先输入消息或上传附件");

  const transcript = [
    "以下为多轮对话（由旧到新）。请只回复下一轮助手回答，不要复述整段历史。",
    attCount > 0 ? `本轮附带 ${attCount} 个文件（见 input_file / input_image），请结合附件分析。` : "",
    "",
    trimmed.length
      ? trimmed.map((m) => `${m.role === "user" ? "管理者" : "Pro"}：${m.content}`).join("\n\n")
      : "管理者：（仅附件，无文字；请直接分析附件）",
  ]
    .filter(Boolean)
    .join("\n");

  const inputParts = buildProAgentInputParts({
    transcript,
    attachments: params.attachments,
  });

  const text = await invokeGpt56ResponsesText({
    instructions: PRO_AGENT_INSTRUCTIONS,
    inputParts,
    modelName: getPlatformStage2OpenAiModel(),
    reasoningMode: "pro",
    reasoningEffort: "medium",
    store: false,
    abortSignal: params.abortSignal,
    timeoutMs: 240_000,
    // 含文件时优先官方 Responses；失败再回退（回退可能丢 file）
    fallbackChatCompletions: attCount === 0,
  });
  const reply = String(text || "").trim();
  if (!reply) throw new Error("Pro Agent 返回空内容");
  return { reply: reply.slice(0, 12000), via: "responses_pro", attachmentCount: attCount };
}

/**
 * 企业专属智能体（AaaS）— 知识库文档解析
 *
 * 范围：把上传的 PDF / DOCX / TXT 二进制 → 纯文本（用于拼 systemInstruction）。
 *
 * 关键架构决策（reviewer 指令 + agent-dev.md 第 6 行硬约束）：
 *   - **复用** `server/growth/documentExtract.ts` 的 `extractDocumentText`
 *     （Linux `strings` for PDF / `unzip + word/document.xml` for DOCX）
 *   - **不引入** 新 npm 依赖（pdf-parse / mammoth / docx-parser 等）
 *   - 跟 Growth Camp 半月刊的 KB 解析路径**严格保持一致**，避免双套体系
 *
 * 解析失败 / 文本太短 / 格式不支持 → 抛 `KnowledgeBaseParserError`，
 * router 层映射成 TRPCError("BAD_REQUEST", ...) 直接给前端展示。
 *
 * 单文件大小校验 / 总和配额校验 → **不在本服务**做（router 层做，因为需要查 DB）。
 */

import crypto from "node:crypto";
import { extractDocumentText } from "../growth/documentExtract";

// ─── 业务常量 ──────────────────────────────────────────────────────────────

/** 单文件硬上限（MB），超过直接拒绝。agent-dev.md 第 178 行约束。 */
export const KB_FILE_MAX_MB = 5;

/** 单文件硬上限字节数 */
export const KB_FILE_MAX_BYTES = KB_FILE_MAX_MB * 1024 * 1024;

/**
 * 解析后纯文本最少字数（不到这个数视为"PDF 是扫描图 / 文件损坏"）。
 *
 * 50 字是个保守门槛：一份正常合同 / SOP / 战败手册 PDF 即使是图扫描版，
 * `strings` 也至少能抽出页眉页脚 / 元数据 / 文件标题等几十字。少于这个数
 * 几乎可以认定 strings 抽不出可用文本，不如让用户改上传 TXT 或纯文本 PDF。
 */
export const KB_MIN_TEXT_CHARS = 50;

/** 支持的 mimeType 白名单（TXT / PDF / DOCX） */
export const KB_SUPPORTED_MIME_TYPES = [
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type KbSupportedMimeType = (typeof KB_SUPPORTED_MIME_TYPES)[number];

/**
 * 解析方法标识 — 跟 enterpriseAgentKnowledgeBase 表 audit log 一致。
 * "txt_raw" 是本服务额外加的（extractDocumentText 不处理 TXT）。
 */
export type KnowledgeParserMethod = "txt_raw" | "pdf_strings" | "docx_xml";

// ─── 错误类（router 层映射成 TRPCError） ───────────────────────────────────

export class KnowledgeBaseParserError extends Error {
  constructor(
    public readonly code:
      | "FILE_TOO_LARGE"
      | "UNSUPPORTED_MIME_TYPE"
      | "EMPTY_BUFFER"
      | "EXTRACTED_TEXT_TOO_SHORT"
      | "PARSE_FAILED",
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KnowledgeBaseParserError";
  }
}

// ─── 纯逻辑工具（无副作用） ────────────────────────────────────────────────

/** 把 mimeType + filename 推断成 supported type；返回 null 表示不支持 */
export function detectKbMimeType(
  mimeType: string,
  fileName: string,
): KbSupportedMimeType | null {
  const mt = String(mimeType || "").toLowerCase().trim();
  const fn = String(fileName || "").toLowerCase().trim();

  if (mt === "text/plain" || fn.endsWith(".txt")) return "text/plain";
  if (mt === "application/pdf" || fn.endsWith(".pdf")) return "application/pdf";
  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fn.endsWith(".docx")
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

/** SHA-256（hex）of buffer — 用于 enterprise_agent_kb 表 contentTextHash 列 */
export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** 从纯文本截取头 N 字作为 preview（admin 后台验证用） */
export function previewText(text: string, maxChars: number = 500): string {
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

/**
 * 把字节数四舍五入到 MB（向上取整，避免 4.99 MB 算 4 MB 错过配额）。
 * 单位：1 MB = 1024 × 1024 = 1_048_576 字节。
 */
export function bytesToMbCeil(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / 1_048_576);
}

// ─── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 解析上传的 KB 文件（buffer + mimeType + fileName）→ 抽出纯文本。
 *
 * 流程：
 *   1. 大小校验（单文件 ≤ 5 MB）
 *   2. mimeType 白名单（TXT / PDF / DOCX）
 *   3. 走 documentExtract 或直读（TXT）
 *   4. 抽出文本最少 50 字
 *   5. 返回 { text, method, charCount, sha256, preview }
 *
 * 配额（单 agent 总和 50 MB）校验**不在本函数**，由 router 层负责。
 */
export async function parseKnowledgeFile(input: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<{
  text: string;
  method: KnowledgeParserMethod;
  charCount: number;
  byteCount: number;
  sha256: string;
  preview: string;
}> {
  const { buffer, mimeType, fileName } = input;

  // ── 1. 大小 / 空文件校验 ─────────────────────────────────────────────
  if (!buffer || buffer.length === 0) {
    throw new KnowledgeBaseParserError(
      "EMPTY_BUFFER",
      "上传的文件为空",
      { fileName },
    );
  }
  if (buffer.length > KB_FILE_MAX_BYTES) {
    throw new KnowledgeBaseParserError(
      "FILE_TOO_LARGE",
      `单文件不得超过 ${KB_FILE_MAX_MB} MB（实际 ${(buffer.length / 1_048_576).toFixed(2)} MB）`,
      { fileName, size: buffer.length, maxBytes: KB_FILE_MAX_BYTES },
    );
  }

  // ── 2. mimeType 白名单 ───────────────────────────────────────────────
  const detected = detectKbMimeType(mimeType, fileName);
  if (!detected) {
    throw new KnowledgeBaseParserError(
      "UNSUPPORTED_MIME_TYPE",
      `不支持的文档类型（${mimeType || "未知"}）；仅支持 TXT / PDF / DOCX`,
      { fileName, mimeType },
    );
  }

  // ── 3. 抽取文本 ──────────────────────────────────────────────────────
  let text = "";
  let method: KnowledgeParserMethod;

  try {
    if (detected === "text/plain") {
      // TXT 直读，UTF-8 优先；非法字节兜底成 latin1（比抛错友好）
      text = buffer.toString("utf8");
      // 把 UTF-8 BOM 去掉，避免拼 systemInstruction 时多余字符
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      method = "txt_raw";
    } else {
      const result = await extractDocumentText({
        buffer,
        mimeType: detected,
        fileName,
      });
      text = result.text;
      method =
        result.method === "docx_xml"
          ? "docx_xml"
          : result.method === "pdf_strings"
            ? "pdf_strings"
            : ("pdf_strings" as KnowledgeParserMethod); // method=none 走下面文本短校验抛错
    }
  } catch (err) {
    throw new KnowledgeBaseParserError(
      "PARSE_FAILED",
      `文档解析失败：${err instanceof Error ? err.message : String(err)}`,
      { fileName, mimeType: detected },
    );
  }

  const trimmed = text.trim();

  // ── 4. 文本最少 50 字校验 ─────────────────────────────────────────────
  if (trimmed.length < KB_MIN_TEXT_CHARS) {
    throw new KnowledgeBaseParserError(
      "EXTRACTED_TEXT_TOO_SHORT",
      `解析后文本仅 ${trimmed.length} 字，疑似扫描版图像 PDF 或文件损坏；建议改上传纯文本 PDF / TXT / DOCX`,
      { fileName, mimeType: detected, charCount: trimmed.length, method },
    );
  }

  // ── 5. 返回 ──────────────────────────────────────────────────────────
  return {
    text: trimmed,
    method,
    charCount: trimmed.length,
    byteCount: buffer.length,
    sha256: sha256Hex(buffer),
    preview: previewText(trimmed),
  };
}

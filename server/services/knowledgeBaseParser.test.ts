import { beforeEach, describe, expect, it, vi } from "vitest";

// 模块级 mock：extractDocumentText 在生产环境调 Linux strings 二进制，
// 单测 CI 不一定有，因此整模块替换。TXT 路径不调它，不受影响。
vi.mock("../growth/documentExtract", () => ({
  extractDocumentText: vi.fn(),
}));

import { extractDocumentText } from "../growth/documentExtract";
import {
  KB_FILE_MAX_BYTES,
  KB_FILE_MAX_MB,
  KB_MIN_TEXT_CHARS,
  KB_SUPPORTED_MIME_TYPES,
  KnowledgeBaseParserError,
  bytesToMbCeil,
  detectKbMimeType,
  parseKnowledgeFile,
  previewText,
  sha256Hex,
} from "./knowledgeBaseParser";

const TXT_MIME = "text/plain";
const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

beforeEach(() => {
  vi.mocked(extractDocumentText).mockReset();
});

// ─── detectKbMimeType ───────────────────────────────────────────────────────

describe("detectKbMimeType", () => {
  it("text/plain MIME 命中", () => {
    expect(detectKbMimeType(TXT_MIME, "")).toBe(TXT_MIME);
  });
  it(".txt 扩展名命中", () => {
    expect(detectKbMimeType("application/octet-stream", "manual.txt")).toBe(
      TXT_MIME,
    );
  });
  it("application/pdf MIME 命中", () => {
    expect(detectKbMimeType(PDF_MIME, "")).toBe(PDF_MIME);
  });
  it(".pdf 扩展名命中", () => {
    expect(detectKbMimeType("application/octet-stream", "guide.PDF")).toBe(
      PDF_MIME,
    );
  });
  it("docx MIME 命中", () => {
    expect(detectKbMimeType(DOCX_MIME, "")).toBe(DOCX_MIME);
  });
  it(".docx 扩展名命中（大小写不敏感）", () => {
    expect(detectKbMimeType("application/octet-stream", "report.DocX")).toBe(
      DOCX_MIME,
    );
  });
  it("image/png 拒绝（不在白名单）", () => {
    expect(detectKbMimeType("image/png", "screenshot.png")).toBeNull();
  });
  it("空 mimeType + 无扩展名拒绝", () => {
    expect(detectKbMimeType("", "noext")).toBeNull();
  });
  it("KB_SUPPORTED_MIME_TYPES 三类齐全", () => {
    expect(KB_SUPPORTED_MIME_TYPES).toContain(TXT_MIME);
    expect(KB_SUPPORTED_MIME_TYPES).toContain(PDF_MIME);
    expect(KB_SUPPORTED_MIME_TYPES).toContain(DOCX_MIME);
  });
});

// ─── sha256Hex ──────────────────────────────────────────────────────────────

describe("sha256Hex", () => {
  it("空 buffer 返回固定 hash", () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("相同输入返回相同 hash", () => {
    const a = sha256Hex(Buffer.from("hello"));
    const b = sha256Hex(Buffer.from("hello"));
    expect(a).toBe(b);
  });
  it("不同输入返回不同 hash", () => {
    const a = sha256Hex(Buffer.from("hello"));
    const b = sha256Hex(Buffer.from("world"));
    expect(a).not.toBe(b);
  });
});

// ─── previewText ────────────────────────────────────────────────────────────

describe("previewText", () => {
  it("文本 ≤ maxChars 原样返回", () => {
    expect(previewText("hello world", 500)).toBe("hello world");
  });
  it("文本 > maxChars 截断 + 省略号", () => {
    const long = "a".repeat(600);
    const out = previewText(long, 500);
    expect(out.length).toBe(501); // 500 + …
    expect(out.endsWith("…")).toBe(true);
  });
  it("空字符串返回空", () => {
    expect(previewText("", 500)).toBe("");
  });
  it("trim 前后空白", () => {
    expect(previewText("   hi   ", 500)).toBe("hi");
  });
});

// ─── bytesToMbCeil ──────────────────────────────────────────────────────────

describe("bytesToMbCeil", () => {
  it("0 字节返回 0", () => {
    expect(bytesToMbCeil(0)).toBe(0);
  });
  it("负数 / NaN 返回 0", () => {
    expect(bytesToMbCeil(-100)).toBe(0);
    expect(bytesToMbCeil(NaN)).toBe(0);
  });
  it("1 字节向上取整为 1 MB", () => {
    expect(bytesToMbCeil(1)).toBe(1);
  });
  it("整 1 MB 返回 1（不进位到 2）", () => {
    expect(bytesToMbCeil(1024 * 1024)).toBe(1);
  });
  it("1 MB + 1 字节进位到 2 MB", () => {
    expect(bytesToMbCeil(1024 * 1024 + 1)).toBe(2);
  });
  it("4.99 MB 进位到 5 MB（避免误判 < 5MB 配额）", () => {
    expect(bytesToMbCeil(4.99 * 1024 * 1024)).toBe(5);
  });
});

// ─── parseKnowledgeFile：错误路径 ──────────────────────────────────────────

describe("parseKnowledgeFile - 错误路径", () => {
  it("空 buffer → EMPTY_BUFFER", async () => {
    await expect(
      parseKnowledgeFile({
        buffer: Buffer.alloc(0),
        mimeType: TXT_MIME,
        fileName: "x.txt",
      }),
    ).rejects.toMatchObject({
      name: "KnowledgeBaseParserError",
      code: "EMPTY_BUFFER",
    });
  });

  it("超过 5MB → FILE_TOO_LARGE", async () => {
    const oversize = Buffer.alloc(KB_FILE_MAX_BYTES + 1);
    oversize.fill("a");
    await expect(
      parseKnowledgeFile({
        buffer: oversize,
        mimeType: TXT_MIME,
        fileName: "big.txt",
      }),
    ).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
      meta: expect.objectContaining({ maxBytes: KB_FILE_MAX_BYTES }),
    });
  });

  it("不支持的 mimeType → UNSUPPORTED_MIME_TYPE", async () => {
    await expect(
      parseKnowledgeFile({
        buffer: Buffer.from("dummy"),
        mimeType: "image/jpeg",
        fileName: "photo.jpg",
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MIME_TYPE",
    });
  });

  it("解析后文本 < 50 字 → EXTRACTED_TEXT_TOO_SHORT", async () => {
    await expect(
      parseKnowledgeFile({
        buffer: Buffer.from("Short"),
        mimeType: TXT_MIME,
        fileName: "short.txt",
      }),
    ).rejects.toMatchObject({
      code: "EXTRACTED_TEXT_TOO_SHORT",
      meta: expect.objectContaining({ charCount: 5 }),
    });
  });

  it("extractDocumentText 抛错 → PARSE_FAILED 包装", async () => {
    vi.mocked(extractDocumentText).mockRejectedValue(new Error("strings binary not found"));
    const big = Buffer.alloc(2048, "X");
    await expect(
      parseKnowledgeFile({
        buffer: big,
        mimeType: PDF_MIME,
        fileName: "manual.pdf",
      }),
    ).rejects.toMatchObject({
      code: "PARSE_FAILED",
    });
  });
});

// ─── parseKnowledgeFile：成功路径 ───────────────────────────────────────────

describe("parseKnowledgeFile - 成功路径", () => {
  const longContent = "项目灵魂指令".repeat(20); // > 50 字
  const longBuffer = Buffer.from(longContent, "utf8");

  it("TXT 直读 utf8 → method=txt_raw", async () => {
    const result = await parseKnowledgeFile({
      buffer: longBuffer,
      mimeType: TXT_MIME,
      fileName: "soul.txt",
    });
    expect(result.method).toBe("txt_raw");
    expect(result.text).toBe(longContent);
    expect(result.charCount).toBe(longContent.length);
    expect(result.byteCount).toBe(longBuffer.length);
    expect(result.preview.length).toBeLessThanOrEqual(501);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("TXT 含 UTF-8 BOM 自动剥离", async () => {
    const bomBuffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      longBuffer,
    ]);
    const result = await parseKnowledgeFile({
      buffer: bomBuffer,
      mimeType: TXT_MIME,
      fileName: "bom.txt",
    });
    expect(result.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.text).toBe(longContent);
  });

  it("PDF 走 extractDocumentText（pdf_strings）", async () => {
    const fakeText = "战败客户名单与处理 SOP\n".repeat(5); // > 50 字
    vi.mocked(extractDocumentText).mockResolvedValue({
      text: fakeText,
      method: "pdf_strings",
    });
    const result = await parseKnowledgeFile({
      buffer: Buffer.alloc(2048, "X"),
      mimeType: PDF_MIME,
      fileName: "loss-clients.pdf",
    });
    expect(result.method).toBe("pdf_strings");
    expect(result.text).toBe(fakeText.trim());
    expect(extractDocumentText).toHaveBeenCalledOnce();
  });

  it("DOCX 走 extractDocumentText（docx_xml）", async () => {
    const fakeText = "投标流程白皮书第三版".repeat(10);
    vi.mocked(extractDocumentText).mockResolvedValue({
      text: fakeText,
      method: "docx_xml",
    });
    const result = await parseKnowledgeFile({
      buffer: Buffer.alloc(2048, "X"),
      mimeType: DOCX_MIME,
      fileName: "bid-process.docx",
    });
    expect(result.method).toBe("docx_xml");
    expect(result.charCount).toBe(fakeText.length);
  });

  it("extractDocumentText 返回空文本 → EXTRACTED_TEXT_TOO_SHORT", async () => {
    vi.mocked(extractDocumentText).mockResolvedValue({
      text: "",
      method: "none",
    });
    await expect(
      parseKnowledgeFile({
        buffer: Buffer.alloc(2048, "X"),
        mimeType: PDF_MIME,
        fileName: "scan.pdf",
      }),
    ).rejects.toMatchObject({ code: "EXTRACTED_TEXT_TOO_SHORT" });
  });

  it("preview 是 trim+截断后头 500 字（admin 用）", async () => {
    const long = "x".repeat(600);
    const result = await parseKnowledgeFile({
      buffer: Buffer.from(long, "utf8"),
      mimeType: TXT_MIME,
      fileName: "long.txt",
    });
    expect(result.preview).toMatch(/…$/);
    expect(result.preview.length).toBe(501);
  });

  it("byteCount 等于原始 buffer 长度（用于 quota 计算）", async () => {
    const buffer = Buffer.alloc(3 * 1024 * 1024 + 5, "0"); // 3 MB + 5 字节
    const result = await parseKnowledgeFile({
      buffer,
      mimeType: TXT_MIME,
      fileName: "padded.txt",
    });
    expect(result.byteCount).toBe(buffer.length);
    expect(bytesToMbCeil(result.byteCount)).toBe(4); // 3MB + 5B → 4MB ceil
  });

  it("KB_FILE_MAX_MB 为 5 / KB_MIN_TEXT_CHARS 为 50（防止误改）", () => {
    expect(KB_FILE_MAX_MB).toBe(5);
    expect(KB_MIN_TEXT_CHARS).toBe(50);
  });
});

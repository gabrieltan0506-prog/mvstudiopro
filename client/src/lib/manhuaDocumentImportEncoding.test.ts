import { describe, expect, it } from "vitest";
import { decodeNovelText, importManhuaDocument } from "./manhuaDocumentImport";

const file = (name: string, bytes: Uint8Array) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });

describe("小说底本文本编码", () => {
  it("UTF-8（含 BOM）、GBK、UTF-16LE 都能读出同一段中文", async () => {
    const text = "第一章 文书库";
    expect(decodeNovelText(new TextEncoder().encode(text).buffer as ArrayBuffer)).toBe(text);
    expect(decodeNovelText(new Uint8Array([0xef, 0xbb, 0xbf, ...Array.from(new TextEncoder().encode(text))]).buffer)).toBe(text);
    // 「第一章」的 GBK 字节
    const gbk = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);
    expect(decodeNovelText(gbk.buffer)).toBe("第一章");
    const utf16 = new Uint8Array([0xff, 0xfe, 0x2c, 0x7b, 0x00, 0x4e, 0xe0, 0x7a]);
    expect(decodeNovelText(utf16.buffer)).toBe("第一章");
    const draft = await importManhuaDocument(file("书.txt", gbk));
    expect(draft.text).toBe("第一章");
  });
  it("Kindle 格式给出转 epub 的明确提示，未知格式列出可用格式", async () => {
    await expect(importManhuaDocument(file("书.azw3", new Uint8Array([1, 2])))).rejects.toThrow(/转成 epub/);
    await expect(importManhuaDocument(file("书.xyz", new Uint8Array([1, 2])))).rejects.toThrow(/epub、fb2、pdf/);
  });
});

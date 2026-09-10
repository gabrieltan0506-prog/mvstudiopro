import { describe, expect, it } from "vitest";
import { readFile, rm, stat } from "node:fs/promises";
import sharp from "sharp";
import {
  buildKnowledgeCardPdfFile,
  checkKnowledgeCardExportRate,
  normalizeKnowledgeCardPage,
  resolveKnowledgeCardImageObjectName,
} from "./knowledgeCardPdfExport";

describe("knowledgeCardPdfExport", () => {
  it("only accepts this user's own knowledge card outputs in this bucket", () => {
    const b = "my-bucket";
    const me = 42;
    const mine = "generated/platform_knowledge_card/u42/1757_ab12cd.png";
    // 本人 u{id} 前缀：放行（gs:// 与签名 https 两种写法）
    expect(resolveKnowledgeCardImageObjectName(`gs://my-bucket/${mine}`, b, me)).toBe(mine);
    expect(
      resolveKnowledgeCardImageObjectName(`https://storage.googleapis.com/my-bucket/${mine}?X-Goog-Signature=x`, b, me),
    ).toBe(mine);
    // 他人 u{other} 前缀：拒绝（本条即 P2-4 越权换签名链）
    expect(
      resolveKnowledgeCardImageObjectName("gs://my-bucket/generated/platform_knowledge_card/u43/1757_ab12cd.png", b, me),
    ).toBeNull();
    // u421 不是 u42 的目录：前缀比对必须带斜杠
    expect(
      resolveKnowledgeCardImageObjectName("gs://my-bucket/generated/platform_knowledge_card/u421/x.png", b, me),
    ).toBeNull();
    // 旧的无 userId 前缀（历史成品）：不放行
    expect(
      resolveKnowledgeCardImageObjectName("gs://my-bucket/generated/platform_knowledge_card/a.png", b, me),
    ).toBeNull();
    // 别桶 / 别前缀 / 别域名 / 路径穿越
    expect(resolveKnowledgeCardImageObjectName(`https://storage.googleapis.com/other/${mine}`, b, me)).toBeNull();
    expect(resolveKnowledgeCardImageObjectName("https://storage.googleapis.com/my-bucket/uploads/u42/x.png", b, me)).toBeNull();
    expect(resolveKnowledgeCardImageObjectName(`https://evil.example/${mine}`, b, me)).toBeNull();
    expect(
      resolveKnowledgeCardImageObjectName("gs://my-bucket/generated/platform_knowledge_card/u42/../u43/secret.png", b, me),
    ).toBeNull();
  });

  it("throttles exports to 2 per user per minute", () => {
    const t0 = 1_700_000_000_000;
    // 前 2 次放行
    const a = checkKnowledgeCardExportRate(undefined, t0);
    expect(a.allowed).toBe(true);
    const b = checkKnowledgeCardExportRate(a.history, t0 + 1_000);
    expect(b.allowed).toBe(true);
    // 第 3 次拒
    const c = checkKnowledgeCardExportRate(b.history, t0 + 2_000);
    expect(c.allowed).toBe(false);
    expect(c.history).toEqual(b.history);
    // 窗口未满 60 秒仍拒
    expect(checkKnowledgeCardExportRate(b.history, t0 + 59_000).allowed).toBe(false);
    // 60 秒后旧记录出窗 → 恢复
    const d = checkKnowledgeCardExportRate(b.history, t0 + 61_500);
    expect(d.allowed).toBe(true);
    expect(d.history).toEqual([t0 + 61_500]);
  });

  it("normalizes 3:2 pages to 3840×2160 with edge-colored padding and keeps 16:9 as is", async () => {
    const wide = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: "#123456" } }).png().toBuffer();
    const narrow = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#f0e6d2" } }).png().toBuffer();
    for (const buf of [wide, narrow]) {
      const out = await normalizeKnowledgeCardPage(buf);
      const meta = await sharp(out).metadata();
      expect([meta.width, meta.height]).toEqual([3840, 2160]);
    }
    const padded = await normalizeKnowledgeCardPage(narrow);
    const corner = await sharp(padded).extract({ left: 0, top: 0, width: 4, height: 4 }).stats();
    // 补边色 ≈ 图边缘色（#f0e6d2）
    expect(Math.abs(corner.channels[0]!.mean - 0xf0)).toBeLessThan(6);
  });

  it("builds a multi-page PDF into a temp file (0911：不再整份驻留内存)", async () => {
    const a = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const b = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#cccccc" } }).png().toBuffer();
    const { filePath, dir, bytes } = await buildKnowledgeCardPdfFile([async () => a, async () => b]);
    try {
      expect(bytes).toBeGreaterThan(0);
      expect((await stat(filePath)).size).toBe(bytes);
      const pdf = await readFile(filePath);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("一页失败即清理临时目录，不留垃圾文件", async () => {
    const a = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: "#ffffff" } }).png().toBuffer();
    let leaked = "";
    await expect(
      buildKnowledgeCardPdfFile([
        async () => a,
        async () => {
          throw new Error("读取成品图失败（404）");
        },
      ]).then((r) => {
        leaked = r.dir;
        return r;
      }),
    ).rejects.toThrow(/读取成品图失败/);
    expect(leaked).toBe("");
  }, 60_000);

  it("空页列表直接拒绝", async () => {
    await expect(buildKnowledgeCardPdfFile([])).rejects.toThrow(/没有可导出的页面/);
  });
});

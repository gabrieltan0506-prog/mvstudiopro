/**
 * 长书提练探针：本地抽 PDF 字 → prepareKnowledgeCardCopy（分段热修）。
 * 用法：
 *   EVOLINK_API_KEY=... OPENROUTER_API_KEY=... \
 *   pnpm exec tsx scripts/smoke-knowledge-card-long-distill.mts
 * 可选：DISTILL_MODEL=gpt-5.6-sol|moonshotai/kimi-k3|qwen3.8-max
 *       PDF_PATH=... MAX_CHARS=25000（默认全量；设上限可加快冒烟）
 */
import fs from "node:fs";
import path from "node:path";
import { extractDocumentText } from "../server/growth/documentExtract.ts";
import {
  prepareKnowledgeCardCopy,
  splitSourceTextForDistill,
  suggestKnowledgeCardMinSections,
} from "../server/services/knowledgeCardDistill.ts";
import { planKnowledgeCardPages } from "../shared/knowledgeCardPagination.ts";

const pdfPath =
  process.env.PDF_PATH ||
  path.join(process.env.HOME || "", "Downloads/2026Aug04/前线部署工程师（FDE）v1.0.5.pdf");
const model = process.env.DISTILL_MODEL || "gpt-5.6-sol";
const maxChars = Number(process.env.MAX_CHARS || 0) || 0;

async function main() {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF missing: ${pdfPath}`);
  }
  const buf = fs.readFileSync(pdfPath);
  console.log(`[smoke] pdf=${pdfPath} bytes=${buf.length} model=${model}`);
  const extracted = await extractDocumentText({
    buffer: buf,
    mimeType: "application/pdf",
    fileName: path.basename(pdfPath),
  });
  let text = String(extracted.text || "").trim();
  if (!text) throw new Error(`extract empty method=${extracted.method}`);
  if (maxChars > 0 && text.length > maxChars) {
    text = text.slice(0, maxChars);
    console.log(`[smoke] truncated to MAX_CHARS=${maxChars}`);
  }
  const chunks = splitSourceTextForDistill(text);
  console.log(
    `[smoke] sourceChars=${text.length} method=${extracted.method} expectedChunks≈${chunks.length}`,
  );

  const t0 = Date.now();
  const prepared = await prepareKnowledgeCardCopy({
    sourceText: text,
    forceDistill: true,
    distillModel: model,
  });
  const ms = Date.now() - t0;
  const out = String(prepared.distilledMarkdown || "").trim();
  const headings = (out.match(/^##\s+.*$/gm) || []).map((h) => h.replace(/^##\s+/, "").trim());
  const plan = planKnowledgeCardPages(out, prepared.distillModel);

  const outDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `distill-${model.replace(/[^a-z0-9.]+/gi, "-")}.md`);
  fs.writeFileSync(outFile, out, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: out.length >= 80,
        ms,
        model: prepared.distillModel,
        sourceChars: prepared.sourceChars,
        targetSections: suggestKnowledgeCardMinSections(prepared.sourceChars),
        sectionCount: headings.length,
        outChars: out.length,
        // 这才是用户最终拿到的图文笔记页数
        pageCount: plan.pageCount,
        credits: plan.credits,
        avgCharsPerPage: plan.pageCount
          ? Math.round(plan.pages.reduce((a, p) => a + p.length, 0) / plan.pageCount)
          : 0,
        outFile,
        outline: headings,
      },
      null,
      2,
    ),
  );
  if (out.length < 80) process.exit(2);
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});

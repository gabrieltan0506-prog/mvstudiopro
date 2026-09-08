/**
 * 0908 知识卡探针（只许在 Fly 容器内跑，用分支源码 /tmp/probe-src）。
 * --mode=distill|images|all  --pdf=/tmp/probe.pdf  --user=<probe userId>  --model=gpt-5.6-sol|qwen3.8-max
 * --level=concise|full  --pages=1,2  --position=left|center  --out=/tmp/probe-out
 * distill：上传 PDF 到 GCS uploads/u{user}/knowledge-card/ → prepareKnowledgeCardCopy（目录页扫读/挑页/分段提炼/统稿）→ 存 distilled.md
 * images：读 distilled.md → 按页出图（EvoLink 4K → OpenAI 兜底），带参考原页 → 打印签名 URL
 */
import fs from "node:fs/promises";
import path from "node:path";
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("只允许在 Fly 容器内运行");
const arg = (k: string, d = "") => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || d;
const mode = arg("mode", "all"); const pdfPath = arg("pdf", "/tmp/probe.pdf"); const userId = Number(arg("user", "0"));
const model = arg("model", "gpt-5.6-sol"); const level = arg("level", "concise"); const position = arg("position", "left");
const pages = arg("pages", "1,2").split(",").map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
const out = arg("out", "/tmp/probe-out");
if (!userId) throw new Error("--user 必填");
await fs.mkdir(out, { recursive: true });
const t0 = Date.now(); const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const log = (...a: unknown[]) => console.info(`[probe ${el()}]`, ...a);

if (mode === "distill" || mode === "all") {
  const { uploadBufferToGcs } = await import("../server/services/gcs.js");
  const { prepareKnowledgeCardCopy } = await import("../server/services/knowledgeCardDistill.js");
  const { planKnowledgeCardPages } = await import("../shared/knowledgeCardPagination.js");
  const buf = await fs.readFile(pdfPath);
  const up = await uploadBufferToGcs({ objectName: `uploads/u${userId}/knowledge-card/probe-0908-${Date.now()}.pdf`, buffer: buf, contentType: "application/pdf" });
  log(`PDF ${(buf.length / 1048576).toFixed(1)}MB → ${up.gcsUri}`);
  const prepared = await prepareKnowledgeCardCopy({
    files: [{ gcsUri: up.gcsUri, mimeType: "application/pdf", fileName: path.basename(pdfPath) }],
    forceDistill: true, distillModel: model, detailLevel: level, userId,
    onExtractProgress: (p) => log(`extract ${p.stage} ${p.done}/${p.total} ${p.fileName}`),
    onProgress: (p) => log(`distill ${p.phase} ${p.doneChunks}/${p.totalChunks}`),
  });
  await fs.writeFile(path.join(out, "distilled.md"), prepared.distilledMarkdown);
  const plan = planKnowledgeCardPages(prepared.distilledMarkdown, prepared.distillModel);
  const refs = (prepared.distilledMarkdown.match(/〔参考原页[^〕]*〕/g) || []);
  log(`distill done model=${prepared.distillModel} level=${prepared.detailLevel} chars=${prepared.distilledMarkdown.length} sections=${(prepared.distilledMarkdown.match(/^##\s/gm) || []).length} pages=${plan.pageCount} credits=${plan.credits} refMarkers=${refs.length} docs=${JSON.stringify(prepared.documents)} methods=${prepared.extractionMethods.join("|")}`);
  log(`refs: ${refs.join(" ")}`);
}

if (mode === "images" || mode === "all") {
  const { generatePlatformCompositeSheetImage } = await import("../server/services/proxyImageService.js");
  const { planKnowledgeCardPages } = await import("../shared/knowledgeCardPagination.js");
  const { resolveKnowledgeCardPageSource } = await import("../server/services/geminiPlatformCompositeTranslation.js");
  const { resolveKnowledgeCardReferencePageUrls } = await import("../server/services/knowledgeCardDocumentPages.js");
  const md = await fs.readFile(path.join(out, "distilled.md"), "utf8");
  const plan = planKnowledgeCardPages(md, model);
  const total = plan.pageCount;
  const results: string[] = [];
  for (const idx of pages) {
    if (idx > total) { log(`skip page ${idx} > total ${total}`); continue; }
    const slice = resolveKnowledgeCardPageSource(md, { notePageIndex: idx, notePageTotal: total }).source;
    const refs = await resolveKnowledgeCardReferencePageUrls({ userId, pageText: slice, fullMarkdown: md });
    const flowLog: string[] = [];
    log(`page ${idx}/${total} refs=${refs.map((r) => `p${r.pageNumber}`).join(",") || "-"} start`);
    const url = await generatePlatformCompositeSheetImage({
      kind: "single_page_knowledge_card", title: "知识卡探针", scriptContext: md, flowLog,
      notePageIndex: idx, notePageTotal: total, distillModel: model, subjectPosition: position,
      knowledgeCardReferencePageUrls: refs.map((r) => r.url),
    } as Parameters<typeof generatePlatformCompositeSheetImage>[0]);
    await fs.writeFile(path.join(out, `flow-${idx}.log`), flowLog.join("\n"));
    log(`page ${idx} → ${url || "NULL"}`);
    log(flowLog.filter((l) => /EvoLink|OpenAI|失败|成功|4K|参考/.test(l)).slice(-8).join("\n"));
    if (url) results.push(`${idx}\t${url}`);
  }
  await fs.writeFile(path.join(out, "images.tsv"), results.join("\n"));
  log(`images done ${results.length}/${pages.length}`);
}

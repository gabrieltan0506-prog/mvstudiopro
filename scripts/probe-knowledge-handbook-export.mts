/**
 * 隔离探针：用本分支的正式导出代码，把一本已审校、已排版的图文手册组装成 PDF（不调用任何模型）。
 * 只读云稿，成品写入该稿自己的导出目录（与正式入口同一路径，正式入口之后直接复用）。
 * 日志与 live.json 只输出阶段与计数，不输出正文与地址。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readCanonicalLayoutLibrary } from "../server/services/editableLayoutStore";
import { exportKnowledgePublication, knowledgeExportLogReason } from "../server/services/knowledgePublicationExport";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在工作机执行");
await assertWorkerProbeLease();
const configPath = process.argv[2];
const dir = dirname(configPath);
const config = JSON.parse(await readFile(configPath, "utf8")) as { owner: number; documentId: string };
if (!Number.isSafeInteger(config.owner) || !/^[0-9a-f-]{36}$/.test(config.documentId)) throw Error("探针配置无效");
const live = async (value: Record<string, unknown>) => writeFile(join(dir, "live.json"), JSON.stringify({ at: new Date().toISOString(), ...value }));

// 组装成品只读已有审校与排版方案；任何模型请求都视为越权并拦下。
let blockedModelRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (/api\.openai\.com|openrouter\.ai|evolink\.ai|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|deepseek\.com|bigmodel\.cn/.test(url)) {
    blockedModelRequests++;
    throw Error("组装探针禁止模型请求");
  }
  return originalFetch(...args);
};

const startedAt = Date.now();
await live({ stage: "exporting", summary: "正在组装图文 PDF" });
try {
  const loaded = await readCanonicalLayoutLibrary(config.owner);
  const doc = loaded.library?.documents.find(d => d.id === config.documentId);
  if (!doc?.publication?.review) throw Error("云稿不存在或尚未审校");
  const result = await exportKnowledgePublication(config.owner, config.documentId, loaded.generation);
  await writeFile(join(dir, "export-response.json"), JSON.stringify(result));
  // 回读刚保存的阅读稿，核对配图只以地址引用。
  const html = await (await originalFetch(result.htmlUrl)).text();
  const inlineImages = (html.match(/src="data:/g) || []).length;
  const linkedImages = (html.match(/<img [^>]*src="https:\/\//g) || []).length;
  const summary = {
    chapters: result.chapters, imagePages: result.imagePages ?? 0, totalPages: result.totalPages ?? 0,
    htmlBytes: result.htmlBytes, pdfBytes: result.pdfBytes ?? 0, inlineImages, linkedImages,
    hasBase64: html.includes("base64,"), blockedModelRequests, ms: Date.now() - startedAt,
    chargedCredits: result.billing?.chargedCredits ?? 0, pdfIncomplete: result.pdfUrl ? 0 : 1,
  };
  const ok = Boolean(result.pdfUrl) && !summary.hasBase64 && inlineImages === 0 && linkedImages >= (result.imagePages ?? 0) && blockedModelRequests === 0;
  await live({ stage: ok ? "pdf_returned" : "failed", summary, ...(ok ? {} : { error: result.pdfError ? "PDF 分段未完成" : "成品核对未通过" }) });
  console.log(JSON.stringify({ status: ok ? "succeeded" : "failed", ...summary }));
} catch (error) {
  await live({ stage: "failed", error: knowledgeExportLogReason(error), blockedModelRequests, ms: Date.now() - startedAt });
  console.log(JSON.stringify({ status: "failed", error: knowledgeExportLogReason(error) }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}

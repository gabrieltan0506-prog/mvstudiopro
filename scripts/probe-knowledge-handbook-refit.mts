/**
 * 隔离探针：对一本已审校、已确认的图文手册做「压缩适配 + 新版式排版 + 导出」（用户 2026-11-11：34 图总页数 48–54 页）。
 * 沿用原图，不重新生图、不重新审校；只允许调用图文手册文字链的三跳路由（GLM@EvoLink → GLM@OpenRouter → DeepSeek），
 * 生图、视频、Gemini/Vertex 与其他模型请求一律拦下。原稿与已确认正文不改：压缩在整册视图副本上做，派生正文与回执写入
 * refit/<digest>/ 永久保存，成品写到带 refit-<hash> 标记的独立导出目录；探针不结算内文积分（用户已在正式导出时结算）。
 *
 * 用法（只在工作机）：npx tsx scripts/probe-knowledge-handbook-refit.mts <config.json>
 *   config.json：{ "owner": 7, "documentId": "<稿件 uuid>" }
 * 日志与 live.json 只输出阶段与计数，不输出正文与地址；终态 stage = pdf_returned | failed。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readCanonicalLayoutLibrary } from "../server/services/editableLayoutStore";
import { loadKnowledgeBookLayoutView } from "../server/services/knowledgeBookLayout";
import { exportKnowledgePublication, knowledgeExportLogReason, KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS } from "../server/services/knowledgePublicationExport";
import { refitKnowledgeHandbook } from "../server/services/knowledgeHandbookRefit";
import { knowledgePublicationAdvisorDeps } from "../server/services/knowledgePublicationAdvisor";
import { KNOWLEDGE_PUBLICATION_ALL_ROUTES } from "../server/services/knowledgeModelCapabilities";
import { measureKnowledgeBookletDetailsFromWorker } from "../server/services/pdfWorkerClient";
import { ensureKnowledgeReviewThumbnail } from "../server/services/knowledgeReviewThumbnail";
import { signGsUriV4ReadUrl } from "../server/services/gcs";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在工作机执行");
await assertWorkerProbeLease();
const configPath = process.argv[2];
const dir = dirname(configPath);
const config = JSON.parse(await readFile(configPath, "utf8")) as { owner: number; documentId: string };
if (!Number.isSafeInteger(config.owner) || !/^[0-9a-f-]{36}$/.test(config.documentId)) throw Error("探针配置无效");
const live = async (value: Record<string, unknown>) => writeFile(join(dir, "live.json"), JSON.stringify({ at: new Date().toISOString(), ...value }));

// 只放行文字链两家网关的 chat/completions，且请求体里的模型必须是图文手册文字链路由表中的模型。
const allowedModels = new Set(KNOWLEDGE_PUBLICATION_ALL_ROUTES.map(route => route.model));
const counts = { textRequests: 0, blockedModelRequests: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  const gateway = /openrouter\.ai|evolink\.ai/.test(url);
  if (/api\.openai\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|deepseek\.com|bigmodel\.cn|wavespeed|dashscope|volces|byteplus/.test(url) || (gateway && !/\/chat\/completions(?:\?|$)/.test(url))) {
    counts.blockedModelRequests++;
    throw Error("压缩适配探针只允许文字链请求");
  }
  if (gateway) {
    let model = "";
    try { model = String(JSON.parse(String((args[1] as RequestInit | undefined)?.body ?? "{}")).model ?? ""); } catch { model = ""; }
    if (!allowedModels.has(model)) { counts.blockedModelRequests++; throw Error("压缩适配探针只允许图文手册文字链模型"); }
    counts.textRequests++;
  }
  return originalFetch(...args);
};

const startedAt = Date.now();
await live({ stage: "refitting", summary: "正在压缩适配正文" });
try {
  const loaded = await readCanonicalLayoutLibrary(config.owner);
  const doc = loaded.library?.documents.find(d => d.id === config.documentId);
  if (!doc?.publication?.review) throw Error("云稿不存在或尚未审校");
  const view = await loadKnowledgeBookLayoutView(config.owner, config.documentId, loaded.generation);
  const imageUrl = async (uri: string) => signGsUriV4ReadUrl((await ensureKnowledgeReviewThumbnail(uri)) || uri, KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS);
  const refit = await refitKnowledgeHandbook(config.owner, view, { advisor: knowledgePublicationAdvisorDeps(), measure: measureKnowledgeBookletDetailsFromWorker, imageUrl });
  await live({ stage: "exporting", summary: "正在用新版式导出" });
  // 探针不结算内文积分：结算按稿件幂等且已在正式导出完成，这里只产出派生成品供核对。
  const result = await exportKnowledgePublication(config.owner, config.documentId, loaded.generation, { settle: async () => undefined }, { view: refit.view, imageModes: refit.imageModes, prefixTag: refit.prefixTag });
  await writeFile(join(dir, "export-response.json"), JSON.stringify({ ...result, refit: refit.summary, evidencePrefix: refit.evidencePrefix }));
  const s = refit.summary;
  const summary = {
    chapters: s.chapters, images: s.images, targetRange: s.range, spreadSlots: s.spreadSlots,
    compressedChapters: s.compressedChapters, modelCalls: s.modelCalls,
    hops: s.rounds.map(r => ({ round: r.round, targets: r.targets.length, adopted: r.adopted.length, stillOver: r.after.length, model: r.model, gateway: r.gateway, usage: r.usage, routeSummary: r.routeSummary, error: r.error ? knowledgeExportLogReason(r.error) : undefined })),
    charsBefore: s.charsBefore, charsAfter: s.charsAfter, measuredPages: s.totalPages, totalPages: result.totalPages ?? 0,
    spreadChapters: s.spreadChapters, retractedSpreads: s.retractedSpreads, overflowChapters: s.overflowChapters.length,
    maxWhitespace: s.maxWhitespace, measuredDetails: s.measuredDetails, pdfBytes: result.pdfBytes ?? 0, htmlBytes: result.htmlBytes,
    textRequests: counts.textRequests, blockedModelRequests: counts.blockedModelRequests, ms: Date.now() - startedAt,
  };
  const ok = Boolean(result.pdfUrl) && counts.blockedModelRequests === 0;
  await live({ stage: ok ? "pdf_returned" : "failed", summary, ...(ok ? {} : { error: result.pdfError ? "PDF 分段未完成" : "成品核对未通过" }) });
  console.log(JSON.stringify({ status: ok ? "succeeded" : "failed", ...summary }));
} catch (error) {
  await live({ stage: "failed", error: knowledgeExportLogReason(error), ...counts, ms: Date.now() - startedAt });
  console.log(JSON.stringify({ status: "failed", error: knowledgeExportLogReason(error) }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}

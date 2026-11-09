/**
 * 隔离探针（2026-11-09 用户授权）：用已有云稿的原稿与已成功配图，按本分支「篇幅预算写进审校输出合同」的新审校提示词，
 * 对指定批次真跑一次正式审校（GLM FlashX@EvoLink → GLM@OpenRouter → DeepSeek 三跳链，探针账号 0 积分）。
 * 证据另存在探针前缀下，不读写、不覆盖原云稿的审校回执；原始/解析 JSON 永久保存。
 * 用法：tsx scripts/with-worker-probe-lease.mts tsx scripts/probe-knowledge-review-budget.mts <ownerId> <documentId> <batch,batch,...> <probePrefix>
 */
import fs from "node:fs/promises";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcs } from "../server/services/gcs";
import { knowledgeEvidencePrefix, knowledgeReviewPageChars, loadKnowledgePublication, reviewKnowledgePublication } from "../server/services/knowledgePublicationAdvisor";
import { knowledgeReadingCharBudgets } from "../shared/knowledgeEditionBudget";
import { knowledgeReviewBatches } from "../shared/knowledgePublication";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在已授权工作机执行");
await assertWorkerProbeLease();
const [ownerArg, documentId, batchArg, probePrefix] = process.argv.slice(2);
const owner = Number(ownerArg);
if (!owner || !/^[0-9a-f-]{36}$/.test(documentId || "") || !batchArg || !probePrefix?.startsWith("probes/knowledge/")) throw Error("参数无效");
const batches = batchArg.split(",").map(Number);

const original = await loadKnowledgePublication(owner, { documentId, batchIndex: 0, attempt: 0 });
const root = knowledgeEvidencePrefix(owner, documentId, original.publication.requestId);
// 只把原云稿证据前缀映射到探针前缀；其余对象（如配图）照常读取。
const map = (name: string) => name.startsWith(`${root}/`) ? `${probePrefix}/evidence/${name.slice(root.length + 1)}` : name;
const read = async (name: string) => {
  try { return JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${map(name)}` })).buffer.toString("utf8")); }
  catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
};
const save = async (name: string, value: unknown) => {
  if (!map(name).startsWith(`${probePrefix}/`)) throw Error(`探针禁止写入原云稿对象：${name}`);
  await uploadBufferToGcs({ objectName: map(name), buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
};
// 新审校链：GLM FlashX@EvoLink 首发（原稿件旧请求身份不受影响，证据在探针前缀）。
const load = async (...args: Parameters<typeof loadKnowledgePublication>) => {
  const doc = await loadKnowledgePublication(...args);
  const channels = Object.fromEntries(batches.map(i => [String(i), "evolink" as const]));
  return { ...doc, publication: { ...doc.publication, attempts: {}, parallel: { channels, completed: [], family: "glm" as const } } } as typeof doc;
};

const source = original.publication.source;
const budgets = new Map(knowledgeReadingCharBudgets(source.detailLevel || "full", source.pages).pages.map(p => [p.id, p]));
const all = knowledgeReviewBatches(source);
const results = await Promise.all(batches.map(async index => {
  const started = Date.now();
  try {
    const out = await reviewKnowledgePublication(owner, { documentId, batchIndex: index, attempt: 0 }, { load, read, save }) as any;
    const saved = await read(`${root}/batch-${index}/report.json`);
    const accepted = await read(`${root}/batch-${index}/attempt-0/accepted.json`);
    const envelope = JSON.parse((await read(`${root}/batch-${index}/raw-0.json`)).response.text);
    const pages = out.pages.map((p: any) => ({ id: p.id, headline: p.headline, chars: knowledgeReviewPageChars(p), maxChars: budgets.get(p.id)?.maxChars }));
    return { batch: index, pageIds: all[index]!.map(n => source.pages[n]!.id), ok: true, seconds: Math.round((Date.now() - started) / 1000),
      gateway: envelope.gateway, model: envelope.modelVersion, traces: accepted?.traces || envelope.gatewayTrace, budgetFallback: envelope.budgetFallback || null,
      pages, compressionNeeded: Boolean(saved?.budgetOverflow?.before?.length), budgetOverflow: saved?.budgetOverflow || null,
      withinBudget: pages.every((p: any) => p.chars <= p.maxChars) };
  } catch (e) {
    return { batch: index, ok: false, seconds: Math.round((Date.now() - started) / 1000), error: e instanceof Error ? e.message.slice(0, 600) : String(e) };
  }
}));
const summary = { at: new Date().toISOString(), documentId, batches, probePrefix, results,
  pass: results.every((r: any) => r.ok && r.withinBudget && !r.compressionNeeded && !r.budgetFallback) };
await fs.writeFile("review-budget-probe.json", JSON.stringify(summary, null, 2));
await uploadBufferToGcs({ objectName: `${probePrefix}/summary.json`, buffer: Buffer.from(JSON.stringify(summary)), contentType: "application/json" });
console.log(JSON.stringify(summary));
if (!summary.pass) process.exitCode = 1;

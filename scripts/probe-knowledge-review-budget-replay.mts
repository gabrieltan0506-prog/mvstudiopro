/**
 * 零调用回放验证（2026-11-09 用户拍板 B：审校稿超出 ≤15% 收下转压缩）：
 * 把上一轮篇幅探针已存的 GLM@EvoLink 首跳回包（及其请求）复制到新前缀，按本分支规则重验——
 * 审校不得新购（发现即拒并记数），只允许篇幅压缩真发；断言首跳即被收下、压缩后每页 ≤ 预算、总请求数下降。
 * 用法：tsx scripts/with-worker-probe-lease.mts tsx scripts/probe-knowledge-review-budget-replay.mts <ownerId> <documentId> <batch,...> <srcProbePrefix> <replayPrefix>
 */
import fs from "node:fs/promises";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcs } from "../server/services/gcs";
import { knowledgeEvidencePrefix, knowledgeReviewPageChars, loadKnowledgePublication, reviewKnowledgePublication } from "../server/services/knowledgePublicationAdvisor";
import { invokeKnowledgePublicationRoutes, type KnowledgeModelRequest, type KnowledgeRouteEvidence } from "../server/services/knowledgePublicationRoutes";
import { KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES } from "../server/services/knowledgeModelCapabilities";
import { knowledgeReadingCharBudgets } from "../shared/knowledgeEditionBudget";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在已授权工作机执行");
await assertWorkerProbeLease();
const [ownerArg, documentId, batchArg, srcPrefix, replayPrefix] = process.argv.slice(2);
const owner = Number(ownerArg);
if (!owner || !/^[0-9a-f-]{36}$/.test(documentId || "") || !batchArg || !srcPrefix?.startsWith("probes/knowledge/") || !replayPrefix?.startsWith("probes/knowledge/") || srcPrefix === replayPrefix) throw Error("参数无效");
const batches = batchArg.split(",").map(Number);
const bucket = getGcsBucketName();
const readRaw = async (name: string) => {
  try { return JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${name}` })).buffer.toString("utf8")); }
  catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
};
const put = (name: string, value: unknown) => uploadBufferToGcs({ objectName: name, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });

// 1) 复制：请求 + GLM@EvoLink 跳的全部回执（首跳；首跳合同不符时含同跳重试），其余跳不复制。
const before: Record<string, string[]> = {};
const copied: Record<string, string[]> = {};
for (const b of batches) {
  const src = `${srcPrefix}/evidence/batch-${b}`, dst = `${replayPrefix}/evidence/batch-${b}`;
  const request = await readRaw(`${src}/request-0.json`);
  if (!request) throw Error(`第${b}批缺少原请求`);
  await put(`${dst}/request-0.json`, request);
  before[b] = []; copied[b] = [];
  for (const id of KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES) {
    const receipt = await readRaw(`${src}/attempt-0/route-${id}.json`);
    if (!receipt) continue;
    before[b].push(id);
    if (id === "glm-evolink" || id.startsWith("glm-evolink-retry-")) { await put(`${dst}/attempt-0/route-${id}.json`, receipt); copied[b].push(id); }
  }
}

const original = await loadKnowledgePublication(owner, { documentId, batchIndex: 0, attempt: 0 });
const root = knowledgeEvidencePrefix(owner, documentId, original.publication.requestId);
const map = (name: string) => name.startsWith(`${root}/`) ? `${replayPrefix}/evidence/${name.slice(root.length + 1)}` : name;
const read = (name: string) => readRaw(map(name));
const save = async (name: string, value: unknown) => {
  if (!map(name).startsWith(`${replayPrefix}/`)) throw Error(`回放禁止写入原云稿对象：${name}`);
  await put(map(name), value);
};
const load = async (...args: Parameters<typeof loadKnowledgePublication>) => {
  const doc = await loadKnowledgePublication(...args);
  const channels = Object.fromEntries(batches.map(i => [String(i), "evolink" as const]));
  return { ...doc, publication: { ...doc.publication, attempts: {}, parallel: { channels, completed: [], family: "glm" as const } } } as typeof doc;
};
// 2) 只放行篇幅压缩的真发；任何审校新购即拒并记数（证明首跳回包零调用被收下）。
const calls = { compression: 0, blockedReview: 0 };
const guardedFetch = async (url: any, init?: RequestInit) => {
  const body = String(init?.body || "");
  if (!body.includes("这是篇幅压缩")) { calls.blockedReview++; throw Error("回放禁止新购审校"); }
  calls.compression++;
  return fetch(url, init);
};
const post = (request: unknown, evidence: KnowledgeRouteEvidence) =>
  invokeKnowledgePublicationRoutes(request as KnowledgeModelRequest, evidence, { fetch: guardedFetch } as any);

const source = original.publication.source;
const budgets = new Map(knowledgeReadingCharBudgets(source.detailLevel || "full", source.pages).pages.map(p => [p.id, p]));
const results = [];
for (const index of batches) {
  try {
    const out = await reviewKnowledgePublication(owner, { documentId, batchIndex: index, attempt: 0 }, { load, read, save, post } as any) as any;
    const saved = await read(`${root}/batch-${index}/report.json`);
    const budget = await read(`${root}/batch-${index}/compress/budget.json`);
    const envelope = JSON.parse((await read(`${root}/batch-${index}/raw-0.json`)).response.text);
    results.push({ batch: index, ok: true, acceptedRoute: envelope.gateway, budgetTolerated: saved?.budgetTolerated || null,
      pages: out.pages.map((p: any) => ({ headline: p.headline, chars: knowledgeReviewPageChars(p), maxChars: budgets.get(p.id)?.maxChars })),
      functionResolved: budget?.functionResolved?.length || 0, llmPages: budget?.llmPages || {}, compressionRounds: budget?.rounds?.length || 0,
      requestsBefore: before[index]!.length, requestsBeforeRoutes: before[index], replayedRoutes: copied[index] });
  } catch (e) {
    results.push({ batch: index, ok: false, error: e instanceof Error ? e.message.slice(0, 600) : String(e), requestsBefore: before[index]!.length });
  }
}
const requestsBefore = Object.values(before).reduce((n, v) => n + v.length, 0);
// 按新规则本应发出的请求 = 被回放收下前用到的 GLM@EvoLink 跳回执 + 篇幅压缩真发次数（审校零新购）。
const requestsAfter = Object.values(copied).reduce((n, v) => n + v.length, 0) + calls.compression;
const summary = { at: new Date().toISOString(), batches, srcPrefix, replayPrefix, calls, requestsBefore, requestsAfter, results,
  pass: calls.blockedReview === 0 && results.every((r: any) => r.ok && r.acceptedRoute?.startsWith("glm-evolink") && r.pages.every((p: any) => p.chars <= p.maxChars)) && requestsAfter < requestsBefore };
await fs.writeFile("review-budget-replay.json", JSON.stringify(summary, null, 2));
await put(`${replayPrefix}/summary.json`, summary);
console.log(JSON.stringify(summary));
if (!summary.pass) process.exitCode = 1;

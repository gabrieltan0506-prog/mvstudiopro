/**
 * 提炼进行中的分段预览（1119 F2）：只读已落盘的读档分组输入（knowledge-reading/user-{uid}/{jobId}/batch-{i}/input.json），
 * 按原顺序返回已完成的分段正文。不调用任何模型、不扣费、不写任何对象；提炼结束后的产物与流程不受影响。
 * 对象布局与 server/services/knowledgeReadingPreparation.ts 的 prefix()/batch 写入一致（该文件归属他线，这里只读不改）。
 */
import { z } from "zod";
import { loadKnowledgeReadingPreparation } from "./knowledgeReadingPreparation";
import { downloadGcsObjectVersioned, getGcsBucketName } from "./gcs";

export const KNOWLEDGE_DISTILL_PREVIEW_MAX_BATCHES = 8;
const inputSchema = z.object({
  index: z.number().int().min(0),
  source: z.object({ pages: z.array(z.object({ headline: z.string(), body: z.string() }).passthrough()) }).passthrough(),
}).passthrough();

type Deps = {
  load: typeof loadKnowledgeReadingPreparation;
  read: (name: string) => Promise<unknown | null>;
};
const realDeps: Deps = {
  load: loadKnowledgeReadingPreparation,
  async read(name) {
    try { return JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${name}` })).buffer.toString("utf8")); }
    catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
  },
};

export async function knowledgeDistillPreview(owner: number, jobId: string, fromBatch: number, deps: Deps = realDeps) {
  // 归属与任务类型由读档计划加载函数核验（非本人或非读档任务直接拒绝）
  const { plan } = await deps.load(owner, jobId);
  const end = Math.min(plan.batches, fromBatch + KNOWLEDGE_DISTILL_PREVIEW_MAX_BATCHES);
  const root = `knowledge-reading/user-${owner}/${jobId}`;
  const segments: Array<{ index: number; pages: Array<{ headline: string; body: string }> }> = [];
  for (let i = fromBatch; i < end; i++) {
    const raw = await deps.read(`${root}/batch-${i}/input.json`);
    // 原顺序：遇到第一个尚未落盘的分组就停，后面的即使已完成也等前面补齐再显示，避免跳段
    if (!raw) break;
    const parsed = inputSchema.parse(raw);
    if (parsed.index !== i) throw new Error("读档分组身份不一致");
    segments.push({ index: i, pages: parsed.source.pages.map(p => ({ headline: p.headline, body: p.body })) });
  }
  return {
    batches: plan.batches,
    /** 文件型原稿走「原文分段」：预览的是已读取原文，尚未提炼 */
    kind: (plan as { rawSources?: unknown[] }).rawSources ? ("source" as const) : ("distilled" as const),
    nextBatch: fromBatch + segments.length,
    segments,
  };
}

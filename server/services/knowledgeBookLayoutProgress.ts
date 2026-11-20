import { downloadGcsObjectVersioned, getGcsBucketName, listGcsObjectNamesByPrefix } from "./gcs";

/**
 * 整册排版的分组进度（只读）：整册排版在服务端按每组 ≤4 章并行发出、每组各留回执，
 * 前台原先只看到一个不动的「整册排版」步骤。这里只数已落盘的分组结果，不调模型、不写对象、不改任何请求身份。
 */
export type KnowledgeBookLayoutProgress = { total: number; done: number; finished: boolean };

/** 由对象名清点：本次请求目录下 batch-N/report.json 的个数；整册 report.json 已落盘即全部完成。 */
export function knowledgeBookLayoutProgressFromNames(prefix: string, total: number, names: readonly string[]): KnowledgeBookLayoutProgress {
  const count = Math.max(0, Math.floor(total || 0));
  const root = prefix.replace(/\/+$/, "") + "/";
  const done = new Set<number>();
  let finished = false;
  for (const name of names) {
    if (!name.startsWith(root)) continue;
    const rest = name.slice(root.length);
    if (rest === "report.json") { finished = true; continue; }
    const match = /^batch-(\d+)\/report\.json$/.exec(rest);
    if (match && Number(match[1]) < count) done.add(Number(match[1]));
  }
  return finished ? { total: count, done: count, finished: true } : { total: count, done: done.size, finished: false };
}

const real = {
  read: async (name: string): Promise<any> => {
    try { return JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${name}` })).buffer.toString("utf8")); }
    catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
  },
  list: (prefix: string) => listGcsObjectNamesByPrefix({ prefix, maxResults: 1000 }),
};

/** 尚未分组（请求还没发出）时返回 total=0；前台据此不显示计数。 */
export async function loadKnowledgeBookLayoutProgress(owner: number, documentId: string, requestId: string, overrides: Partial<typeof real> = {}): Promise<KnowledgeBookLayoutProgress> {
  const deps = { ...real, ...overrides };
  const prefix = `knowledge-publications/user-${owner}/${documentId}/conversation/${requestId}`;
  const plan = await deps.read(`${prefix}/batches.json`);
  const total = Array.isArray(plan?.batches) ? plan.batches.length : 0;
  if (!total) return { total: 0, done: 0, finished: false };
  return knowledgeBookLayoutProgressFromNames(prefix, total, await deps.list(prefix));
}

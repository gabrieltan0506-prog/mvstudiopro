import { listGcsObjectNamesByPrefix } from "./gcs";

/**
 * 一本手册稿「出图之后」各步骤发出过多少模型请求（只读清点回执对象名；不下载回执正文、不调模型、不写对象）。
 * 站长 2026-11-21 问「这次 LLM 调用了几次，后台能查得出来吗」：每次请求都有永久回执 route-<通道>.json，
 * 但此前没有任何接口把数字露出来。
 * 口径：一份 route-*.json = 某一步的某一组在某条通道上发出过请求（含失败的）；同一通道的原地重试覆盖同一份回执，
 * 不另计，所以这是「至少发出过的请求数」，不是精确的重试次数。
 */
export type KnowledgePublicationCallStage = "review" | "review_followup" | "consistency" | "final_compress" | "layout" | "conversation" | "other";
export const KNOWLEDGE_PUBLICATION_CALL_STAGE_LABELS: Record<KnowledgePublicationCallStage, string> = {
  review: "逐章整理", review_followup: "逐章整理的压缩与补充", consistency: "全册核对", final_compress: "统稿篇幅压缩",
  layout: "整册排版", conversation: "顾问交流", other: "其他",
};
export type KnowledgePublicationCallStats = {
  total: number;
  stages: { stage: KnowledgePublicationCallStage; label: string; requests: number; units: number }[];
  byRoute: Record<string, number>;
  /** 因传输中断补买过的单元数（interrupted-repurchase.json 的个数）。 */
  interruptedRepurchases: number;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function classify(relative: string): { stage: KnowledgePublicationCallStage; unit: string } {
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^conversation/(${UUID})/(batch-\\d+)/`).exec(relative))) return { stage: "layout", unit: `${m[1]}/${m[2]}` };
  if ((m = new RegExp(`^conversation/(${UUID})/`).exec(relative))) return { stage: "conversation", unit: m[1]! };
  if ((m = new RegExp(`^(${UUID})/(consistency-\\d+)/`).exec(relative))) return { stage: "consistency", unit: `${m[1]}/${m[2]}` };
  if ((m = new RegExp(`^(${UUID})/final-compress/(.*)$`).exec(relative))) return { stage: "final_compress", unit: `${m[1]}/${m[2]!.split("/").slice(0, -1).join("/")}` };
  if ((m = new RegExp(`^(${UUID})/(batch-\\d+)/([^/]+)$`).exec(relative))) return { stage: "review", unit: `${m[1]}/${m[2]}` };
  if ((m = new RegExp(`^(${UUID})/(batch-\\d+)/(.+)/[^/]+$`).exec(relative))) return { stage: "review_followup", unit: `${m[1]}/${m[2]}/${m[3]}` };
  return { stage: "other", unit: relative.split("/").slice(0, -1).join("/") };
}

export function knowledgePublicationCallStatsFromNames(prefix: string, names: readonly string[]): KnowledgePublicationCallStats {
  const root = prefix.replace(/\/+$/, "") + "/";
  const stages = new Map<KnowledgePublicationCallStage, { requests: number; units: Set<string> }>();
  const byRoute: Record<string, number> = {};
  let total = 0, interruptedRepurchases = 0;
  for (const name of names) {
    if (!name.startsWith(root)) continue;
    const relative = name.slice(root.length), file = relative.slice(relative.lastIndexOf("/") + 1);
    if (file === "interrupted-repurchase.json") { interruptedRepurchases++; continue; }
    const route = /^route-(.+)\.json$/.exec(file);
    if (!route) continue;
    const { stage, unit } = classify(relative);
    const entry = stages.get(stage) ?? { requests: 0, units: new Set<string>() };
    entry.requests++; entry.units.add(unit); stages.set(stage, entry);
    byRoute[route[1]!] = (byRoute[route[1]!] ?? 0) + 1;
    total++;
  }
  const order = Object.keys(KNOWLEDGE_PUBLICATION_CALL_STAGE_LABELS) as KnowledgePublicationCallStage[];
  return {
    total, byRoute, interruptedRepurchases,
    stages: order.filter(stage => stages.has(stage)).map(stage => ({ stage, label: KNOWLEDGE_PUBLICATION_CALL_STAGE_LABELS[stage], requests: stages.get(stage)!.requests, units: stages.get(stage)!.units.size })),
  };
}

export async function loadKnowledgePublicationCallStats(owner: number, documentId: string,
  list: (prefix: string) => Promise<string[]> = prefix => listGcsObjectNamesByPrefix({ prefix, allPages: true })): Promise<KnowledgePublicationCallStats> {
  const prefix = `knowledge-publications/user-${owner}/${documentId}`;
  return knowledgePublicationCallStatsFromNames(prefix, await list(prefix));
}

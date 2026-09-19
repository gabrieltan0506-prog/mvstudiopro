import { z } from "zod";

/** 非比例空间拓扑；不推断图片深度、碰撞面或真实尺度。 */
export const manhuaSceneSpaceSchema = z.object({
  version: z.literal(1),
  sourceRefId: z.string().min(1),
  sourceVersion: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  sourceNoteZh: z.string(),
  zones: z.array(z.object({ id: z.string().min(1), labelZh: z.string(), fixedFeaturesZh: z.string() })),
  passages: z.array(z.object({ id: z.string().min(1), fromId: z.string(), toId: z.string(), labelZh: z.string(), bidirectional: z.boolean() })),
});
export type ManhuaSceneSpace = z.infer<typeof manhuaSceneSpaceSchema>;
export type ManhuaSceneSpaceRef = { id: string; role: string; url: string; gcsUri?: string; reviewStatus?: string; sceneSpace?: ManhuaSceneSpace };

export function normalizeManhuaSceneSpace(raw: unknown): ManhuaSceneSpace | undefined {
  const parsed = manhuaSceneSpaceSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
export function manhuaSceneSpaceSourceVersion(ref: ManhuaSceneSpaceRef): string {
  if (ref.gcsUri) return ref.gcsUri;
  try {
    const url = new URL(ref.url);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(x-goog-|x-amz-)/i.test(key) || /^(sig|signature|exp|expires|token|googleaccessid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch { return ref.url; }
}
export function inspectManhuaSceneSpace(space: ManhuaSceneSpace): string[] {
  const issues: string[] = [];
  if (!space.sourceNoteZh.trim()) issues.push("请填写剧本或参考图的来源依据");
  if (!space.zones.length) issues.push("至少填写一个实际区域");
  const ids = new Set(space.zones.map(zone => zone.id));
  if (ids.size !== space.zones.length) issues.push("区域身份重复");
  if (space.zones.some(zone => !zone.labelZh.trim())) issues.push("区域名称待补");
  if (new Set(space.passages.map(p => p.id)).size !== space.passages.length) issues.push("出入口身份重复");
  if (space.passages.some(p => !ids.has(p.fromId) || !ids.has(p.toId) || p.fromId === p.toId || !p.labelZh.trim())) issues.push("出入口须有名称，并连接两个不同的现有区域");
  return issues;
}
export function manhuaSceneSpaceState(ref: ManhuaSceneSpaceRef): "missing" | "draft" | "stale" | "approved" {
  const space = ref.sceneSpace;
  if (!space) return "missing";
  if (space.sourceRefId !== ref.id || space.sourceVersion !== manhuaSceneSpaceSourceVersion(ref)) return "stale";
  if (ref.role !== "scene" || ref.reviewStatus === "needs_review" || space.status !== "approved" || inspectManhuaSceneSpace(space).length) return "draft";
  return "approved";
}
/** 沿本段实际采用的场景身份消费，不能按中文同名跨场景借图。 */
export function compileManhuaSceneSpace(refs: readonly ManhuaSceneSpaceRef[], sceneIds: readonly string[]): string {
  const selected = new Set(sceneIds);
  return refs.filter(ref => selected.has(ref.id) && manhuaSceneSpaceState(ref) === "approved").map(ref => {
    const space = ref.sceneSpace!;
    const names = new Map(space.zones.map(z => [z.id, z.labelZh.trim()]));
    return `【场景空间·${ref.id}·v${space.revision}】非比例拓扑，不代表实测几何。依据：${space.sourceNoteZh}。区域：${space.zones.map(z => `${z.labelZh}${z.fixedFeaturesZh ? `（固定结构：${z.fixedFeaturesZh}）` : ""}`).join("；")}。通路：${space.passages.length ? space.passages.map(p => `${names.get(p.fromId)}${p.bidirectional ? "↔" : "→"}${names.get(p.toId)}（${p.labelZh}）`).join("；") : "未标通路，不推断区域间可穿行"}。不得穿越未标明的墙体或出入口。`;
  }).join("\n");
}

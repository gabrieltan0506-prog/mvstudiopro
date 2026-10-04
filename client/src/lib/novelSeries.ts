import { novelScriptSchema } from "@shared/novelWorkspace";
import { type NovelWorkspace, type NovelRun } from "./novelWorkspace";

export const batchStart = (d: NovelWorkspace) => d.episodeStart || 1;
export const batchEnd = (d: NovelWorkspace) =>
  batchStart(d) + d.episodeCount - 1;
export const batchNovel = (d: NovelWorkspace) =>
  Array.from({ length: d.episodeCount }, (_, i) => {
    const index = batchStart(d) + i;
    return `第${index}集\n${d.chapters[index - 1] || ""}`;
  }).join("\n\n");
export function continuationContext(d: NovelWorkspace, before: number) {
  if (
    before > 2 &&
    (!d.continuity?.trim() ||
      (d.continuityThrough || 0) < before - 2 ||
      d.continuityBase !==
        d.chapters.slice(0, d.continuityThrough || 0).join("\n\n"))
  )
    throw new Error(
      "前文已变动或前情档案尚未确认，请在续写档案中核对人物与伏笔，再继续。"
    );
  return d.chapters.slice(Math.max(0, before - 2), before).join("\n\n");
}
export function nextNovelBatch(
  d: NovelWorkspace,
  count: number
): NovelWorkspace {
  if (d.pending || d.generationQueue) throw new Error("请先完成或暂停当前批次");
  if (
    d.novelApproved !== batchNovel(d) ||
    !d.novelApproved ||
    Object.keys(d.chapterWarnings || {}).some(k => Number(k) < batchEnd(d))
  )
    throw new Error("请先审阅本批小说并核对衔接提示");
  const start = batchEnd(d) + 1,
    target = d.targetEpisodeCount || batchEnd(d);
  if (target < start)
    throw new Error("已达到全剧计划；可调整总集数或开始第二季");
  return {
    ...d,
    reviewedBatches: [
      ...(d.reviewedBatches || []),
      {
        start: batchStart(d),
        count: d.episodeCount,
        outline: d.outline,
        chapters: d.chapters.slice(batchStart(d) - 1, batchEnd(d)),
        templates: d.templates.map(t => ({ ...t })),
      },
    ],
    episodeStart: start,
    episodeCount: Math.min(count, target - start + 1),
    outline: "",
    outlineApproved: "",
    novelApproved: "",
    advisorAnchor: undefined,
  };
}
export async function novelTextHash(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    b => b.toString(16).padStart(2, "0")
  ).join("");
}
/** Only complete, sequential script batches become selectable. Original receipts are never replaced. */
export function completeScriptBatches(runs: NovelRun[]): NovelRun[] {
  const result = runs.filter(
    r => r.input.stage === "script" && !r.input.scriptBatch
  );
  const groups = new Map<string, NovelRun[]>();
  for (const r of runs)
    if (r.input.stage === "script" && r.input.scriptBatch) {
      const id = r.input.scriptBatch.id;
      groups.set(id, [...(groups.get(id) || []), r]);
    }
  for (const [id, parts] of Array.from(groups)) {
    const batch = parts[0].input.scriptBatch!;
    const sorted = [...parts].sort(
      (a, b) => (a.input.episodeStart || 1) - (b.input.episodeStart || 1)
    );
    if (
      sorted.length !== batch.count ||
      sorted.some(
        (p, i) =>
          p.input.episodeStart !== batch.start + i ||
          JSON.stringify(p.input.scriptBatch) !== JSON.stringify(batch)
      )
    )
      continue;
    const scripts = sorted.map(p =>
      novelScriptSchema.parse(JSON.parse(p.result.text))
    );
    const episodes = scripts.flatMap(s => s.episodes);
    if (
      episodes.length !== batch.count ||
      episodes.some((e, i) => e.index !== batch.start + i)
    )
      continue;
    result.push({
      input: {
        ...sorted[0].input,
        requestId: id,
        episodeCount: batch.count,
        episodeStart: batch.start,
      },
      result: {
        ...sorted[0].result,
        requestId: id,
        text: JSON.stringify({
          title: scripts[0].title,
          episodes,
          applications: scripts.flatMap(s => s.applications || []),
        }),
        resultSha256: "", // Derived view; adoption computes its own SHA-256, never impersonates a provider receipt.
      },
    });
  }
  return result;
}

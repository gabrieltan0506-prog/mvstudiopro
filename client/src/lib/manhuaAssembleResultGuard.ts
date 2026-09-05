import type { CanvasBlock } from "./canvasTypes";
import { normalizeManhuaRenderedSubtitle, type ManhuaRenderedSubtitle } from "@shared/manhuaRenderedSubtitle";

export type ManhuaAssembleReceipt = {
  jobId: string; ownerId: string; title: string; url: string; createdAt: number;
  subtitleTimeline?: ManhuaRenderedSubtitle;
};
const KEY = "mv-manhua-assemble-receipts-v1";

/** 只核对真实源片，换剧/换源后迟到结果可取件，但不能覆盖当前项目。 */
export function canApplyManhuaAssembleResult(input: {
  submittedProject: string; currentProject: string; blocks: CanvasBlock[];
  clips: Array<{ blockId?: string; clipUrl?: string }>;
}): boolean {
  return input.submittedProject === input.currentProject && input.clips.length > 0 && input.clips.every(clip =>
    !!clip.blockId && input.blocks.some(block => block.id === clip.blockId && String(block.outputUrl || "").trim() === clip.clipUrl));
}

export function readManhuaAssembleReceipts(storage: Pick<Storage, "getItem">, ownerId: string): ManhuaAssembleReceipt[] {
  const raw = storage.getItem(KEY);
  const rows: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(rows)) throw new Error("合成恢复记录损坏，原记录已保留");
  return rows.filter(row => row && typeof row === "object" && row.ownerId === ownerId &&
    typeof row.jobId === "string" && typeof row.title === "string" && Number.isFinite(row.createdAt) &&
    typeof row.url === "string" && /^https:\/\//.test(row.url)).map(row => ({ ...row,
      subtitleTimeline: normalizeManhuaRenderedSubtitle(row.subtitleTimeline) }));
}

export function saveManhuaAssembleReceipt(storage: Pick<Storage, "getItem" | "setItem">, receipt: ManhuaAssembleReceipt): void {
  const raw = storage.getItem(KEY);
  const rows: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(rows)) throw new Error("合成恢复记录损坏，原记录已保留");
  storage.setItem(KEY, JSON.stringify([receipt, ...rows.filter(row => !(row?.jobId === receipt.jobId && row?.ownerId === receipt.ownerId))]));
}

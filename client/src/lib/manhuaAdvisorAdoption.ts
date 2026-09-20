import { formatManhuaWriterPackMarkdown, type ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import type { ManhuaProjectBible } from "@shared/manhuaProjectBible";
import { buildManhuaWriterSession, MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession } from "@shared/manhuaWriterSession";
import { advisorRewriteCandidateSchema } from "./manhuaAdvisorTemplates";
import { stripManhuaFactoryCanvasArtifacts } from "./canvasDramaStudio";
import { markManhuaDirectorBoardOverlaysForReview, type ManhuaDirectorBoardOverlayBySegment } from "./manhuaDirectorBoardStore";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";
import { ADVISOR_BACKUP_PREFIX } from "./manhuaAdvisorBackups";

const CANVAS_KEY = "mv-freeform-canvas-v1";
const OVERLAY_KEY = "mv-manhua-director-board-overlay-v1";
const UNSETTLED = new Set(["queued", "running", "timed_out_pending_reconcile", "reconcile_manual"]);

/** 已提交但未决的任务也挡改稿，不能只看画布status或把超时当失败。 */
export function advisorRewriteHasActiveWork(blocks: CanvasBlock[]): boolean {
  return blocks.some(b => b.status === "running" || (Boolean(b.videoTaskId) && !b.videoTaskStatus) || (Boolean(b.upscaleTaskId) && !b.upscaleStatus) || UNSETTLED.has(b.videoTaskStatus || "")
    || UNSETTLED.has(b.upscaleStatus || "") || Boolean(b.previsStudio?.pending)
    || Boolean(b.audioStudio?.pendingOperations.length)
    || ["pending_submit", "submitted", "acknowledged", "unverified"].includes(b.videoIntentStatus || "")
    || ["queued", "running"].includes(b.manhuaFinalPostProd?.status || "")
    || ["music_running", "planning", "rendering", "assembling"].includes(b.musicMv?.status || ""));
}

export function prepareAdvisorRewriteAdoption(input: {
  candidate: unknown; writerPack: ManhuaWriterPack | null; projectBible: ManhuaProjectBible | null;
  blocks: CanvasBlock[]; edges: CanvasEdge[]; overlays: ManhuaDirectorBoardOverlayBySegment; busy: boolean;
}) {
  const checked = advisorRewriteCandidateSchema.safeParse(input.candidate);
  if (!checked.success || !input.writerPack) throw new Error("改写内容不完整，未采用。");
  if (input.busy || advisorRewriteHasActiveWork(input.blocks)) throw new Error("仍有运行或待核实任务，请先等待原任务回执，未采用改写。");
  const candidate = checked.data;
  if (input.writerPack.episodes.find(ep => ep.index === candidate.episodeIndex)?.body !== candidate.originalBody) throw new Error("原稿已改变，请根据最新正文重新改写。");
  const writerPack = { ...input.writerPack, episodes: input.writerPack.episodes.map(ep => ep.index === candidate.episodeIndex ? { ...ep, body: candidate.rewrittenBody } : ep) };
  writerPack.rawMarkdown = formatManhuaWriterPackMarkdown({ ...writerPack, rawMarkdown: "" });
  const canvas = stripManhuaFactoryCanvasArtifacts(input.blocks, input.edges, { fromEpisode: candidate.episodeIndex });
  const affected = Object.fromEntries(Object.entries(input.overlays).filter(([ep]) => Number(ep) >= candidate.episodeIndex));
  const overlays = { ...input.overlays, ...markManhuaDirectorBoardOverlaysForReview(affected) };
  return { candidate, writerPack, canvas, overlays, writerConfirmed: false as const, directorUnlocked: false as const, workflowPhase: "outline" as const, focusEpisode: candidate.episodeIndex };
}

/** 旧稿先落盘，再保存新稿/画布/复核态；任一失败回滚已写键，宿主尚不改内存。 */
export function persistAdvisorRewriteAdoption(input: {
  plan: ReturnType<typeof prepareAdvisorRewriteAdoption>;
  original: { writerPack: ManhuaWriterPack; projectBible: ManhuaProjectBible | null; blocks: CanvasBlock[]; edges: CanvasEdge[]; overlays: ManhuaDirectorBoardOverlayBySegment };
  userId: string; backupId: string; createdAt: string;
}, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage): string {
  const { plan, original } = input;
  const backupKey = `${ADVISOR_BACKUP_PREFIX}${input.userId}:${input.backupId}`;
  const keys = [MANHUA_WRITER_SESSION_LS_KEY, CANVAS_KEY, OVERLAY_KEY];
  const before = keys.map(key => storage.getItem(key));
  const priorSession = before[0] ? JSON.parse(before[0]) : {};
  if (!priorSession || typeof priorSession !== "object" || Array.isArray(priorSession)) throw new Error("现有剧本存档不可读取，未采用改写。");
  const session = buildManhuaWriterSession({ ...priorSession, writerPack: plan.writerPack, projectBible: original.projectBible,
    writerConfirmed: false, directorUnlocked: false, workflowPhase: "outline", focusEpisode: plan.focusEpisode });
  const values = [serializeManhuaWriterSession(session), JSON.stringify({ blocks: plan.canvas.blocks, edges: plan.canvas.edges }), JSON.stringify(plan.overlays)];
  try {
    storage.setItem(backupKey, JSON.stringify({ createdAt: input.createdAt, writerPack: original.writerPack, projectBible: original.projectBible,
      episodeIndex: plan.candidate.episodeIndex, changes: plan.candidate.changes, adoptedWriterPack: plan.writerPack,
      canvas: { blocks: original.blocks, edges: original.edges }, directorBoardOverlays: original.overlays, previousWriterSession: before[0] }));
  } catch { throw new Error("旧稿备份保存失败，未采用改写。请先导出备份并释放本机存储。"); }
  let written = 0;
  try {
    for (let i = 0; i < keys.length; i++) { storage.setItem(keys[i]!, values[i]!); written++; }
  } catch {
    let restored = true;
    for (let i = written - 1; i >= 0; i--) {
      try { if (before[i] === null) storage.removeItem(keys[i]!); else storage.setItem(keys[i]!, before[i]!); }
      catch { restored = false; }
    }
    throw new Error(restored ? "改写保存失败，已保留原工程与旧稿备份，未采用。" : "改写保存失败且存储回退未完成，请勿刷新；旧稿完整备份已保存，可下载恢复。");
  }
  return backupKey;
}

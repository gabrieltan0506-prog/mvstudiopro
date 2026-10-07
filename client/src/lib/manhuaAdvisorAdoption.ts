import { manhuaProjectStorage as localStorage } from "@shared/manhuaProjectScope";
import { formatManhuaWriterPackMarkdown, type ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import type { ManhuaProjectBible } from "@shared/manhuaProjectBible";
import { buildManhuaWriterSession, MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession } from "@shared/manhuaWriterSession";
import { advisorRewriteCandidateSchema, replaceManhuaEpisodeStoryText, splitManhuaEpisodeStoryText, validateAdvisorRewriteBody, type AdvisorRewriteCandidate } from "@shared/manhuaAdvisorRewrite";
import { stripManhuaFactoryCanvasArtifacts } from "./canvasDramaStudio";
import { markManhuaDirectorBoardOverlaysForReview, type ManhuaDirectorBoardOverlayBySegment } from "./manhuaDirectorBoardStore";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";
import { ADVISOR_BACKUP_PREFIX } from "./manhuaAdvisorBackups";
import { currentManhuaProjectScope } from "@shared/manhuaProjectScope";
import { saveSceneProductionBackup } from "./manhuaSceneProductionBackups";

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

type AdoptionInput = {
  writerPack: ManhuaWriterPack | null; projectBible: ManhuaProjectBible | null;
  blocks: CanvasBlock[]; edges: CanvasEdge[]; overlays: ManhuaDirectorBoardOverlayBySegment; busy: boolean;
};

export type ManualEpisodeEdit = {
  episodeIndex: number;
  originalBody: string;
  originalEndHook: string;
  body: string;
  endHook: string;
};

function assertAdoptionReady(input: AdoptionInput, episodeIndex: number, originalBody: string, originalEndHook?: string) {
  if (!input.writerPack) throw new Error("改写内容不完整，未采用。");
  if (input.busy || advisorRewriteHasActiveWork(input.blocks)) throw new Error("仍有运行或待核实任务，请先等待原任务回执，未采用改写。");
  const episode = input.writerPack.episodes.find(ep => ep.index === episodeIndex);
  if (!episode || episode.body !== originalBody) throw new Error("原稿已改变，请根据最新正文重新改写。");
  if (originalEndHook !== undefined && (episode.endHook || "") !== originalEndHook) throw new Error("片尾钩子已改变，请根据最新原稿重新优化。");
}

function prepareAdoptionPlan(input: AdoptionInput, candidate: AdvisorRewriteCandidate, endHook?: string) {
  const rewrittenBody = replaceManhuaEpisodeStoryText(candidate.originalBody, candidate.rewrittenBody);
  const writerPack = { ...input.writerPack!, episodes: input.writerPack!.episodes.map(ep => ep.index === candidate.episodeIndex ? { ...ep, body: rewrittenBody, storyboardNeedsReview: true, ...(endHook !== undefined ? { endHook } : {}) } : ep) };
  writerPack.rawMarkdown = formatManhuaWriterPackMarkdown({ ...writerPack, rawMarkdown: "" });
  const changedEpisodeIndexes = [candidate.episodeIndex];
  const canvas = stripManhuaFactoryCanvasArtifacts(input.blocks, input.edges, { onlyEpisodes: changedEpisodeIndexes });
  const affected = Object.fromEntries(Object.entries(input.overlays).filter(([ep]) => changedEpisodeIndexes.includes(Number(ep))));
  const overlays = { ...input.overlays, ...markManhuaDirectorBoardOverlaysForReview(affected) };
  return { candidate, writerPack, canvas, overlays, changedEpisodeIndexes, assetsNeedReview: true as const,
    technicalPlanNeedsReview: splitManhuaEpisodeStoryText(candidate.originalBody).technicalSections.length > 0,
    writerConfirmed: false as const, directorUnlocked: false as const, workflowPhase: "outline" as const, focusEpisode: candidate.episodeIndex };
}

export function prepareAdvisorRewriteAdoption(input: AdoptionInput & { candidate: unknown }) {
  const checked = advisorRewriteCandidateSchema.safeParse(input.candidate);
  if (!checked.success || !input.writerPack) throw new Error("改写内容不完整，未采用。");
  const candidate = checked.data;
  assertAdoptionReady(input, candidate.episodeIndex, candidate.originalBody,
    candidate.endHook !== undefined ? candidate.originalEndHook ?? "" : candidate.originalEndHook);
  validateAdvisorRewriteBody(candidate.originalBody, candidate.rewrittenBody, candidate.endHook);
  return prepareAdoptionPlan(input, candidate, candidate.endHook);
}

/** 人工可删场、缩写和清空钩子；仍共用原稿冲突、任务与备份事务门禁。 */
export function prepareManualEpisodeEditAdoption(input: AdoptionInput & { edit: ManualEpisodeEdit }) {
  const { edit } = input;
  if (!Number.isSafeInteger(edit.episodeIndex) || edit.episodeIndex < 1 || !edit.body.trim()) throw new Error("本集剧情正文不能为空，未保存修改。");
  assertAdoptionReady(input, edit.episodeIndex, edit.originalBody, edit.originalEndHook);
  if (splitManhuaEpisodeStoryText(edit.originalBody).story === edit.body.trim() && edit.originalEndHook === edit.endHook) throw new Error("本集内容没有变化。");
  return prepareAdoptionPlan(input, { episodeIndex: edit.episodeIndex, originalBody: edit.originalBody,
    originalEndHook: edit.originalEndHook, rewrittenBody: edit.body, endHook: edit.endHook,
    changes: ["用户确认编辑本集剧情与对白"] }, edit.endHook);
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
      episodeIndex: plan.candidate.episodeIndex, changedEpisodeIndexes: plan.changedEpisodeIndexes, technicalPlanNeedsReview: plan.technicalPlanNeedsReview,
      changes: plan.candidate.changes, adoptedWriterPack: plan.writerPack,
      canvas: { blocks: original.blocks, edges: original.edges }, directorBoardOverlays: original.overlays, previousWriterSession: before[0], previousFactoryPrefs: storage.getItem("mv-manhua-factory-character-prefs-v1") }));
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

/** Use the existing immutable snapshot store before committing any new draft. */
export async function persistAdvisorRewriteAdoptionWithSnapshot(
  input: Parameters<typeof persistAdvisorRewriteAdoption>[0] & { beforeCommit?: () => void },
  storage: Parameters<typeof persistAdvisorRewriteAdoption>[1] = localStorage,
  saveSnapshot = saveSceneProductionBackup,
): Promise<string> {
  const scope = JSON.stringify(currentManhuaProjectScope());
  const keys = [MANHUA_WRITER_SESSION_LS_KEY, CANVAS_KEY, OVERLAY_KEY, "mv-manhua-factory-character-prefs-v1"];
  const before = keys.map(key => storage.getItem(key));
  let snapshot = "";
  // Prepare using the same transaction serializer, without changing stored state.
  const key = persistAdvisorRewriteAdoption(input, {
    getItem: k => storage.getItem(k),
    setItem: (k, value) => { if (k.startsWith(ADVISOR_BACKUP_PREFIX)) snapshot = value; },
    removeItem: () => { throw new Error("备份准备过程异常，未采用改写。"); },
  });
  if (!snapshot) throw new Error("旧稿快照不完整，未采用改写。");
  await saveSnapshot(input.userId, key, snapshot);
  if (scope !== JSON.stringify(currentManhuaProjectScope()) || keys.some((k, i) => storage.getItem(k) !== before[i]))
    throw new Error("备份期间作品或资产已改变，旧稿已保留，未采用改写。");
  input.beforeCommit?.();
  // Keep the original write/rollback contract; the verified snapshot is already saved.
  return persistAdvisorRewriteAdoption(input, {
    getItem: k => storage.getItem(k),
    setItem: (k, value) => {
      if (k === key) {
        if (value !== snapshot) throw new Error("旧稿快照已变化，未采用改写。");
      } else storage.setItem(k, value);
    },
    removeItem: k => storage.removeItem(k),
  });
}

/** 批次先验证每一集，再一次备份和写入整稿，避免循环setState覆盖前一集。 */
export function prepareAdvisorRewriteBatchAdoption(input: Omit<Parameters<typeof prepareAdvisorRewriteAdoption>[0], "candidate"> & { candidates: unknown[] }) {
  if (!input.candidates.length) throw new Error("没有可套用的优化稿");
  const checked = input.candidates.map(candidate => prepareAdvisorRewriteAdoption({ ...input, candidate }));
  if (new Set(checked.map(p=>p.candidate.episodeIndex)).size !== checked.length) throw new Error("同一集出现多份候选，请只选一版");
  const first = checked.reduce((a,b)=>a.candidate.episodeIndex<b.candidate.episodeIndex?a:b);
  const replacements = new Map(checked.map(p=>[p.candidate.episodeIndex,p.writerPack.episodes.find(e=>e.index===p.candidate.episodeIndex)!]));
  const writerPack={...first.writerPack,episodes:input.writerPack!.episodes.map(ep=>replacements.get(ep.index)||ep)};
  writerPack.rawMarkdown=formatManhuaWriterPackMarkdown({...writerPack,rawMarkdown:""});
  const changedEpisodeIndexes = checked.map(plan => plan.candidate.episodeIndex).sort((a, b) => a - b);
  const canvas = stripManhuaFactoryCanvasArtifacts(input.blocks, input.edges, { onlyEpisodes: changedEpisodeIndexes });
  const affected = Object.fromEntries(Object.entries(input.overlays).filter(([ep]) => changedEpisodeIndexes.includes(Number(ep))));
  const overlays = { ...input.overlays, ...markManhuaDirectorBoardOverlaysForReview(affected) };
  return {...first,writerPack,canvas,overlays,changedEpisodeIndexes,technicalPlanNeedsReview:checked.some(plan => plan.technicalPlanNeedsReview)};
}

import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import { resolveKeyartShotIndex } from "@shared/manhuaScriptWorkbench";
import { readManhuaTimedStoryboard } from "@shared/manhuaTimedStoryboard";
import {
  countManhuaRenderedClipsToArchiveOnResegment,
  ensureManhuaFragmentClips,
  getBlockEpisodeIndex,
} from "./canvasDramaStudio";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";
import { retimeManhuaCanvasNodes, retimeManhuaWriterPack } from "./manhuaShotTimingDraft";

type EnsureOptions = NonNullable<Parameters<typeof ensureManhuaFragmentClips>[3]>;

/**
 * 0929：改镜头时长 / 制作片段切点。
 * 不退回「未确认剧本」——重新确认会把整集带付费产物的节点归档并重铺空链。这里按生成链路同一份编译上下文
 * 就地重排分段：静帧、已出片原地保留；时长或切点变了的段换新节点，旧段音轨留在历史，已听审对白按镜号带回
 * （未采用），配乐与白模不跨段搬运。重排失败时时长照存，把原因交给调用方提示。
 */
export function applyManhuaShotTimingEdit(input: {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  writerPack: ManhuaWriterPack;
  episodeIndex: number;
  shotIndex: number;
  durationSec: number;
  segmentBreakBefore?: boolean;
  /** 与生成链路 runFactory 的 ensureOptions 同字段；分段计划按改后的剧本在这里重读。 */
  ensureOptions: Omit<EnsureOptions, "segmentPlan">;
  /** 有已出片的段会被停放时先问用户；返回 false 则整次不改。 */
  confirmArchive: (renderedClipCount: number) => boolean;
}): { blocks: CanvasBlock[]; edges: CanvasEdge[]; writerPack: ManhuaWriterPack; resegmentError: string } {
  const ep = input.episodeIndex;
  const nodes = input.blocks.filter(b => (getBlockEpisodeIndex(b) ?? 1) === ep && !b.archivedFromPreviousScript && /^(story|beats|reverse)-/.test(b.id));
  const { canonical, apply } = retimeManhuaCanvasNodes(nodes, input.shotIndex, input.durationSec, input.segmentBreakBefore);
  const writerPack = retimeManhuaWriterPack(input.writerPack, ep, input.shotIndex, input.durationSec, canonical, input.segmentBreakBefore);
  const retimed = input.blocks.map(apply);
  const archive = countManhuaRenderedClipsToArchiveOnResegment(retimed, ep, input.ensureOptions.videoModel);
  if (archive > 0 && !input.confirmArchive(archive)) throw new Error("已取消，时长未改。");
  try {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(writerPack.episodes.find(episode => episode.index === ep)?.body || "");
    const ensured = ensureManhuaFragmentClips(retimed, input.edges, ep, { ...input.ensureOptions, segmentPlan: plan.segments.length ? plan : null });
    return { blocks: ensured.blocks, edges: ensured.edges, writerPack, resegmentError: "" };
  } catch (error) {
    return { blocks: retimed, edges: input.edges, writerPack, resegmentError: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 「只恢复确认（不重铺）」的前提：未确认只是因为改了时长/切点，而不是改写了剧情。
 * 有待确认的顾问改写，或本集秒位表里有镜头没有现行静帧节点（剧情从某段起重写后会被清掉），都必须走「确认剧本大纲」重铺。
 */
export function manhuaRestoreConfirmationBlocker(input: {
  blocks: CanvasBlock[];
  writerPack: ManhuaWriterPack | null | undefined;
  episodeIndex: number;
  /** advisorReconfirmationFromEpisode 的结果：非空＝有采用的顾问改写待确认 */
  advisorReconfirmFromEpisode: number | undefined;
}): string {
  if (input.advisorReconfirmFromEpisode != null) return "有已采用的顾问改写尚未确认，不能只恢复确认；请用「确认剧本大纲」。";
  const body = input.writerPack?.episodes.find(episode => episode.index === input.episodeIndex)?.body || "";
  const timed = readManhuaTimedStoryboard(body);
  if (!timed.recognized || !timed.rows.length) return "本集剧本没有完整秒位表，不能只恢复确认；请用「确认剧本大纲」。";
  const live = new Set(input.blocks
    .filter(b => b.id.startsWith("keyart-") && !b.archivedFromPreviousScript && (getBlockEpisodeIndex(b) ?? 1) === input.episodeIndex)
    .map(b => resolveKeyartShotIndex(b.id, b.prompt)));
  const missing = timed.rows.map(row => row.index).filter(index => !live.has(index));
  if (missing.length) return `本集剧本的镜${missing.slice(0, 6).join("、")}没有现行静帧节点（可能改写过剧情），不能只恢复确认；请用「确认剧本大纲」。`;
  return "";
}

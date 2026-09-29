import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
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

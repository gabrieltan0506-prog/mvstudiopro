/**
 * 拉片交接稿 → 自由画布方块（纯函数）。
 * 视频方块用画布默认的「参考生视频」模式（defaultCanvasBlock("video") 即 reference_to_video）：
 * 提示词 = 该段复刻提示词；片段作为上传素材挂进 uploadedAssets（带 gs:// 对象地址）并预先勾选为参考视频——
 * 与画布手动上传素材同一结构，出片前由 canvasAssetResign 按 gcsUri 续签，所以签名过期不影响出片。
 * 配乐提示词放进一个音乐方块（纯器乐），与新建 MV 作品预置音乐方块的写法一致（novelFactoryProject.createEmptyManhuaProject）。
 * 只追加，不改动画布已有方块；不提交任何生成任务。
 */
import { CANVAS_BLOCK_DEFAULT_HEIGHT, CANVAS_BLOCK_DEFAULT_WIDTH, defaultCanvasBlock, makeCanvasBlockId, type CanvasBlock } from "./canvasTypes";
import type { VideoBreakdownCanvasHandoff } from "./videoBreakdownCanvasHandoff";

const GAP = 48;
const MARGIN = 80;

export function buildVideoBreakdownCanvasBlocks(handoff: VideoBreakdownCanvasHandoff, existing: readonly Pick<CanvasBlock, "y" | "height">[]): CanvasBlock[] {
  const top = existing.length ? Math.max(...existing.map(b => (Number(b.y) || 0) + (Number(b.height) || CANVAS_BLOCK_DEFAULT_HEIGHT))) + GAP * 2 : MARGIN;
  const blocks: CanvasBlock[] = handoff.items.map((item, i) => {
    const block = defaultCanvasBlock("video", MARGIN + i * (CANVAS_BLOCK_DEFAULT_WIDTH + GAP), top);
    block.prompt = item.prompt;
    if (item.clip) {
      block.uploadedAssets = [{
        id: makeCanvasBlockId("asset"),
        url: item.clip.url,
        previewUrl: item.clip.url,
        fileName: item.clip.fileName,
        ...(item.clip.gcsUri ? { gcsUri: item.clip.gcsUri } : {}),
        kind: "video",
        mimeType: "video/mp4",
      }];
      block.seedance25RefVideoUrls = [item.clip.url];
    }
    return block;
  });
  if (handoff.bgmPrompt) {
    const music = defaultCanvasBlock("music", MARGIN, top + CANVAS_BLOCK_DEFAULT_HEIGHT + GAP);
    music.prompt = handoff.bgmPrompt;
    music.musicMv = { status: "idle", candidates: [], instrumental: true, deliveryMode: "song" };
    blocks.push(music);
  }
  return blocks;
}

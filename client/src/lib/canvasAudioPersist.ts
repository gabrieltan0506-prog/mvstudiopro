import type { CanvasBlock } from "./canvasTypes";

/** 同帧母轨回写和声音结算必须从同一份已保存状态继续，不能覆盖彼此。 */
export function persistCanvasAudioBlock(
  blocksRef: { current: CanvasBlock[] },
  blockId: string,
  patch: (block: CanvasBlock) => CanvasBlock,
  save: (blocks: CanvasBlock[]) => boolean,
  publish: (blocks: CanvasBlock[]) => void,
): boolean {
  const current = blocksRef.current;
  const target = current.find(block => block.id === blockId);
  if (!target || target.status === "running" || target.videoTaskStatus === "queued") return false;
  const next = current.map(block => block === target ? patch(block) : block);
  if (!save(next)) return false;
  blocksRef.current = next;
  publish(next);
  return true;
}

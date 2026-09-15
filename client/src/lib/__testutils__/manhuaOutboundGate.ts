/**
 * 测试用：**按用户真实动作**取得一段的生成前确认。
 *
 * 刻意放在 __testutils__ 而不是产品代码里。产品里如果存在这样一个
 * 「替我确认一下」的函数，等于给闸开了后门——审查明确要求不得编造指纹让旧测试过。
 * 这里做的事和用户在工作台点「查看实际发送内容」再点「确认」完全一样：
 * 走共用工厂准备 → 走生产路径预览 → 用同一个指纹算法算出确认记录。
 */
import {
  manhuaOutboundConfirmationFingerprint,
  previewCanvasBlockOutbound,
  type CanvasOutboundConfirmationScope,
  type CanvasRunDeps,
  type ManhuaOutboundConfirmation,
  type ManhuaOutboundGate,
} from "../canvasRunBlock";
import { prepareManhuaFactoryClipInput } from "../canvasDramaStudio";
import type { CanvasBlock, CanvasEdge } from "../canvasTypes";

export const TEST_OUTBOUND_SCOPE_BASE = {
  userId: "test-user",
  workspaceId: "manhua-cloud-draft:test-user",
  projectVersion: "测试剧@2026-09-14T00:00:00.000Z",
  epoch: 1,
} as const;

export function testOutboundScope(blockId: string): CanvasOutboundConfirmationScope {
  return { ...TEST_OUTBOUND_SCOPE_BASE, blockId };
}

/** 对单段走一次真实预览并确认，返回可直接喂给 resolveOutboundGate 的记录 */
export async function confirmClipLikeUser(input: {
  deps: CanvasRunDeps;
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  blockId: string;
  episodeIndex?: number;
  pilotRun?: boolean;
}): Promise<ManhuaOutboundConfirmation> {
  const fallbackBlock = input.blocks.find((b) => b.id === input.blockId);
  if (!fallbackBlock) throw new Error(`夹具里没有这个节点：${input.blockId}`);
  const { preparedBlock, upstream } = await prepareManhuaFactoryClipInput({
    blocks: input.blocks,
    edges: input.edges,
    blockId: input.blockId,
    fallbackBlock,
    stage: "clip",
    episodeIndex: input.episodeIndex ?? 1,
    preparedVideoEdit: false,
  });
  const preview = await previewCanvasBlockOutbound(input.deps, preparedBlock, upstream, {
    pilotRun: input.pilotRun === true,
  });
  const scope = testOutboundScope(input.blockId);
  return {
    fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
    scope,
    confirmedAt: Date.now(),
  };
}

/** 把已取得的确认装配成 resolveOutboundGate */
export function gateFromConfirmations(
  confirmations: Record<string, ManhuaOutboundConfirmation>,
): (blockId: string) => ManhuaOutboundGate {
  return (blockId: string) => ({
    currentScope: testOutboundScope(blockId),
    confirmation: confirmations[blockId],
  });
}

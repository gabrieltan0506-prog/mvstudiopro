import {
  resolveSeedance25Access,
  type Seedance25AccessInput,
  type Seedance25AccessResult,
} from "@shared/seedance25Access";
import {
  isCanvasSeedance25VideoModel,
  VIDEO_MODEL_OPTIONS,
  type CanvasBlock,
  type CanvasVideoModel,
} from "./canvasTypes";

/**
 * 画布前端 Seedance 2.5 闸门：与服务端 `api/jobs.ts` 的 `assertSeedance25PaidAccess`
 * 同一套 `resolveSeedance25Access`（到点 + 会员 + 内部角色三件事一起判），避免前端能选、
 * 服务端 403 的不同步。调用方必须把会随时间推进 / 登录态刷新而变化的 `now` 与 `role`
 * 传进来，不要把结果当模块级常量或只在 mount 时算一次——否则用户挂着页面跨过上线时刻
 * 或订阅状态变化后仍看不到/看得到不该看到的入口。
 */
export function resolveCanvasSeedance25Gate(
  input: Seedance25AccessInput,
): Seedance25AccessResult {
  return resolveSeedance25Access(input);
}

/** 无权限时从模型下拉里过滤掉 seedance-2.5 */
export function filterCanvasVideoModelOptions(
  allowed: boolean,
  options: Array<{ id: CanvasVideoModel; label: string }> = VIDEO_MODEL_OPTIONS,
): Array<{ id: CanvasVideoModel; label: string }> {
  return allowed ? options : options.filter((m) => !isCanvasSeedance25VideoModel(m.id));
}

/**
 * 草稿里若残留加长档但当前无权限，降回快速档。
 * 已允许或队列里没有残留时返回 null（无需更新，调用方可跳过 setState）。
 */
export function downgradeUnauthorizedSeedance25Blocks(
  blocks: CanvasBlock[],
  allowed: boolean,
): CanvasBlock[] | null {
  if (allowed) return null;
  if (!blocks.some((b) => isCanvasSeedance25VideoModel(b.videoModel))) return null;
  return blocks.map((b) =>
    isCanvasSeedance25VideoModel(b.videoModel) ? { ...b, videoModel: "seedance-2.0-fast" } : b,
  );
}

/**
 * 一个镜头的静帧状态：**列表卡与当前镜面板共用同一处判断**（纯函数）。
 *
 * 为什么要抽出来：列表卡的 `data-manhua-keyart-status` 原先是内联三元套三元算出来的，
 * 当前镜面板要显示同一件事，如果各算一份，两处很快就会不一致 ——
 * 这正是「资产已齐 vs 4 张未认领」那类冲突的成因（同一件事两处判据）。
 *
 * 口径与线上一致：有图但没过垫图锁 = **不能出片**（不是「已就绪」），
 * 这条是 0917 事故之后写死的判据，这里只搬不改。
 */
export type ManhuaShotKeyartState = "idle" | "running" | "error" | "unlocked" | "stale" | "ready";

export const MANHUA_SHOT_KEYART_STATE_ZH: Record<ManhuaShotKeyartState, string> = {
  idle: "待出分镜图",
  running: "出图中…",
  error: "出图失败，可单镜重出",
  unlocked: "有图但没垫图锁，不能出片",
  stale: "原稿或造型已变更，需重出本镜",
  ready: "已锁图，可出片",
};

export function manhuaShotKeyartState(input: {
  hasImage: boolean;
  failed: boolean;
  running: boolean;
  /** 过了垫图改图锁（无图时无意义） */
  pixelLocked: boolean;
  /** 已有成图是否仍匹配当前原稿与造型；未传时沿用旧调用约定。 */
  sourceCurrent?: boolean;
}): ManhuaShotKeyartState {
  if (input.hasImage && input.sourceCurrent === false) return "stale";
  if (input.hasImage) return input.pixelLocked ? "ready" : "unlocked";
  if (input.failed) return "error";
  if (input.running) return "running";
  return "idle";
}

export function manhuaShotKeyartStateZh(input: Parameters<typeof manhuaShotKeyartState>[0]): string {
  return MANHUA_SHOT_KEYART_STATE_ZH[manhuaShotKeyartState(input)];
}

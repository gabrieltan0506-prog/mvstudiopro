/**
 * 漫剧 · 图库无人物空镜：抽屉回传裁点 → 登记前的确认数据（素材检索 UX 第二期，2026-11-08）。
 * 裁点由 StockFootageDrawer 的拖柄给出，不再手填；这里只做登记前的本地夹取与提示，
 * 真正落档仍由父组件走 validateManhuaStockEmptyShot（含「画面中没有人物」确认与段长容差）。
 */
import { MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC, clampManhuaStockEmptyShotTrim } from "@shared/manhuaStockFootage";
import type { StockFootageAssetView } from "@shared/stockFootage";

export type ManhuaEmptyShotDraftTrim = {
  inSec: number;
  outSec: number;
  /** 裁后时长 */
  spanSec: number;
  /** 素材真实时长 */
  sourceDurationSec: number;
  /** 裁后与本段规划时长相差超过登记容差（父组件会拒收），界面提前标黄 */
  offPlan: boolean;
};

/** 反向：非漫剧空镜用法、照片、无时长都直接抛错，不进入确认步骤。 */
export function manhuaEmptyShotTrimFromPick(
  pick: { asset: Pick<StockFootageAssetView, "purpose" | "usage" | "kind" | "durationSec">; inSec: number; outSec: number },
  plannedDurationSec: number,
): ManhuaEmptyShotDraftTrim {
  const { asset } = pick;
  if (asset.purpose !== "manhua" || asset.usage !== "empty_shot") throw new Error("只有按「漫剧空镜」采用的图库视频才能登记为空镜");
  if (asset.kind !== "video") throw new Error("空镜只收视频素材");
  const dur = Number(asset.durationSec);
  if (!Number.isFinite(dur) || dur < 0.5) throw new Error("空镜素材缺少可用时长");
  const trim = clampManhuaStockEmptyShotTrim(dur, pick.inSec, pick.outSec);
  const spanSec = Math.round((trim.outSec - trim.inSec) * 100) / 100;
  const planned = Number(plannedDurationSec);
  return {
    ...trim,
    spanSec,
    sourceDurationSec: dur,
    offPlan: Number.isFinite(planned) && planned > 0 && Math.abs(spanSec - planned) > MANHUA_STOCK_EMPTY_SHOT_TOLERANCE_SEC,
  };
}

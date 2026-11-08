import { isStockAssetInsertable, stockAttributionText, type StockFootageAsset, type StockFootagePurpose, type StockFootageUsage } from "../../shared/stockFootage";
import { assertDigitalHumanOverlays, digitalHumanOverlayFilter, type DigitalHumanOverlay } from "../../shared/digitalHumanOverlay";

export type ResolvedDigitalHumanOverlay = DigitalHumanOverlay & { asset: StockFootageAsset };
type LoadOwnedExpect = { purpose?: StockFootagePurpose; usages?: readonly StockFootageUsage[]; kind?: "video" | "photo" };
type LoadOwned = (userId: number, assetId: string, expect?: LoadOwnedExpect) => Promise<StockFootageAsset>;
/** 覆盖轨对 loadOwnedStockAsset 的期望：数字人用途、可直接入片（kind 不限，照片/视频都可覆盖）。 */
export const DIGITAL_HUMAN_OVERLAY_STOCK_EXPECT = { purpose: "digital_human", usages: ["insert"] } as const satisfies LoadOwnedExpect;

/**
 * 逐个 assetId 走 loadOwnedStockAsset 核对所有权与采用状态，并以它返回的 gcsUri/durationSec/kind 为准；
 * 客户端草稿里的类型、时长、地址一律不作依据。只接受数字人用途、可入片的素材。
 */
export async function resolveDigitalHumanOverlays(
  userId: number,
  overlays: ReadonlyArray<DigitalHumanOverlay>,
  totalSec: number,
  loadOwned?: LoadOwned,
): Promise<ResolvedDigitalHumanOverlay[]> {
  if (!overlays.length) return [];
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("需要有效登录账号");
  const load: LoadOwned = loadOwned ?? (await import("./stockFootage/ownership")).loadOwnedStockAsset;
  const assets = new Map<string, StockFootageAsset>();
  for (const id of Array.from(new Set(overlays.map(o => o.assetId)))) {
    const asset = await load(userId, id, DIGITAL_HUMAN_OVERLAY_STOCK_EXPECT);
    if (asset.assetId !== id) throw new Error("补充画面素材身份不一致");
    if (asset.purpose !== "digital_human" || !isStockAssetInsertable(asset) || asset.usage !== "insert")
      throw new Error("该素材不是为数字人补充画面采用的可入片素材，请在数字人素材面板重新采用");
    assets.set(id, asset);
  }
  assertDigitalHumanOverlays(overlays, totalSec, id => {
    const a = assets.get(id);
    return a && { kind: a.kind, durationSec: a.durationSec };
  });
  return overlays.map(o => ({ ...o, asset: assets.get(o.assetId)! }));
}

export function digitalHumanOverlayCredits(rows: ReadonlyArray<ResolvedDigitalHumanOverlay>) {
  return rows.map(r => ({
    assetId: r.assetId, startSec: r.startSec, durationSec: r.durationSec, sourceInSec: r.sourceInSec, mode: r.mode,
    ...(r.returnNote ? { returnNote: r.returnNote } : {}),
    kind: r.asset.kind, attribution: stockAttributionText(r.asset.source), pageUrl: r.asset.source.pageUrl, license: r.asset.source.license.name,
  }));
}

/** 覆盖素材下载后的本地文件扩展名：照片按 MIME 给扩展名（image2 解复用器按扩展名识别），视频统一 mp4。 */
export function digitalHumanOverlayFileExt(asset: Pick<StockFootageAsset, "kind" | "mimeType">): string {
  if (asset.kind !== "photo") return "mp4";
  return ({ "image/png": "png", "image/webp": "webp" } as Record<string, string>)[asset.mimeType] ?? "jpg";
}

/**
 * 叠加画面的 ffmpeg 参数（纯函数）：输入0为口播母轨画面，其余为覆盖素材——
 * 照片 -loop 1 固定展示 durationSec；视频 -ss sourceInSec -t durationSec 取段。
 * 只映射叠加后的视频流 [vout] 并 -an：素材自带声音一律不进成片，口播母轨在之后的混音步骤单独接入。
 */
export function digitalHumanOverlayFfmpegArgs(opts: {
  picture: string;
  inputs: ReadonlyArray<{ path: string; kind: "video" | "photo"; startSec: number; durationSec: number; sourceInSec: number }>;
  width: number;
  height: number;
  target: string;
}): string[] {
  const args = ["-y", "-i", opts.picture];
  for (const o of opts.inputs) {
    if (o.kind === "photo") args.push("-f", "image2", "-loop", "1", "-framerate", "30", "-t", o.durationSec.toFixed(3), "-i", o.path);
    else args.push("-ss", o.sourceInSec.toFixed(3), "-t", o.durationSec.toFixed(3), "-i", o.path);
  }
  args.push("-filter_complex", digitalHumanOverlayFilter(opts.inputs, opts.width, opts.height), "-map", "[vout]", "-an", "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", opts.target);
  return args;
}

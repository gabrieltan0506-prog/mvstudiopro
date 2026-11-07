/**
 * 下游消费者（MV / 数字人 / 营销 / 漫剧）统一用 assetId 核对素材归属。
 * 客户端回传的 URL 不作所有权证据；以采用回执里的 gcsUri / 尺寸 / 时长 / 用法为准。
 */
import { stockFootageAssetSchema, type StockFootageAsset, type StockFootagePurpose, type StockFootageUsage } from "../../../shared/stockFootage";
import { StockFootageError } from "./pexelsClient";
import type { StockAdoptionDeps, StockAdoptionOutput } from "./adoption";

type LoadDeps = Pick<StockAdoptionDeps, "load">;

async function defaultDeps(): Promise<LoadDeps> {
  // 延迟导入，避免纯校验调用方（测试）牵出数据库模块。
  const mod = await import("./adoption");
  return { load: mod.stockAdoptionLoader };
}

export async function loadOwnedStockAsset(
  userId: number,
  assetId: string,
  expect: { purpose?: StockFootagePurpose; usages?: readonly StockFootageUsage[]; kind?: "video" | "photo" } = {},
  deps?: LoadDeps
): Promise<StockFootageAsset> {
  if (!/^sf_[0-9a-f]{48}$/.test(assetId)) throw new StockFootageError("invalid", "素材编号无效");
  const row = await (deps ?? (await defaultDeps())).load(assetId, userId);
  const parsed = stockFootageAssetSchema.safeParse((row?.output as StockAdoptionOutput | null)?.asset);
  if (!row || row.status !== "succeeded" || !parsed.success || parsed.data.assetId !== assetId)
    throw new StockFootageError("not_found", "素材未采用完成或不属于当前账号");
  const asset = parsed.data;
  if (expect.purpose && asset.purpose !== expect.purpose) throw new StockFootageError("invalid", "该素材不是为当前业务采用的");
  if (expect.usages && !expect.usages.includes(asset.usage)) throw new StockFootageError("invalid", "该素材的采用方式不适用于此处");
  if (expect.kind && asset.kind !== expect.kind) throw new StockFootageError("invalid", expect.kind === "video" ? "此处需要视频素材" : "此处需要图片素材");
  return asset;
}

/** 批量核对（去重后逐个加载），返回 assetId → 资产。 */
export async function loadOwnedStockAssets(
  userId: number,
  assetIds: readonly string[],
  expect: Parameters<typeof loadOwnedStockAsset>[2] = {},
  deps?: LoadDeps
): Promise<Map<string, StockFootageAsset>> {
  const out = new Map<string, StockFootageAsset>();
  for (const id of Array.from(new Set(assetIds))) out.set(id, await loadOwnedStockAsset(userId, id, expect, deps));
  return out;
}

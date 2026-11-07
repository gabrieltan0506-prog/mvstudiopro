/**
 * 漫剧 · 图库素材消费端合法化（2026-11-08）。
 *
 * - 生成参考（canvasVideoTask 提交前重签）：stock-footage/<uid>/sf_….* 对象只有
 *   「本人、为漫剧采用、usage=reference 的照片」才放行；空镜、MV/营销素材一律拒绝，
 *   保证图库图只当场景参考，不进人物/角色链，也不被当成生成原片。
 * - 合成导出（manhua_assemble_final worker）：段成片若声明 stockAssetId，按 assetId 核对
 *   「本人、漫剧、empty_shot、视频」，裁点不越过素材时长，读链改由服务端按 gcsUri 现签；
 *   未声明却指向 stock-footage/ 对象的段成片一律拒绝（参考图不能偷渡入片）。
 * 客户端 URL 从不作所有权证据，一律以 loadOwnedStockAsset 回执的 gcsUri 为准。
 */
import type { StockFootageAsset } from "../../shared/stockFootage";
import { gsIdentityOfUrl } from "../../shared/manhuaStockFootage";

export const MANHUA_STOCK_OBJECT_RE = /^stock-footage\/(\d+)\/(sf_[0-9a-f]{48})\.[a-z0-9]{2,5}$/;

export type ManhuaStockLoad = (
  userId: number,
  assetId: string,
  expect: { purpose?: "manhua"; usages?: readonly ("reference" | "empty_shot")[]; kind?: "video" | "photo" },
) => Promise<StockFootageAsset>;

export type ManhuaStockGuardDeps = {
  load: ManhuaStockLoad;
  bucket: () => string;
  sign: (gcsUri: string, seconds: number) => string;
};

async function defaultDeps(): Promise<ManhuaStockGuardDeps> {
  const [{ loadOwnedStockAsset }, gcs] = await Promise.all([
    import("./stockFootage/ownership.js"),
    import("./gcs.js"),
  ]);
  return {
    load: (userId, assetId, expect) => loadOwnedStockAsset(userId, assetId, expect),
    bucket: () => gcs.getGcsBucketName(),
    sign: (gcsUri, seconds) => gcs.signGsUriV4ReadUrl(gcsUri, seconds),
  };
}

/** 对象路径是不是图库素材；是则返回其 assetId 与路径里的 uid。 */
export function parseManhuaStockObjectPath(objectPath: string): { ownerUserId: number; assetId: string } | null {
  const m = MANHUA_STOCK_OBJECT_RE.exec(String(objectPath || ""));
  return m ? { ownerUserId: Number(m[1]), assetId: m[2]! } : null;
}

/**
 * 生成参考放行判定：非图库路径返回 false（交回原有规则）；图库路径要么放行（true），要么抛错。
 */
export async function assertManhuaStockReferenceObject(
  userId: number,
  objectPath: string,
  deps?: ManhuaStockGuardDeps,
): Promise<boolean> {
  const parsed = parseManhuaStockObjectPath(objectPath);
  if (!parsed) return false;
  if (parsed.ownerUserId !== Number(userId)) throw new Error("图库参考图不属于当前账号,已拒绝提交");
  const d = deps ?? (await defaultDeps());
  let asset: StockFootageAsset;
  try {
    asset = await d.load(Number(userId), parsed.assetId, { purpose: "manhua", usages: ["reference"], kind: "photo" });
  } catch {
    throw new Error("图库素材只能作场景参考图(本人为漫剧采用的图片),空镜或其他用途素材不能当生成参考");
  }
  if (asset.gcsUri !== `gs://${d.bucket()}/${objectPath}`) throw new Error("图库参考图身份不一致,已拒绝提交");
  return true;
}

type AssembleClipRaw = Record<string, unknown> & {
  clipUrl?: unknown;
  url?: unknown;
  stockAssetId?: unknown;
  trimInSec?: unknown;
  trimOutSec?: unknown;
  shotPieces?: unknown;
};

function storageObjectOf(url: string, bucket: string): string | undefined {
  const raw = String(url || "").trim();
  const gs = raw.startsWith("gs://") ? raw : gsIdentityOfUrl(raw);
  if (!gs) return undefined;
  const prefix = `gs://${bucket}/`;
  return gs.startsWith(prefix) ? gs.slice(prefix.length) : undefined;
}

/**
 * 合成前处理段成片里的图库空镜：核对归属/用法/时长，换成服务端现签读链；返回新数组（不改入参）。
 */
export async function resolveManhuaAssembleStockClips<T extends AssembleClipRaw>(
  clips: readonly T[],
  userId: number | undefined,
  deps?: ManhuaStockGuardDeps,
): Promise<T[]> {
  const needs = clips.some((clip) => clip?.stockAssetId != null || String(clip?.clipUrl || clip?.url || "").includes("stock-footage"));
  if (!needs) return clips.map((clip) => {
    if (clip && "stockAssetId" in clip) {
      const { stockAssetId: _drop, ...rest } = clip;
      return rest as T;
    }
    return clip;
  });
  const d = deps ?? (await defaultDeps());
  const bucket = d.bucket();
  const out: T[] = [];
  for (const clip of clips) {
    const url = String(clip?.clipUrl || clip?.url || "").trim();
    const objectPath = url ? storageObjectOf(url, bucket) : undefined;
    const stockAssetId = clip?.stockAssetId == null ? "" : String(clip.stockAssetId).trim();
    const pathIsStock = Boolean(objectPath && parseManhuaStockObjectPath(objectPath));
    if (!stockAssetId) {
      if (pathIsStock || /\/stock-footage\//.test(url)) {
        throw Object.assign(new Error("图库素材只能以「空镜·无人物」登记后入片,场景参考图不能直接入片"), { code: "manhua_assemble_stock_not_allowed" });
      }
      out.push(clip);
      continue;
    }
    const uid = Number(userId);
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("图库空镜暂时无法核对归属,未开始合成");
    let asset: StockFootageAsset;
    try {
      asset = await d.load(uid, stockAssetId, { purpose: "manhua", usages: ["empty_shot"], kind: "video" });
    } catch {
      throw Object.assign(new Error("图库空镜未采用完成、不属于当前账号或不是空镜用法,未开始合成"), { code: "manhua_assemble_stock_not_allowed" });
    }
    const assetObject = storageObjectOf(asset.gcsUri, bucket);
    if (!assetObject || (objectPath && objectPath !== assetObject)) {
      throw Object.assign(new Error("图库空镜与段成片不是同一素材,未开始合成"), { code: "manhua_assemble_stock_mismatch" });
    }
    const dur = Number(asset.durationSec);
    if (!Number.isFinite(dur) || dur < 0.5) throw new Error("图库空镜缺少时长,未开始合成");
    const within = (a: unknown, b: unknown) =>
      typeof a === "number" && typeof b === "number" && a >= 0 && b <= dur + 0.05 && b - a >= 0.5 - 0.001;
    if (clip.trimInSec === undefined && clip.trimOutSec === undefined) {
      throw Object.assign(new Error("图库空镜缺少裁点,请在剪辑台重新登记"), { code: "manhua_assemble_invalid_trim" });
    }
    if (!within(clip.trimInSec, clip.trimOutSec)) {
      throw Object.assign(new Error(`图库空镜裁点越过素材时长(${dur.toFixed(1)} 秒),请重新确认`), { code: "manhua_assemble_invalid_trim" });
    }
    if (Array.isArray(clip.shotPieces)) {
      for (const piece of clip.shotPieces as Array<Record<string, unknown>>) {
        if (!within(piece?.trimInSec, piece?.trimOutSec)) {
          throw Object.assign(new Error(`图库空镜镜片裁点越过素材时长(${dur.toFixed(1)} 秒),请重新确认`), { code: "manhua_assemble_invalid_trim" });
        }
      }
    }
    const { stockAssetId: _drop, url: _legacy, ...rest } = clip;
    out.push({ ...rest, clipUrl: d.sign(asset.gcsUri, 3600) } as unknown as T);
  }
  return out;
}

/**
 * 2×2 四视角拼板裁成四张单图。
 *
 * 跨集场景走「同一地点四机位」拼板，但整张拼板不能直接当垫图喂视频引擎：
 * 官方把多视角合成一张列为参考混用，模型会把四格当四个不同地点/主体。
 * 拼板本身仍有价值（一次出图省 4× 积分、人看着也直观），所以出图照旧，
 * 发引擎前先在这里切开，段内只喂需要的那一个机位。
 */
import sharp from "sharp";
import { downloadGcsObject, getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs.js";

/** 与 buildManhuaSceneFourViewGridPrompt 的四格顺序一致 */
export const MANHUA_SHEET_GRID_VIEWS = [
  { slot: "topLeft", labelZh: "主视角" },
  { slot: "topRight", labelZh: "正面聚焦" },
  { slot: "bottomLeft", labelZh: "高俯斜角" },
  { slot: "bottomRight", labelZh: "正俯" },
] as const;

export type ManhuaSheetGridSlot = (typeof MANHUA_SHEET_GRID_VIEWS)[number]["slot"];

export type ManhuaSheetGridTile = {
  slot: ManhuaSheetGridSlot;
  labelZh: string;
  buffer: Buffer;
};

/**
 * 均分为四格并各自导出 PNG。
 *
 * 奇数边长时右/下两格吃掉余下的那一像素，避免因为向下取整在接缝处漏一条。
 */
export async function cropSheet2x2ToTiles(input: Buffer): Promise<ManhuaSheetGridTile[]> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const width = Math.floor(Number(meta.width || 0));
  const height = Math.floor(Number(meta.height || 0));
  if (width < 2 || height < 2) {
    throw new Error("sheet_too_small");
  }
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  const boxes: Record<ManhuaSheetGridSlot, { left: number; top: number; width: number; height: number }> = {
    topLeft: { left: 0, top: 0, width: halfW, height: halfH },
    topRight: { left: halfW, top: 0, width: width - halfW, height: halfH },
    bottomLeft: { left: 0, top: halfH, width: halfW, height: height - halfH },
    bottomRight: { left: halfW, top: halfH, width: width - halfW, height: height - halfH },
  };
  const out: ManhuaSheetGridTile[] = [];
  for (const view of MANHUA_SHEET_GRID_VIEWS) {
    const buffer = await sharp(input, { failOn: "none" })
      .extract(boxes[view.slot])
      .png()
      .toBuffer();
    out.push({ slot: view.slot, labelZh: view.labelZh, buffer });
  }
  return out;
}

export type ManhuaSheetGridCropResult = {
  slot: ManhuaSheetGridSlot;
  labelZh: string;
  url: string;
  gcsUri: string;
  bytes: number;
};

import { registerCanvasMediaOwner, readCanvasMediaOwner, verifyCanvasMediaOwnership, type OwnerStore } from "./canvasMediaOwnership.js";

/** Only our bucket is accepted; never fetch an arbitrary client URL. */
export function sheetObjectPath(url: string, bucket = getGcsBucketName()): string {
  let path = "";
  if (url.startsWith("/api/canvas-media/")) path = decodeURIComponent(url.slice("/api/canvas-media/".length).split("?")[0]);
  else if (url.startsWith(`gs://${bucket}/`)) path = url.slice(`gs://${bucket}/`.length);
  else {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && ["www.mvstudiopro.com", "mvstudiopro.com", "api.mvstudiopro.com"].includes(parsed.hostname) && parsed.pathname.startsWith("/api/canvas-media/"))
      path = decodeURIComponent(parsed.pathname.slice("/api/canvas-media/".length));
    else {
      if (parsed.protocol !== "https:" || parsed.hostname !== "storage.googleapis.com" ||
          !parsed.pathname.startsWith(`/${bucket}/`)) throw new Error("sheet_source_invalid");
      path = decodeURIComponent(parsed.pathname.slice(bucket.length + 2));
    }
  }
  if (!/^(?:generated|manhua-(?:scene|sheet)-tiles)\/[A-Za-z0-9_/.\-]+$/.test(path) || path.includes(".."))
    throw new Error("sheet_source_invalid");
  return path;
}

/** 取远端拼板 → 切四格 → 各自落 GCS，返回可直接当垫图的签名地址 */
export async function cropManhuaSheet2x2ToGcs(input: {
  sheetUrl: string;
  userId: number;
  existingTiles?: Partial<Record<ManhuaSheetGridSlot, string>>;
  store?: OwnerStore;
  /** 落地对象名前缀，便于按项目/资产归档 */
  objectPrefix?: string;
}): Promise<ManhuaSheetGridCropResult[]> {
  const sourcePath = sheetObjectPath(String(input.sheetUrl || "").trim());
  if (!sourcePath.startsWith("generated/") || !(await verifyCanvasMediaOwnership(input.userId, sourcePath, { store: input.store, skipCache: true })))
    throw new Error("sheet_owner_forbidden");
  const { buffer: sheet } = await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${sourcePath}` });
  const tiles = await cropSheet2x2ToTiles(sheet);
  const prefix =
    String(input.objectPrefix || "").trim().replace(/[^\w/-]/g, "").replace(/^\/+|\/+$/g, "") ||
    `manhua-sheet-tiles/user-${input.userId}`;
  if (!/^manhua-(?:scene|sheet)-tiles\/[A-Za-z0-9_/-]+$/.test(prefix) || prefix.includes("..")) throw new Error("sheet_prefix_invalid");
  // Validate every legacy object before the first registration. Client claims alone are never evidence.
  const existing = new Map<ManhuaSheetGridSlot, string>();
  if (input.existingTiles) {
    for (const tile of tiles) {
      const url = input.existingTiles[tile.slot];
      if (!url) continue;
      const objectPath = sheetObjectPath(url);
      if (!new RegExp(`^manhua-(?:scene|sheet)-tiles/[A-Za-z0-9_/-]+/[0-9]+-${tile.slot}\\.png$`).test(objectPath))
        throw new Error("sheet_tile_invalid");
      const { buffer } = await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectPath}` });
      const expected = await sharp(tile.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const actual = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (expected.info.width !== actual.info.width || expected.info.height !== actual.info.height || !expected.data.equals(actual.data))
        throw new Error("sheet_tile_source_mismatch");
      const owner = await readCanvasMediaOwner({ objectPath, store: input.store });
      if (owner && Number(owner.ownerUserId) !== input.userId) throw new Error("sheet_owner_conflict");
      existing.set(tile.slot, objectPath);
    }
    if (!existing.size) throw new Error("sheet_tiles_empty");
  }
  const stamp = Date.now();
  const out: ManhuaSheetGridCropResult[] = [];
  for (const tile of tiles) {
    if (input.existingTiles && !existing.has(tile.slot)) continue;
    const objectName = existing.get(tile.slot) || `${prefix}/${stamp}-${tile.slot}.png`;
    const gcsUri = `gs://${getGcsBucketName()}/${objectName}`;
    if (!existing.has(tile.slot)) {
      const upload = await uploadBufferToGcsIfAbsent({ objectName, buffer: tile.buffer,
        contentType: "image/png", metadata: { ownerUserId: String(input.userId), sourceObject: sourcePath, slot: tile.slot } });
      if (!upload.created) throw new Error("sheet_object_collision");
    }
    const outcome = await registerCanvasMediaOwner({ objectPath: objectName, ownerUserId: input.userId,
      source: `sheet:${sourcePath}`, store: input.store });
    if (outcome !== "created" && outcome !== "alreadyOwned") throw new Error(`sheet_owner_${outcome}`);
    out.push({
      slot: tile.slot,
      labelZh: tile.labelZh,
      url: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
      gcsUri,
      bytes: tile.buffer.byteLength,
    });
  }
  return out;
}

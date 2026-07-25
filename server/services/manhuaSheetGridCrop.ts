/**
 * 2×2 四视角拼板裁成四张单图。
 *
 * 跨集场景走「同一地点四机位」拼板，但整张拼板不能直接当垫图喂视频引擎：
 * 官方把多视角合成一张列为参考混用，模型会把四格当四个不同地点/主体。
 * 拼板本身仍有价值（一次出图省 4× 积分、人看着也直观），所以出图照旧，
 * 发引擎前先在这里切开，段内只喂需要的那一个机位。
 */
import sharp from "sharp";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";

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

/** 取远端拼板 → 切四格 → 各自落 GCS，返回可直接当垫图的签名地址 */
export async function cropManhuaSheet2x2ToGcs(input: {
  sheetUrl: string;
  /** 落地对象名前缀，便于按项目/资产归档 */
  objectPrefix?: string;
}): Promise<ManhuaSheetGridCropResult[]> {
  const url = String(input.sheetUrl || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error("sheet_url_invalid");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sheet_download_failed_${res.status}`);
  const sheet = Buffer.from(await res.arrayBuffer());
  const tiles = await cropSheet2x2ToTiles(sheet);
  const prefix =
    String(input.objectPrefix || "").trim().replace(/[^\w/-]/g, "").replace(/^\/+|\/+$/g, "") ||
    "manhua-sheet-tiles";
  const stamp = Date.now();
  const out: ManhuaSheetGridCropResult[] = [];
  for (const tile of tiles) {
    const objectName = `${prefix}/${stamp}-${tile.slot}.png`;
    const { gcsUri } = await uploadBufferToGcs({
      objectName,
      buffer: tile.buffer,
      contentType: "image/png",
    });
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

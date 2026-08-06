/**
 * 道具拼板切图：sharp 纯数学裁切（零出图成本）+ 一次视觉读图拿格内小标题
 * （结果按图片 SHA256 存 GCS JSON，同一张拼板永不重复读）+ 单件图各自落 GCS。
 *
 * 子槽机制（`manhuaSheetPropSubTags.ts`）解决的是编号与跨集一致性，不解决视觉
 * 隔离——它的 path 缺省是整张定妆卡 URL，模型得靠文字猜哪个格子是 @道具N。
 * 这里切出来的单件图通过 `propImageUrlById` 接进子槽的 path，才是真正让
 * @道具N 锁得住的那一步。
 */
import crypto from "node:crypto";
import sharp from "sharp";
import { computePropSheetGridBoxes, type PropSheetGridBox } from "../../shared/manhuaPropSheetGrid.js";
import { downloadGcsObject, uploadBufferToGcs, signGsUriV4ReadUrl, getGcsBucketName } from "./gcs.js";
import { runCanvasTerraVisionMarkdown } from "./canvasTerraMultimodal.js";
import { EVOLINK_CHAT_MODEL_GPT56_TERRA } from "./evolinkChatModel.js";

export const MANHUA_PROP_SHEET_SPLIT_CAPACITY_MESSAGE = "算力紧张，请稍后再试";

const TITLE_CACHE_OBJECT_PREFIX = "manhua/prop-sheet-titles";
const SINGLE_IMAGE_OBJECT_PREFIX = "manhua/prop-single";

export type ManhuaPropSheetTitleItem = {
  /** 分隔符「｜」前半段：道具名 */
  name: string;
  /** 分隔符「｜」后半段：备注（可为空） */
  note: string;
};

export type ManhuaPropSheetTitleCacheDoc = {
  sha256: string;
  gridCols: number;
  gridRows: number;
  /** 按「从左到右、从上到下」的网格顺序，长度 = cols × rows */
  titles: ManhuaPropSheetTitleItem[];
  model: string;
  createdAt: string;
};

export function sha256HexOfBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function titleCacheObjectName(sha256: string): string {
  return `${TITLE_CACHE_OBJECT_PREFIX}/${sha256}.json`;
}

/** 拆「灰札｜仅存"弃城"二字」这类标题：｜前是名字，后是备注。 */
export function parsePropSheetTitleLine(line: string): ManhuaPropSheetTitleItem {
  const raw = String(line || "").trim();
  const sepIdx = raw.indexOf("｜");
  if (sepIdx < 0) return { name: raw, note: "" };
  return {
    name: raw.slice(0, sepIdx).trim(),
    note: raw.slice(sepIdx + 1).trim(),
  };
}

/**
 * 从视觉模型返回的 Markdown 里按行取前 cellCount 条非空行，解析成标题。
 * 模型可能带编号前缀（"1. 残玉" / "① 残玉" / "- 残玉"），一并剥掉。
 */
export function parsePropSheetTitlesFromMarkdown(
  markdown: string,
  cellCount: number,
): ManhuaPropSheetTitleItem[] {
  const lines = String(markdown || "")
    .split("\n")
    .map((l) => l.replace(/^[\s>]*(?:[*-]\s*|\d+[.、)]\s*|[①-⑳]\s*)+/, "").trim())
    .filter(Boolean);
  return lines.slice(0, cellCount).map(parsePropSheetTitleLine);
}

function numberedFallbackTitles(cellCount: number): ManhuaPropSheetTitleItem[] {
  return Array.from({ length: cellCount }, (_, i) => ({
    name: `道具${String(i + 1).padStart(2, "0")}`,
    note: "",
  }));
}

async function readTitleCache(sha256: string): Promise<ManhuaPropSheetTitleCacheDoc | null> {
  try {
    const { buffer } = await downloadGcsObject({
      gcsUri: `gs://${getGcsBucketName()}/${titleCacheObjectName(sha256)}`,
    });
    return JSON.parse(buffer.toString("utf8")) as ManhuaPropSheetTitleCacheDoc;
  } catch {
    // 404（未命中）与真实故障都在这里被当「无缓存」处理，未命中是预期路径：
    // 读不到才该调视觉模型，不该抛错卡死整个导入。
    return null;
  }
}

async function writeTitleCache(doc: ManhuaPropSheetTitleCacheDoc): Promise<void> {
  await uploadBufferToGcs({
    objectName: titleCacheObjectName(doc.sha256),
    buffer: Buffer.from(JSON.stringify(doc), "utf8"),
    contentType: "application/json",
  });
}

function buildTitleReadPrompt(cellCount: number): string {
  return [
    `这是一张道具设定拼板，均分成 ${cellCount} 格（从左到右、从上到下）。`,
    "每格底部都印着一行中文小标题（有的在卡片内、有的在卡片下方）。",
    `请按网格顺序原样抄出这 ${cellCount} 行标题文字，每行一条，不要编号、不要多余说明、不要翻译。`,
    "标题里如果有「｜」分隔符，原样保留（前半是名字，后半是备注）。",
  ].join("\n");
}

/**
 * 读取拼板每格标题：先按 SHA256 查 GCS 缓存，命中直接用（不调视觉模型）；
 * 未命中才调一次视觉模型，读到结果立刻写回同一个缓存对象。
 * 读失败（模型挂/解析不出来）降级为「道具01…道具0N」占位，不抛错卡死导入。
 */
export async function resolvePropSheetTitles(params: {
  buffer: Buffer;
  sha256: string;
  cols: number;
  rows: number;
}): Promise<{ titles: ManhuaPropSheetTitleItem[]; fromCache: boolean }> {
  const cellCount = Math.max(1, Math.floor(params.cols * params.rows));

  const cached = await readTitleCache(params.sha256);
  if (cached && Array.isArray(cached.titles) && cached.titles.length === cellCount) {
    return { titles: cached.titles, fromCache: true };
  }

  let titles: ManhuaPropSheetTitleItem[];
  try {
    const dataUrl = `data:image/png;base64,${params.buffer.toString("base64")}`;
    const { markdown } = await runCanvasTerraVisionMarkdown({
      prompt: buildTitleReadPrompt(cellCount),
      images: [{ url: dataUrl }],
    });
    const parsed = parsePropSheetTitlesFromMarkdown(markdown, cellCount);
    titles = parsed.length === cellCount ? parsed : numberedFallbackTitles(cellCount);
  } catch (err) {
    console.warn(
      `[manhuaPropSheetSplit] 视觉读标题失败，降级为编号占位：${err instanceof Error ? err.message : String(err)}`,
    );
    titles = numberedFallbackTitles(cellCount);
  }

  try {
    await writeTitleCache({
      sha256: params.sha256,
      gridCols: params.cols,
      gridRows: params.rows,
      titles,
      model: EVOLINK_CHAT_MODEL_GPT56_TERRA,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // 写缓存失败不影响本次结果，只是下次还会再读一次视觉模型
    console.warn(
      `[manhuaPropSheetSplit] 写标题缓存失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { titles, fromCache: false };
}

/** 按网格纯数学裁切成单件图 Buffer（sharp，零出图成本）。 */
export async function splitPropSheetBuffer(
  buf: Buffer,
  opts: { cols: number; rows: number },
): Promise<{ box: PropSheetGridBox; buffer: Buffer }[]> {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) throw new Error("prop_sheet_image_invalid");
  const boxes = computePropSheetGridBoxes({
    imageWidth: width,
    imageHeight: height,
    cols: opts.cols,
    rows: opts.rows,
  });
  const out: { box: PropSheetGridBox; buffer: Buffer }[] = [];
  for (const box of boxes) {
    const tile = await sharp(buf, { failOn: "none" })
      .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
      .png()
      .toBuffer();
    out.push({ box, buffer: tile });
  }
  return out;
}

export type ManhuaPropSheetSplitItem = {
  index: number;
  name: string;
  note: string;
  /** 7 天签名读链接，仅供当次导入即时预览/使用 */
  url: string;
  /**
   * gs:// 对象地址，长期存这个。前端要存进草稿的是它，不是 url——
   * url 7 天后 403 且无法恢复，gcsUri 才能在任意时刻现签出新的可读链接。
   */
  gcsUri: string;
};

/**
 * 端到端：下载拼板 → 算 SHA256 → 查/建标题缓存 → sharp 切格 → 各自落 GCS → 返回可读 URL。
 */
export async function splitManhuaPropSheetFromUrl(params: {
  sheetUrl: string;
  cols: number;
  rows: number;
}): Promise<{ sha256: string; items: ManhuaPropSheetSplitItem[]; titlesFromCache: boolean }> {
  const res = await fetch(params.sheetUrl);
  if (!res.ok) throw new Error(`prop_sheet_download_failed_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha256 = sha256HexOfBuffer(buf);

  const [{ titles, fromCache }, tiles] = await Promise.all([
    resolvePropSheetTitles({ buffer: buf, sha256, cols: params.cols, rows: params.rows }),
    splitPropSheetBuffer(buf, { cols: params.cols, rows: params.rows }),
  ]);

  const items: ManhuaPropSheetSplitItem[] = [];
  for (const tile of tiles) {
    const title = titles[tile.box.index] || numberedFallbackTitles(tiles.length)[tile.box.index]!;
    const objectName = `${SINGLE_IMAGE_OBJECT_PREFIX}/${sha256}/${tile.box.index}.png`;
    const { gcsUri } = await uploadBufferToGcs({
      objectName,
      buffer: tile.buffer,
      contentType: "image/png",
    });
    const url = await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
    items.push({ index: tile.box.index, name: title.name, note: title.note, url, gcsUri });
  }

  return { sha256, items, titlesFromCache: fromCache };
}

import sharp from "sharp";
import { uploadBufferToPlatformStorage } from "./evolinkGptImage2.js";

/**
 * 3×4 分段生成 → 后端拼成「一张完整长图」。
 *
 * 设计：把一份内容拆成 2–3 段，每段各自走标准 16:9 合成（每段字密度更低 → 降低糊字），
 * 再用 sharp **直向**拼成一张长图，段间加一条暖色分隔带遮蔽两次生成的轻微色差。
 * 失败（任一段下载/解析异常）时抛错，由调用方回退单段逻辑或报错。
 */

/** 段间分隔带高度（px）；用暖色宣纸调遮蔽两段独立生成的接缝色差。 */
const SECTION_DIVIDER_PX = 8;
/** 分隔带颜色（暖色宣纸调，呼应知识卡片/图文笔记底色）。 */
const DIVIDER_BG = { r: 232, g: 222, b: 201 };

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`[3×4·拼接] 下载分段图失败 HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * 把多张分段图直向拼成一张长图并上传，返回公开 URL。
 * 各段统一缩放到相同宽度（取最大宽度）后纵向堆叠，段间留 {@link SECTION_DIVIDER_PX} 暖色分隔带。
 */
export async function stitchSheetsVerticalAndUpload(params: {
  imageUrls: string[];
  /** 存储子目录，例如 platform_storyboard_sheet_3x4 / platform_xhs_dual_3x4 */
  subdir: string;
  flowLog?: string[];
}): Promise<string> {
  const { imageUrls, subdir, flowLog } = params;
  const urls = imageUrls.filter((u) => String(u || "").trim());
  if (urls.length === 0) throw new Error("[3×4·拼接] 无可拼接的分段图 URL");
  if (urls.length === 1) {
    // 只有一段时无需拼接，直接返回原图
    return urls[0];
  }

  flowLog?.push(`[3×4·拼接] 开始下载 ${urls.length} 张分段图 …`);
  const buffers = await Promise.all(urls.map((u) => fetchImageBuffer(u)));

  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const targetWidth = Math.max(...metas.map((m) => m.width || 0));
  if (!targetWidth) throw new Error("[3×4·拼接] 无法解析分段图宽度");

  const normalized = await Promise.all(
    buffers.map(async (b, i) => {
      const m = metas[i];
      if ((m.width || 0) === targetWidth) {
        return { buf: b, width: targetWidth, height: m.height || 0 };
      }
      const out = await sharp(b).resize({ width: targetWidth }).toBuffer();
      const om = await sharp(out).metadata();
      return { buf: out, width: targetWidth, height: om.height || 0 };
    }),
  );

  const totalHeight =
    normalized.reduce((acc, n) => acc + n.height, 0) +
    SECTION_DIVIDER_PX * (normalized.length - 1);

  const overlays: sharp.OverlayOptions[] = [];
  let top = 0;
  for (let i = 0; i < normalized.length; i++) {
    overlays.push({ input: normalized[i].buf, top, left: 0 });
    top += normalized[i].height + SECTION_DIVIDER_PX;
  }

  const merged = await sharp({
    create: {
      width: targetWidth,
      height: totalHeight,
      channels: 3,
      background: DIVIDER_BG,
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();

  flowLog?.push(
    `[3×4·拼接] 已纵向拼接为单张长图 · ${targetWidth}×${totalHeight}px · 段数=${normalized.length} · 上传中 …`,
  );
  const url = await uploadBufferToPlatformStorage(merged, subdir, flowLog);
  flowLog?.push(`[3×4·拼接] 完成 · 公开 URL 预览：${String(url).slice(0, 160)}…`);
  return url;
}

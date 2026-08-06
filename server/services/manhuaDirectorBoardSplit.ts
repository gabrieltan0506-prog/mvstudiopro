/**
 * 导演分镜板裁切：整版（主画面 + 底部编号格 + 右侧文字栏）只用于预览；
 * 送进段成片当垫图的必须是裁后只剩主画面的版本，否则模型有相当概率把
 * 「四格拼贴 + 文字栏」当成想要的画面结构，生成出带格线和编号的视频。
 *
 * 单区域裁一刀，不是 N×M 网格切多张，所以不复用 computePropSheetGridBoxes；
 * 裁切执行照 `manhuaPropSheetSplit.ts` 的 sharp extract 写法。
 */
import crypto from "node:crypto";
import sharp from "sharp";
import { computeDirectorBoardMainBox } from "../../shared/manhuaPropSheetGrid.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs.js";

function sha256HexOfBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const DIRECTOR_BOARD_MAIN_OBJECT_PREFIX = "manhua/director-board-main";

export type ManhuaDirectorBoardMainCropResult = {
  sha256: string;
  /** 7 天签名读链接，仅供当次预览/即时使用 */
  url: string;
  /**
   * gs:// 对象地址，长期存这个。草稿里只存它——签名 url 过期后没有 gcsUri
   * 就再也签不出新链接，整包资产会集体失链且无法补救。
   */
  gcsUri: string;
  width: number;
  height: number;
};

/** 按 computeDirectorBoardMainBox 裁出仅主画面的 Buffer（sharp，零出图成本）。 */
export async function cropDirectorBoardMainBuffer(buf: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) throw new Error("director_board_image_invalid");
  const box = computeDirectorBoardMainBox(width, height);
  const buffer = await sharp(buf, { failOn: "none" })
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .png()
    .toBuffer();
  return { buffer, width: box.width, height: box.height };
}

/**
 * 端到端：下载整版导演板 → 算 SHA256 → sharp 裁出主画面 → 落 GCS → 返回
 * gcsUri + 签名 url。原图（整版）由调用方另存，供预览；这里只处理裁后版。
 */
export async function cropManhuaDirectorBoardMainFromUrl(params: {
  boardUrl: string;
}): Promise<ManhuaDirectorBoardMainCropResult> {
  const res = await fetch(params.boardUrl);
  if (!res.ok) throw new Error(`director_board_download_failed_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha256 = sha256HexOfBuffer(buf);
  const { buffer, width, height } = await cropDirectorBoardMainBuffer(buf);

  const objectName = `${DIRECTOR_BOARD_MAIN_OBJECT_PREFIX}/${sha256}.png`;
  const { gcsUri } = await uploadBufferToGcs({
    objectName,
    buffer,
    contentType: "image/png",
  });
  const url = await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  return { sha256, url, gcsUri, width, height };
}

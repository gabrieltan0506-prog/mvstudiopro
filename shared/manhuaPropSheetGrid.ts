/**
 * 道具拼板切图：纯数学网格裁切框计算（不依赖 sharp，可在任意环境跑单测）。
 *
 * 拼板结构：顶部一条标题带（整图标题，如《雁门照山河》道具设定 01｜第01—03集），
 * 排除在网格外；其下按 cols×rows 均分成格子。每格底部会有一行中文小标题——
 * 有的贴在深色卡片内部底端，有的印在卡片下方的页面底色上，两种版式都用
 * 「统一裁掉每格底部约 N% 高度」来盖住，不用为两种版式各写一套参数
 * （校准依据：雁门照山河道具设定 01/02 两张 1672×941 实拼板，见
 * `server/services/manhuaPropSheetSplit.test.ts` 用真实图片验证过 20% 足够）。
 */

export type PropSheetGridBox = {
  /** 从左到右、从上到下的网格序号（0-based） */
  index: number;
  row: number;
  col: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PropSheetGridOptions = {
  imageWidth: number;
  imageHeight: number;
  cols: number;
  rows: number;
  /** 顶部标题带占整图高度的比例；网格从这条线以下开始切。默认 0.095（校准自实拼板）。 */
  topBandRatio?: number;
  /** 每格底部裁掉的比例，用来盖住格内或格下方的中文小标题。默认 0.2。 */
  bottomTrimRatio?: number;
};

/**
 * 按「从左到右、从上到下」的网格顺序返回裁切框。
 * 每个格子先均分宽高，再从底部裁掉 bottomTrimRatio 的高度（标题区）。
 */
export function computePropSheetGridBoxes(opts: PropSheetGridOptions): PropSheetGridBox[] {
  const imageWidth = Math.max(1, Math.floor(Number(opts.imageWidth) || 0));
  const imageHeight = Math.max(1, Math.floor(Number(opts.imageHeight) || 0));
  const cols = Math.max(1, Math.floor(Number(opts.cols) || 1));
  const rows = Math.max(1, Math.floor(Number(opts.rows) || 1));
  const topBandRatio = clampRatio(opts.topBandRatio ?? 0.095);
  const bottomTrimRatio = clampRatio(opts.bottomTrimRatio ?? 0.2);

  const topOffset = Math.round(imageHeight * topBandRatio);
  const gridHeight = Math.max(1, imageHeight - topOffset);
  const cellWidth = Math.floor(imageWidth / cols);
  const cellHeight = Math.floor(gridHeight / rows);

  const boxes: PropSheetGridBox[] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      // 末列/末行吸收整除余下的像素，避免累计误差漏切最右/最下一条边。
      const left = col * cellWidth;
      const top = topOffset + row * cellHeight;
      const width = col === cols - 1 ? imageWidth - left : cellWidth;
      const rawHeight = row === rows - 1 ? imageHeight - top : cellHeight;
      const height = Math.max(1, Math.round(rawHeight * (1 - bottomTrimRatio)));
      boxes.push({ index, row, col, left, top, width, height });
      index += 1;
    }
  }
  return boxes;
}

function clampRatio(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.9, Math.max(0, n));
}

/**
 * 导演分镜板整版结构：中央主画面 + 底部三个编号小分镜 + 右侧深色文字栏。
 * 送进段成片当垫图的只能是主画面——不裁会让模型把「四格拼贴 + 文字栏」
 * 当成想要的画面结构，生成出带格线和编号的视频。
 *
 * 六张真实导演板（1672×941）实测校准：右侧信息栏起于宽度 78%（78–79% 是纯黑
 * 分隔槽），底部编号格起于高度 72%。裁到 77.2% / 71.2% 处，人工验图确认干净，
 * 无右栏文字残留、无底部编号格残留。
 */
export const DIRECTOR_BOARD_MAIN_BOX_WIDTH_RATIO = 0.772;
export const DIRECTOR_BOARD_MAIN_BOX_HEIGHT_RATIO = 0.712;

export type DirectorBoardMainBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** 导演分镜板整版 → 仅主画面的裁切框（单区域裁一刀，不是网格切多张）。 */
export function computeDirectorBoardMainBox(
  imageWidth: number,
  imageHeight: number,
): DirectorBoardMainBox {
  const w = Math.max(1, Math.floor(Number(imageWidth) || 0));
  const h = Math.max(1, Math.floor(Number(imageHeight) || 0));
  return {
    left: 0,
    top: 0,
    width: Math.max(1, Math.round(w * DIRECTOR_BOARD_MAIN_BOX_WIDTH_RATIO)),
    height: Math.max(1, Math.round(h * DIRECTOR_BOARD_MAIN_BOX_HEIGHT_RATIO)),
  };
}

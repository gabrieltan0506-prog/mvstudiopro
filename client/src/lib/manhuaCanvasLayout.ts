import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex } from "./canvasDramaStudio";

/**
 * 漫剧画布的分区排版（用户 2026-08-09 拍板的版式）。
 *
 * 最左一竖条按资产类型上下堆三块——人物在上、服装道具组在中、场景在下，块内同类直排；
 * 往右依次是「关键静帧 + 分集导演版」、成片提示词、出片。
 *
 * 为什么要有这个文件：在此之前画布是两套排位各管各的。一集的链路排成一行
 * （story→bible→beats→keyart→clip 往右铺，多集往下叠），资产图另有一套只认
 * 角色和场景、把它们各挤成一行，**道具压根没人排**，留在生成时的原始坐标上。
 * 两套叠在一起就是用户说的「一团乱」。这里把坐标收敛成唯一出口。
 */

/** 版式常量：改这里就能整体调疏密 */
export const MANHUA_CANVAS_LAYOUT = {
  originX: 60,
  originY: 80,
  /** 同一竖列里相邻节点的垂直间距 */
  rowGap: 32,
  /** 资产三块之间的额外留白（人物块底 → 道具块顶） */
  bandGap: 96,
  /** 相邻竖列之间的水平间距 */
  colGap: 72,
  assetWidth: 360,
  assetHeight: 400,
  textWidth: 380,
  textHeight: 300,
  keyartWidth: 360,
  keyartHeight: 400,
  clipWidth: 400,
  clipHeight: 360,
};

/** 画布分区。左侧三块资产（人物 / 服装道具组 / 场景）+ 右侧按流程往右并列的三列 */
export type ManhuaCanvasLane =
  | "character"
  /** 服装道具组：服装板与道具板同属一区 */
  | "prop"
  | "scene"
  | "episode"
  | "clipPrompt"
  | "output";

/**
 * 节点归哪一区。
 *
 * 服装板（wardrobe*）归到道具区——用户 2026-08-09 拍板叫「服装道具组」，
 * 服装和道具是同一类可换戴的外部物件，放一起才好挑。
 * 返回 null 表示不归任何分区，排版时原样保留坐标。
 */
export function manhuaCanvasLaneOf(blockId: string): ManhuaCanvasLane | null {
  const id = String(blockId || "");
  if (/^(charsheet-face|charsheet)-/.test(id)) return "character";
  if (/^(wardrobeplate|wardrobe|propplate|propsheet|prop)-/.test(id)) return "prop";
  if (/^(sceneplate|scene)-/.test(id)) return "scene";
  if (/^(story|bible|beats|reverse|script|recap_card)-/.test(id)) return "episode";
  if (id.startsWith("keyart-")) return "episode";
  if (id.startsWith("clip-")) return "clipPrompt";
  if (id.startsWith("promo_cover-")) return "output";
  return null;
}

function sizeForLane(
  lane: ManhuaCanvasLane,
  block: CanvasBlock,
): { width: number; height: number } {
  const L = MANHUA_CANVAS_LAYOUT;
  if (lane === "clipPrompt") {
    return { width: block.width || L.clipWidth, height: block.height || L.clipHeight };
  }
  if (lane === "episode") {
    if (block.id.startsWith("keyart-")) {
      return { width: block.width || L.keyartWidth, height: block.height || L.keyartHeight };
    }
    return { width: block.width || L.textWidth, height: block.height || L.textHeight };
  }
  if (lane === "output") {
    return { width: block.width || L.keyartWidth, height: block.height || L.keyartHeight };
  }
  return { width: block.width || L.assetWidth, height: block.height || L.assetHeight };
}

/**
 * 分区内的稳定排序：先按集号，再按节点自身的顺序号，最后按 id 兜底。
 *
 * 不能直接用数组下标——同一集的静帧是分批 publish 进来的，按到达顺序排会让
 * 节点在画布上跳来跳去。
 */
function compareWithinLane(a: CanvasBlock, b: CanvasBlock): number {
  const epA = getBlockEpisodeIndex(a) ?? 0;
  const epB = getBlockEpisodeIndex(b) ?? 0;
  if (epA !== epB) return epA - epB;
  const stageA = manhuaEpisodeStageOrder(a.id);
  const stageB = manhuaEpisodeStageOrder(b.id);
  if (stageA !== stageB) return stageA - stageB;
  const numA = trailingNumberOf(a.id);
  const numB = trailingNumberOf(b.id);
  if (numA !== numB) return numA - numB;
  return a.id.localeCompare(b.id);
}

/** 一集内部的阅读顺序：先导演版文本，再静帧 */
function manhuaEpisodeStageOrder(id: string): number {
  if (id.startsWith("recap_card-")) return 0;
  if (id.startsWith("story-")) return 1;
  if (id.startsWith("bible-")) return 2;
  if (id.startsWith("beats-")) return 3;
  if (id.startsWith("reverse-") || id.startsWith("script-")) return 4;
  if (id.startsWith("keyart-")) return 5;
  return 9;
}

/** 取 id 里最靠后的一串数字（镜号 / 段号 / 序号），用于同阶段内排序 */
function trailingNumberOf(id: string): number {
  const matches = String(id || "").match(/\d+/g);
  if (!matches?.length) return 0;
  const last = matches[matches.length - 1]!;
  const n = Number.parseInt(last, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 折叠起来的集：该集除首个节点外都不参与排版，也不占竖直空间 */
export type ManhuaCanvasLayoutOptions = {
  /** 需要折叠的集号；折叠后该集在静帧列只留一个代表节点的高度 */
  collapsedEpisodes?: Iterable<number>;
};

/**
 * 把画布节点按分区重排坐标。
 *
 * 纯函数：只改 x/y/width/height，不增删节点、不动 prompt 与产出。
 * 不归任何分区的节点（用户自己拖进来的自由节点等）原样返回。
 */
/**
 * @deprecated 2026-08-11 段列化后已退役：生产线唯一版式出口是
 * canvasDramaStudio.layoutManhuaEpisodeReadableChain（段列制）。
 * 本文件仅 MANHUA_CANVAS_LAYOUT 常量仍被消费；函数与测试待下批删除。
 */
export function layoutManhuaCanvasBlocks(
  blocks: CanvasBlock[],
  opts?: ManhuaCanvasLayoutOptions,
): CanvasBlock[] {
  const L = MANHUA_CANVAS_LAYOUT;
  const collapsed = new Set(opts?.collapsedEpisodes ?? []);

  const byLane = new Map<ManhuaCanvasLane, CanvasBlock[]>();
  for (const b of blocks) {
    const lane = manhuaCanvasLaneOf(b.id);
    if (!lane) continue;
    const list = byLane.get(lane);
    if (list) list.push(b);
    else byLane.set(lane, [b]);
  }
  byLane.forEach((list) => list.sort(compareWithinLane));

  /** 左侧资产竖条的宽度决定右侧从哪里开始 */
  const assetLanes: ManhuaCanvasLane[] = ["character", "prop", "scene"];
  const assetColumnWidth = assetLanes.reduce((max, lane) => {
    const widest = (byLane.get(lane) || []).reduce(
      (w, b) => Math.max(w, sizeForLane(lane, b).width),
      0,
    );
    return Math.max(max, widest);
  }, L.assetWidth);

  const placed = new Map<string, { x: number; y: number; width: number; height: number }>();

  // 左侧：人物 → 道具 → 场景，上下堆三块，块内直排
  let bandY = L.originY;
  for (const lane of assetLanes) {
    const list = byLane.get(lane) || [];
    if (!list.length) continue;
    for (const b of list) {
      const size = sizeForLane(lane, b);
      placed.set(b.id, { x: L.originX, y: bandY, ...size });
      bandY += size.height + L.rowGap;
    }
    bandY += L.bandGap - L.rowGap;
  }

  // 右侧三列：静帧+导演版 → 成片提示词 → 出片
  const rightLanes: ManhuaCanvasLane[] = ["episode", "clipPrompt", "output"];
  let colX = L.originX + assetColumnWidth + L.colGap;
  for (const lane of rightLanes) {
    const list = byLane.get(lane) || [];
    if (!list.length) continue;
    let y = L.originY;
    let laneWidth = 0;
    /** 折叠的集只让它的第一个节点占位，其余压到同一坐标由 UI 决定是否渲染 */
    const seenCollapsedEpisode = new Set<number>();
    for (const b of list) {
      const size = sizeForLane(lane, b);
      laneWidth = Math.max(laneWidth, size.width);
      const ep = getBlockEpisodeIndex(b);
      if (ep != null && collapsed.has(ep)) {
        if (seenCollapsedEpisode.has(ep)) {
          placed.set(b.id, { x: colX, y, ...size });
          continue;
        }
        seenCollapsedEpisode.add(ep);
        placed.set(b.id, { x: colX, y, ...size });
        y += size.height + L.rowGap;
        continue;
      }
      placed.set(b.id, { x: colX, y, ...size });
      y += size.height + L.rowGap;
    }
    colX += laneWidth + L.colGap;
  }

  return blocks.map((b) => {
    const pos = placed.get(b.id);
    if (!pos) return b;
    if (
      b.x === pos.x &&
      b.y === pos.y &&
      b.width === pos.width &&
      b.height === pos.height
    ) {
      return b;
    }
    return { ...b, ...pos };
  });
}

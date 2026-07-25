/**
 * 按本段机位从四视角切片里挑一张当场景垫图。
 *
 * 跨集场景出的 2×2 拼板是同一地点的四个机位，切开后每格各有所长：
 * 段里走俯拍却喂平视主视角，等于让引擎自己去想象俯视下的地面动线，
 * 空间锁就白锁了。官方也只要 1 张场景参考，所以是「挑一张」不是「都喂」。
 */

/** 与 buildManhuaSceneFourViewGridPrompt / cropSheet2x2ToTiles 的四格顺序一致 */
export type ManhuaSceneTileSlot = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export const MANHUA_SCENE_TILE_LABEL_ZH: Record<ManhuaSceneTileSlot, string> = {
  topLeft: "主视角",
  topRight: "正面聚焦",
  bottomLeft: "高俯斜角",
  bottomRight: "正俯",
};

/**
 * 级联判定，不投票——四格之间的差异只在**机位角度**上。
 *
 * 「推进」「近景」讲的是运镜和景别，跟角度正交：一段里写三次推近也不该
 * 把「俯拍」比下去，否则俯视段会拿到平视图。所以角度线索一旦出现就定案，
 * 只有全段压根没提角度时，才退一步用正面/推近去猜正面聚焦那格。
 *
 * 角度内部先认正俯：那几个词（正俯/垂直俯/鸟瞰/顶视）不会是顺口提到的，
 * 而「俯拍」宽泛得多，反序会把垂直俯视的段落错配成斜俯。
 */
const TILE_CUES: Array<{ slot: ManhuaSceneTileSlot; re: RegExp }> = [
  { slot: "bottomRight", re: /正俯|垂直俯|顶视|顶拍|鸟瞰|上帝视角|平面俯视/ },
  { slot: "bottomLeft", re: /俯拍|俯视|俯角|斜俯|高角度|高机位|自屋顶|自崖/ },
  { slot: "topRight", re: /正面|怼脸|推近|特写|近景|过肩/ },
];

/** 从本段机位文案挑格子；没有明确线索就回主视角（建立镜头的默认纵深） */
export function pickManhuaSceneTileSlot(
  cameraTextZh: string | null | undefined,
): ManhuaSceneTileSlot {
  const text = String(cameraTextZh || "");
  if (!text.trim()) return "topLeft";
  for (const cue of TILE_CUES) {
    if (cue.re.test(text)) return cue.slot;
  }
  return "topLeft";
}

/** 有对应切片就换，没有就退回原图（拼板整张仍比没有强） */
export function resolveManhuaSceneTileUrl(
  fallbackUrl: string,
  tileUrls: Partial<Record<ManhuaSceneTileSlot, string>> | null | undefined,
  cameraTextZh: string | null | undefined,
): { url: string; slot: ManhuaSceneTileSlot | null } {
  const tiles = tileUrls || {};
  if (!Object.keys(tiles).length) return { url: fallbackUrl, slot: null };
  const slot = pickManhuaSceneTileSlot(cameraTextZh);
  const hit = String(tiles[slot] || "").trim();
  if (hit) return { url: hit, slot };
  // 挑中的格子缺图时退主视角，再不行才用原图
  const main = String(tiles.topLeft || "").trim();
  if (main) return { url: main, slot: "topLeft" };
  return { url: fallbackUrl, slot: null };
}

import {
  formatManhuaAssetImageBindBlock,
  parseManhuaAssetImageBindBlock,
  resolveManhuaAssetImageBindRows,
  buildManhuaAssetPathById,
  type ManhuaAssetLockRegistry,
} from "./manhuaAssetLockRegistry";
import {
  normalizeManhuaKeyartLookState,
  type ManhuaKeyartLookState,
} from "./manhuaKeyartLookState";

const LOOK_MARK = "【静帧·本段造型参考】";

type KeyartLookBlock = {
  prompt: string;
  refImageUrl?: string;
  editFusionUrls?: string[];
  imageMode?: "generate" | "edit";
  manhuaKeyartLookState?: ManhuaKeyartLookState;
};

/** 当前段的资产表重新产生参考列表，不从旧静帧推断本次外观。原产物与分镜正文保留。 */
export function compileManhuaKeyartLookBindings<T extends KeyartLookBlock>(
  block: T,
  options: {
    registry: ManhuaAssetLockRegistry;
    allowedIds: string[];
    activeLookSetIds: string[];
  }
): T & KeyartLookBlock {
  const { registry, activeLookSetIds } = options;
  const paths = buildManhuaAssetPathById(registry);
  const readyLooks = activeLookSetIds.filter(id => Boolean(paths[id]));
  // 尚未挂图的默认空位不改变旧行为；明确选择的缺图由段编译门禁拒绝。
  if (!readyLooks.length && !block.prompt.includes(LOOK_MARK)) return block;
  const rows = resolveManhuaAssetImageBindRows(
    parseManhuaAssetImageBindBlock(
      formatManhuaAssetImageBindBlock(registry, 16, options)
    ),
    paths
  );
  if (readyLooks.some(id => !rows.some(row => row.id === id))) {
    throw new Error(
      "关键静帧参考图名额不足，所选造型未能入选，请减少参考后重试。"
    );
  }
  const urls = Array.from(new Set(rows.map(row => row.path)));
  if (!urls.length)
    throw new Error("关键静帧的造型参考已失效，请重新确认本段资产。");
  // 重编译参考顺序后，旧融图编号与“禁止换装”短锁不能继续指向上一套图。
  const obsoleteMarks = [
    LOOK_MARK,
    "【身份短锁】",
    "【静帧·示范图融图】",
    "【静帧·用户参考融图】",
    "【静帧·人物库垫图·改图】",
    "【静帧·用户垫图·改图】",
    "【静帧·人物库垫图·Image-2 Edit】",
    "【静帧·用户垫图·Image-2 Edit】",
  ];
  let prompt = block.prompt;
  for (const mark of obsoleteMarks) {
    const start = prompt.indexOf(mark);
    if (start < 0) continue;
    const tail = prompt.slice(start + mark.length);
    const end = tail.search(/\n【/);
    prompt = prompt.slice(0, start) + (end >= 0 ? tail.slice(end) : "");
  }
  const instructions = rows.map(row => {
    const index = urls.indexOf(row.path) + 1;
    const duty = readyLooks.includes(row.id)
      ? "本镜外观与形态，以此图为准"
      : row.tag.startsWith("@角色")
        ? "识别同一角色的身份；外观以该角色本段造型图为准"
        : "沿用本段场景或道具";
    return `参考图${index}：${row.labelZh}；${duty}。`;
  });
  return {
    ...block,
    manhuaKeyartLookState: {
      ...normalizeManhuaKeyartLookState(block.manhuaKeyartLookState),
      required: JSON.stringify(
        rows
          .filter(row => readyLooks.includes(row.id))
          .map(row => [row.id, row.path])
      ),
    },
    imageMode: "edit",
    refImageUrl: urls[0],
    editFusionUrls: urls.slice(1),
    prompt: `${prompt.trim()}\n\n${LOOK_MARK}\n${instructions.join("\n")}\n角色仍是同一身份，按本镜动作构图；造型参考不增加新角色，也不改变剧情。`,
  };
}

/** 镜间接力不能替换已经编号的造型底图；有空位才追加上镜作为构图参考。 */
export function appendManhuaKeyartLookContinuity<T extends KeyartLookBlock>(
  block: T,
  previousUrl: string
): (T & KeyartLookBlock) | null {
  if (!block.prompt.includes(LOOK_MARK)) return null;
  const urls = [block.refImageUrl, ...(block.editFusionUrls || [])].filter(
    Boolean
  ) as string[];
  if (urls.includes(previousUrl) || urls.length >= 16) return block;
  return {
    ...block,
    editFusionUrls: [...(block.editFusionUrls || []), previousUrl],
    prompt: `${block.prompt}\n参考图${urls.length + 1}仅用于镜间构图接续，当前角色外观仍以本段造型参考为准。`,
  };
}

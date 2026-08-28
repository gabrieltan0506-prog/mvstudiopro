/**
 * 阶段条「资产设定」格的缺口文案组装（纯函数，供组件与单测共用）。
 *
 * 为什么抽出来：workflowPhases 是组件内 useMemo，缺口文案的分支
 * （定妆计数 / 场景两态 / 风格包 / 剧本过期）没法直接测；抽成纯函数后
 * 判据仍全部来自 evaluateManhuaAssetImageGate 的结果——这里只做「翻译成
 * 中文明细」，不新起任何并行判定，complete 判定一个字不碰。
 */
import type { ManhuaAssetImageGateResult } from "@shared/manhuaAssetImageGate";

/** 缺口微操锚点：点「去补」跳到资产页对应区块 */
export type ManhuaAssetsGapAnchor = "cast" | "scene" | "style";

export type ManhuaAssetsGapItem = {
  textZh: string;
  /** 去补链接的按钮文案；没有可跳区块的缺项（如剧本过期）不出链接 */
  jumpLabelZh?: string;
  anchor?: ManhuaAssetsGapAnchor;
  /**
   * 选填项标记（如风格包）。选填项永远不能独自代表缺口——
   * 否则「唯一缺口是个选填项、阶段却不完成」重演 0823 的错位。
   */
  optional?: boolean;
};

export type ManhuaAssetsGapInput = {
  /** 既有单一判据 assetGate.ready && !stale 的结果，原样传入，不在此重算 */
  assetsComplete: boolean;
  gate: Pick<
    ManhuaAssetImageGateResult,
    "missingCastIds" | "missingScene" | "sceneLocked" | "hintZh"
  >;
  /**
   * 喂给闸门的角色总数（characterIds.length）。
   * 「定妆 x/y」两头都用**人数**：y=castTotal，x=y−缺图人数——
   * 审查实锤：画廊张数是另一本账（主角脸+全身两张、自传参考图都逐条计张），
   * 拿张数当 x 会在多角色时越偏越大。
   */
  castTotal: number;
  /** 风格包（可选进阶）未填。只提示不拦路：它从不参与 complete 判定 */
  stylePackMissing: boolean;
  /** 剧本已改（assetScriptStaleHintZh 非空） */
  scriptStale: boolean;
};

export function buildManhuaAssetsGapItems(input: ManhuaAssetsGapInput): ManhuaAssetsGapItem[] {
  if (input.assetsComplete) return [];
  const items: ManhuaAssetsGapItem[] = [];
  const missingCast = input.gate.missingCastIds?.length ?? 0;
  if (missingCast > 0) {
    // 「定妆 x/y」同一本人数账：y=喂给闸门的角色数，x=y−闸门点名缺图的人数
    const total = Math.max(input.castTotal, missingCast);
    const done = Math.max(0, total - missingCast);
    items.push({
      textZh: `定妆 ${done}/${total}`,
      jumpLabelZh: "去补角色",
      anchor: "cast",
    });
  }
  // 场景两态分开说：没锁定是「还没选」，锁定了没图是「图没出」，混为一谈会指错路
  if (!input.gate.sceneLocked) {
    items.push({ textZh: "未选场景", jumpLabelZh: "去选场景", anchor: "scene" });
  } else if (input.gate.missingScene) {
    items.push({ textZh: "场景图未出", jumpLabelZh: "去出场景图", anchor: "scene" });
  }
  if (input.stylePackMissing) {
    // 标注「选填」：风格包不挡 complete，别让用户误以为被它卡住
    items.push({
      textZh: "风格包未填（选填）",
      jumpLabelZh: "去填风格包",
      anchor: "style",
      optional: true,
    });
  }
  if (input.scriptStale) {
    items.push({ textZh: "剧本已改，资产待重出" });
  }
  return items;
}

/**
 * 组装成阶段格小字。兜底规则（审查 P1 修正）：
 * 拦路缺口（非 optional）为空时必须退回闸门整句 hintZh——
 * 只剩选填项时若不兜底，用户看到的唯一缺口是「选填」，阶段却永远不完成。
 */
export function buildManhuaAssetsGapZh(input: ManhuaAssetsGapInput): string {
  if (input.assetsComplete) return "";
  const items = buildManhuaAssetsGapItems(input);
  const blocking = items.filter((i) => !i.optional).map((i) => i.textZh);
  const optionalTail = items.filter((i) => i.optional).map((i) => i.textZh);
  if (blocking.length === 0) {
    const hint = input.gate.hintZh || "资产未齐";
    return optionalTail.length ? `${hint} · ${optionalTail.join(" · ")}` : hint;
  }
  return [...blocking, ...optionalTail].join(" · ");
}

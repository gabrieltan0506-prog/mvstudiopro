/**
 * 导演 / 角色契约蒸馏（产品可调用，非 Agent 手册）。
 * 结构灵感来自公开 MIT 仓库 Emily2040/seedance-2.0 的 characters + directing 思路，
 * 已改写成中性业务句；前台文案禁止供应商 / 模型名。
 */

import {
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
} from "./manhuaScriptWorkbench.js";

export type ManhuaCharacterContractInput = {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  motiveZh?: string;
  noteZh?: string;
};

/** 定妆参考用：外形可见；对白/关系作隐藏说明，软建议勿入画 */
export function formatManhuaCharacterContractBlock(
  c: ManhuaCharacterContractInput,
): string {
  const tag = [c.nameZh, c.aliasZh].filter(Boolean).join("/");
  const hidden = [c.motiveZh, c.noteZh].filter(Boolean).join("；");
  return [
    "【角色造型参考】",
    `人物气质参考：${tag || "主角"}`,
    c.lookZh ? `请画出的外形：${c.lookZh}` : "",
    hidden
      ? `（隐藏说明·不必画出：${hidden}）`
      : "",
    "强烈建议：单人定妆半身或胸像，脸与服饰清楚，背景干净；优先纯视觉，无旁人抢戏。",
    "贯穿全系列同一身份；换脸、换服、换发色会破坏连载锁定。",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 多角色同框时的动作分层（稳定脸手） */
export function formatManhuaEnsembleActionHierarchyBlock(): string {
  return [
    "【多角色动作分层】",
    "1. 背景人物：只保留呼吸、眨眼、微肩动等持续微动作。",
    "2. 本镜焦点：仅一人做一件可读小反应（带起止）。",
    "3. 默认避免多人同时大动作（起身/走动/转身/递物），除非本镜唯一戏核。",
  ].join("\n");
}

/** 导戏一致：一意图，运镜/光/表演同向 */
export function formatManhuaDirectingCoherenceBlock(opts?: {
  intentionZh?: string | null;
}): string {
  const intention = String(opts?.intentionZh || "").trim().slice(0, 80);
  return [
    "【导戏一致】",
    intention
      ? `本镜单一意图：${intention}`
      : "每镜只定一个意图（让观众感到什么变化）。",
    "运镜、光、站位、表演只服务该意图；少堆「电影感/大片感」空词。",
    "情绪写成可见动作（握杯、偏头、咬肌），少写抽象心情名词。",
  ].join("\n");
}

/** 注入定妆参考生图提示：契约 + 原表视觉句（软建议无字） */
export function composeManhuaWriterCanonSheetPrompt(input: {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  motiveZh?: string;
  noteZh?: string;
  basePromptZh?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
  topic?: string;
}): string {
  const base = String(input.basePromptZh || "")
    .trim()
    // 表内旧文案常带「设定卡·姓名」，易诱导姓名条；改为纯视觉指导
    .replace(/原创角色设定卡·?/g, "原创角色定妆肖像，")
    .replace(/设定卡/g, "定妆肖像");
  return [
    "生成一张竖版漫剧角色定妆参考（9:16）：单人清晰、服化道完整、干净背景。",
    "强烈建议：按人物外形来画；对白、大纲与姓名标签作隐藏说明，不必出现在画面中。",
    formatManhuaCharacterContractBlock(input),
    base,
    input.artStyleLabelZh ? `【画风】${input.artStyleLabelZh}` : "",
    String(input.artStylePromptZh || "").trim(),
    input.topic
      ? `（隐藏题材氛围·不必写成标题：${input.topic.slice(0, 80)}）`
      : "",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

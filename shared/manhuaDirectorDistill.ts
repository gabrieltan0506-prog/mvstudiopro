/**
 * 导演 / 角色契约蒸馏（产品可调用，非 Agent 手册）。
 * 结构灵感来自公开 MIT 仓库 Emily2040/seedance-2.0 的 characters + directing 思路，
 * 已改写成中性业务句；前台文案禁止供应商 / 模型名。
 */

export type ManhuaCharacterContractInput = {
  nameZh: string;
  aliasZh?: string;
  lookZh?: string;
  motiveZh?: string;
  noteZh?: string;
};

/** 设定卡 / 静帧用：先消歧义再加画风 */
export function formatManhuaCharacterContractBlock(
  c: ManhuaCharacterContractInput,
): string {
  const tag = [c.nameZh, c.aliasZh].filter(Boolean).join("/");
  return [
    "【角色身份契约】",
    `标签：${tag || "主角"}`,
    c.lookZh ? `外形锚点：${c.lookZh}` : "",
    c.motiveZh ? `动机/关系：${c.motiveZh}` : "",
    c.noteZh ? `备注：${c.noteZh}` : "",
    "单人设定卡：正面脸与服饰可读；无旁人抢戏；禁字幕/水印/姓名条。",
    "贯穿全系列同一身份；禁止换脸换服换发色。",
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
    "3. 默认禁止多人同时大动作（起身/走动/转身/递物），除非本镜唯一戏核。",
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
    "运镜、光、站位、表演只服务该意图；禁止堆「电影感/大片感」空词。",
    "情绪须写成可见动作（握杯、偏头、咬肌），禁止只写抽象心情名词。",
  ].join("\n");
}

/** 注入设定卡生图提示：契约 + 原表 prompt */
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
  return [
    formatManhuaCharacterContractBlock(input),
    String(input.basePromptZh || "").trim(),
    input.artStyleLabelZh ? `【画风】${input.artStyleLabelZh}` : "",
    String(input.artStylePromptZh || "").trim(),
    input.topic ? `题材：${input.topic.slice(0, 80)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

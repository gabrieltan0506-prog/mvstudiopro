const MANHUA_ASSET_EDIT_MAX_CHARS = 1_600;

/**
 * 用户资产编辑指令只做长度与空白收口；不擅自改写创作意图。
 * 固定尾句保证未点名区域、单图结构与无烧字要求不被编辑任务破坏。
 */
export function buildManhuaAssetImageEditPrompt(rawInstruction: unknown): string {
  const instruction = String(rawInstruction || "")
    .trim()
    .slice(0, MANHUA_ASSET_EDIT_MAX_CHARS);
  if (!instruction) return "";
  return [
    "请直接编辑这张参考图，严格执行以下修改要求：",
    instruction,
    "未被点名修改的主体身份、造型特征与画面风格保持稳定。输出单张完整图片；禁止新增文字、标签、边框、水印、拼图或多宫格。",
  ].join("\n");
}

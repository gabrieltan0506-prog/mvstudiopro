export function buildStoryboardImagePrompt(input: {
  scenePrompt: string;
  environment?: string;
  character?: string;
  action?: string;
  camera?: string;
  lighting?: string;
  mood?: string;
  lockedCharacterPrompt?: string;
  referenceImageMode?: string;
}) {
  const parts = [
    "电影感定格画面",
    "专业电影镜头",
    "浅景深",
    "高质量光影",
    "角色身份在所有分镜中保持一致",
    "保持同一张脸",
    "保持同一套服装",
    "保持同一发型",
    String(input.scenePrompt || "").trim(),
    `环境：${String(input.environment || "").trim()}`,
    `角色：${String(input.character || "").trim()}`,
    `动作：${String(input.action || "").trim()}`,
    `镜头：${String(input.camera || "").trim()}`,
    `光影：${String(input.lighting || "").trim()}`,
    `情绪：${String(input.mood || "").trim()}`,
    "16:9 构图",
    "超高细节",
  ].filter(Boolean);

  if (input.lockedCharacterPrompt) {
    parts.push(String(input.lockedCharacterPrompt).trim());
  }
  if (input.referenceImageMode) {
    parts.push(`参考图模式：${String(input.referenceImageMode).trim()}`);
  }

  return parts.join("，");
}

export function buildVideoPrompt(input: {
  scenePrompt: string;
  character?: string;
  action?: string;
  camera?: string;
  lighting?: string;
  mood?: string;
  sceneDuration?: number;
  lockedCharacterPrompt?: string;
}) {
  const sceneDuration = Number(input.sceneDuration || 0) || 5;
  const parts = [
    "电影感视频镜头",
    "高质量影视光影",
    "严格保持参考人物身份一致",
    "禁止人物身份漂移",
    "保持动作与运动连续性",
    `时长约 ${sceneDuration} 秒`,
    `场景：${String(input.scenePrompt || "").trim()}`,
    `角色：${String(input.character || "").trim()}`,
    `动作：${String(input.action || "").trim()}`,
    `镜头运动：${String(input.camera || "电影感镜头运动").trim()}`,
    `光影：${String(input.lighting || "电影感光影").trim()}`,
    `情绪：${String(input.mood || "电影感").trim()}`,
  ].filter(Boolean);

  if (input.lockedCharacterPrompt) {
    parts.push(String(input.lockedCharacterPrompt).trim());
  }

  return parts.join("，");
}

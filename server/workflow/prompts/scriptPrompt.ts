export function buildScriptPrompt(input: {
  prompt: string;
  targetWords?: number;
  targetScenes?: number;
  sceneDuration?: number;
}) {
  const prompt = String(input.prompt || "").trim();
  const targetWords = Number(input.targetWords || 0) || 900;
  const targetScenes = Number(input.targetScenes || 0) || 6;
  const sceneDuration = Number(input.sceneDuration || 0) || 5;

  return [
    "你是资深中文电影编剧与分镜总监。",
    "任务：写出电影级叙事脚本，供后续 AI 分镜和视频生成直接使用。",
    "硬性约束：",
    `1) 仅中文输出；2) 总字数尽量接近 ${targetWords}（允许约±10%）；3) 包含 ${targetScenes} 个可视化场景；4) 每场景约 ${sceneDuration} 秒；5) 不要 markdown 代码块；6) 不要“开场/中段/结尾”三段摘要；7) 强调角色外观与身份全程一致；8) 所有场景必须可被镜头直接拍出来。`,
    "必须体现：世界观建立、主角动机、冲突升级、高潮爆发、情绪收束。",
    "写作标准：镜头感强、动作清晰、环境具体、情绪推进明确、可分镜化。",
    `主题：${prompt}`,
  ].join("\n");
}

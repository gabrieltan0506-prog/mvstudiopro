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
    "你是 MVStudioPro 的电影编剧与叙事导演。",
    "请直接生成可拍摄、可分镜、可转视频的中文电影脚本。",
    `总字数尽量接近 ${targetWords} 字（允许约 ±10%）。`,
    `必须严格包含 ${targetScenes} 个连续场景，每个场景适配约 ${sceneDuration} 秒。`,
    "角色身份必须一致，禁止人物外观漂移。",
    "必须完整体现：世界观创建、冲突升级、高潮爆发、情绪收束。",
    "每个场景都要具备明确环境、动作、情绪和镜头可视化信息。",
    "禁止偷懒写成三段摘要，禁止只写概念，不要空洞形容词堆叠。",
    "不要输出 markdown，不要输出解释，不要输出代码块。",
    `主题：${prompt}`,
  ].join("\n");
}

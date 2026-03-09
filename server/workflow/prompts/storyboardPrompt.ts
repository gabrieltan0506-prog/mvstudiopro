export function buildStoryboardPrompt(input: {
  prompt: string;
  script: string;
  targetScenes?: number;
  sceneDuration?: number;
}) {
  const prompt = String(input.prompt || "").trim();
  const script = String(input.script || "").trim();
  const targetScenes = Number(input.targetScenes || 0) || 6;
  const sceneDuration = Number(input.sceneDuration || 0) || 5;

  return [
    "你是电影分镜导演。",
    "请将给定脚本转换为严格 JSON，且只能输出 JSON 本体，不允许 markdown、不允许解释、不允许额外文本。",
    "字段必须完整且不能为空，角色信息必须在所有 scenes 保持一致（same face, same outfit, same hairstyle, same identity）。",
    `scenes 数量必须严格等于 ${targetScenes}，sceneIndex 从 1 连续到 ${targetScenes}，每个 duration 必须是 ${sceneDuration}。`,
    "输出格式必须完全匹配：",
    "{",
    '  "storyTitle": "",',
    '  "genre": "",',
    '  "mainCharacter": {',
    '    "name": "",',
    '    "gender": "",',
    '    "age": "",',
    '    "appearance": "",',
    '    "outfit": ""',
    "  },",
    '  "scenes": [',
    "    {",
    '      "sceneIndex": 1,',
    '      "sceneTitle": "",',
    '      "scenePrompt": "",',
    '      "environment": "",',
    '      "character": "",',
    '      "camera": "",',
    '      "mood": "",',
    '      "lighting": "",',
    '      "action": "",',
    `      "duration": ${sceneDuration}`,
    "    }",
    "  ]",
    "}",
    `主题：${prompt}`,
    "脚本：",
    script,
  ].join("\n");
}

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
    "你是 MVStudioPro 的电影分镜导演。",
    "请把脚本转换为严格 JSON，且只能输出 JSON 本体。",
    "禁止 markdown、禁止解释、禁止额外文本。",
    `scenes 数量必须严格等于 ${targetScenes}，sceneIndex 从 1 到 ${targetScenes} 连续递增。`,
    `每个 scene 的 duration 必须填写 ${sceneDuration}。`,
    "所有 scene 字段都必须非空：sceneTitle/environment/character/action/camera/lighting/mood。",
    "角色一致性必须明确：same face, same outfit, same hairstyle, same identity across scenes。",
    "输出 JSON schema：",
    "{",
    '  \"storyTitle\": \"\",',
    '  \"genre\": \"\",',
    '  \"mainCharacter\": {',
    '    \"name\": \"\",',
    '    \"gender\": \"\",',
    '    \"age\": \"\",',
    '    \"appearance\": \"\",',
    '    \"outfit\": \"\",',
    '    \"hair\": \"\"',
    "  },",
    '  \"scenes\": [',
    "    {",
    '      \"sceneIndex\": 1,',
    '      \"sceneTitle\": \"\",',
    '      \"scenePrompt\": \"\",',
    '      \"environment\": \"\",',
    '      \"character\": \"\",',
    '      \"action\": \"\",',
    '      \"camera\": \"\",',
    '      \"lighting\": \"\",',
    '      \"mood\": \"\",',
    `      \"duration\": ${sceneDuration}`,
    "    }",
    "  ]",
    "}",
    `主题：${prompt}`,
    "脚本：",
    script,
  ].join("\n");
}

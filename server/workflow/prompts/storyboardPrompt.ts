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
    "请把脚本转换为严格 JSON，且只能输出 JSON 本体，所有字段内容必须使用简体中文。",
    "禁止 markdown、禁止解释、禁止额外文本。",
    `scenes 数量必须严格等于 ${targetScenes}，sceneIndex 从 1 到 ${targetScenes} 连续递增。`,
    `每个 scene 的 duration 必须填写 ${sceneDuration}。`,
    "所有 scene 字段都必须非空：sceneTitle/environment/character/action/camera/lighting/mood/primarySubject/renderStillNeeded/renderStillPrompt。",
    "角色一致性必须明确：同一角色在所有分镜中必须保持同一张脸、同一套服装、同一发型、同一身份。",
    "重要规则：每个 scene 的 character 与 primarySubject 只能描述一名主要人物，不能把多人一起写进 character。",
    "如果原脚本是多人同框或多人互动场景，请在 scenePrompt 中保留场景描述，但必须挑出一名最主要人物写进 primarySubject 和 character。",
    "如果 scene 涉及两人或两人以上同框、互动、合照、家庭群像、多人运动、多人表演，请把 renderStillNeeded 设为 true，并在 renderStillPrompt 中描述这张多人静态展示图。",
    "如果 scene 主要是单人镜头，则 renderStillNeeded 设为 false，renderStillPrompt 仍填写简短说明。",
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
    '      \"primarySubject\": \"\",',
    '      \"environment\": \"\",',
    '      \"character\": \"\",',
    '      \"action\": \"\",',
    '      \"camera\": \"\",',
    '      \"lighting\": \"\",',
    '      \"mood\": \"\",',
    '      \"renderStillNeeded\": false,',
    '      \"renderStillPrompt\": \"\",',
      `      \"duration\": ${sceneDuration}`,
    "    }",
    "  ]",
    "}",
    `主题：${prompt}`,
    "脚本：",
    script,
  ].join("\n");
}

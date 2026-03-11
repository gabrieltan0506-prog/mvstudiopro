function buildStoryboardPrompt(input) {
  const prompt = String(input.prompt || "").trim();
  const script = String(input.script || "").trim();
  const targetScenes = Number(input.targetScenes || 0) || 6;
  const sceneDuration = Number(input.sceneDuration || 0) || 5;
  return [
    "\u4F60\u662F MVStudioPro \u7684\u7535\u5F71\u5206\u955C\u5BFC\u6F14\u3002",
    "\u8BF7\u628A\u811A\u672C\u8F6C\u6362\u4E3A\u4E25\u683C JSON\uFF0C\u4E14\u53EA\u80FD\u8F93\u51FA JSON \u672C\u4F53\uFF0C\u6240\u6709\u5B57\u6BB5\u5185\u5BB9\u5FC5\u987B\u4F7F\u7528\u7B80\u4F53\u4E2D\u6587\u3002",
    "\u7981\u6B62 markdown\u3001\u7981\u6B62\u89E3\u91CA\u3001\u7981\u6B62\u989D\u5916\u6587\u672C\u3002",
    `scenes \u6570\u91CF\u5FC5\u987B\u4E25\u683C\u7B49\u4E8E ${targetScenes}\uFF0CsceneIndex \u4ECE 1 \u5230 ${targetScenes} \u8FDE\u7EED\u9012\u589E\u3002`,
    `\u6BCF\u4E2A scene \u7684 duration \u5FC5\u987B\u586B\u5199 ${sceneDuration}\u3002`,
    "\u6240\u6709 scene \u5B57\u6BB5\u90FD\u5FC5\u987B\u975E\u7A7A\uFF1AsceneTitle/environment/character/action/camera/lighting/mood\u3002",
    "\u89D2\u8272\u4E00\u81F4\u6027\u5FC5\u987B\u660E\u786E\uFF1A\u540C\u4E00\u89D2\u8272\u5728\u6240\u6709\u5206\u93E1\u4E2D\u5FC5\u9808\u4FDD\u6301\u540C\u4E00\u5F35\u81C9\u3001\u540C\u4E00\u5957\u670D\u88DD\u3001\u540C\u4E00\u9AEE\u578B\u3001\u540C\u4E00\u8EAB\u4EFD\u3002",
    "\u8F93\u51FA JSON schema\uFF1A",
    "{",
    '  "storyTitle": "",',
    '  "genre": "",',
    '  "mainCharacter": {',
    '    "name": "",',
    '    "gender": "",',
    '    "age": "",',
    '    "appearance": "",',
    '    "outfit": "",',
    '    "hair": ""',
    "  },",
    '  "scenes": [',
    "    {",
    '      "sceneIndex": 1,',
    '      "sceneTitle": "",',
    '      "scenePrompt": "",',
    '      "environment": "",',
    '      "character": "",',
    '      "action": "",',
    '      "camera": "",',
    '      "lighting": "",',
    '      "mood": "",',
    `      "duration": ${sceneDuration}`,
    "    }",
    "  ]",
    "}",
    `\u4E3B\u9898\uFF1A${prompt}`,
    "\u811A\u672C\uFF1A",
    script
  ].join("\n");
}
export {
  buildStoryboardPrompt
};

function buildVideoPrompt(input) {
  const sceneDuration = Number(input.sceneDuration || 0) || 5;
  const parts = [
    "\u7535\u5F71\u611F\u89C6\u9891\u955C\u5934",
    "\u9AD8\u8D28\u91CF\u5F71\u89C6\u5149\u5F71",
    "\u4E25\u683C\u4FDD\u6301\u53C2\u8003\u4EBA\u7269\u8EAB\u4EFD\u4E00\u81F4",
    "\u7981\u6B62\u4EBA\u7269\u8EAB\u4EFD\u6F02\u79FB",
    "\u4FDD\u6301\u52A8\u4F5C\u4E0E\u8FD0\u52A8\u8FDE\u7EED\u6027",
    `\u65F6\u957F\u7EA6 ${sceneDuration} \u79D2`,
    `\u573A\u666F\uFF1A${String(input.scenePrompt || "").trim()}`,
    `\u89D2\u8272\uFF1A${String(input.character || "").trim()}`,
    `\u52A8\u4F5C\uFF1A${String(input.action || "").trim()}`,
    `\u955C\u5934\u8FD0\u52A8\uFF1A${String(input.camera || "\u7535\u5F71\u611F\u955C\u5934\u8FD0\u52A8").trim()}`,
    `\u5149\u5F71\uFF1A${String(input.lighting || "\u7535\u5F71\u611F\u5149\u5F71").trim()}`,
    `\u60C5\u7EEA\uFF1A${String(input.mood || "\u7535\u5F71\u611F").trim()}`
  ].filter(Boolean);
  if (input.lockedCharacterPrompt) {
    parts.push(String(input.lockedCharacterPrompt).trim());
  }
  return parts.join("\uFF0C");
}
export {
  buildVideoPrompt
};

function buildStoryboardImagePrompt(input) {
  const parts = [
    "\u7535\u5F71\u611F\u5B9A\u683C\u753B\u9762",
    "\u4E13\u4E1A\u7535\u5F71\u955C\u5934",
    "\u6D45\u666F\u6DF1",
    "\u9AD8\u8D28\u91CF\u5149\u5F71",
    "\u89D2\u8272\u8EAB\u4EFD\u5728\u6240\u6709\u5206\u955C\u4E2D\u4FDD\u6301\u4E00\u81F4",
    "\u4FDD\u6301\u540C\u4E00\u5F20\u8138",
    "\u4FDD\u6301\u540C\u4E00\u5957\u670D\u88C5",
    "\u4FDD\u6301\u540C\u4E00\u9AEE\u578B",
    String(input.scenePrompt || "").trim(),
    `\u73AF\u5883\uFF1A${String(input.environment || "").trim()}`,
    `\u89D2\u8272\uFF1A${String(input.character || "").trim()}`,
    `\u52A8\u4F5C\uFF1A${String(input.action || "").trim()}`,
    `\u955C\u5934\uFF1A${String(input.camera || "").trim()}`,
    `\u5149\u5F71\uFF1A${String(input.lighting || "").trim()}`,
    `\u60C5\u7EEA\uFF1A${String(input.mood || "").trim()}`,
    "16:9 \u6784\u56FE",
    "\u8D85\u9AD8\u7EC6\u8282"
  ].filter(Boolean);
  if (input.lockedCharacterPrompt) {
    parts.push(String(input.lockedCharacterPrompt).trim());
  }
  if (input.referenceImageMode) {
    parts.push(`\u53C2\u8003\u56FE\u6A21\u5F0F\uFF1A${String(input.referenceImageMode).trim()}`);
  }
  return parts.join("\uFF0C");
}
export {
  buildStoryboardImagePrompt
};

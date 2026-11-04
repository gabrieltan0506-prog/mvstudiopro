/** 兼容已有草稿：隐藏零样本诊断句，不修改原始回执或补造已截断的文字。 */
export function topicDisplayText(value: string): string {
  return value.split(/(?<=[。！？\n])/).filter(sentence => {
    const platformDiagnostic = /Growth|小红书|抖音/i.test(sentence);
    const emptySample = /(?:(?<![0-9０-９])[0０零]\s*(?:条|个)?\s*(?:可用)?样本|(?:无|没有|未读取到|未读到)(?:可用|相关)?样本)/.test(sentence);
    return !(platformDiagnostic && emptySample);
  }).join("").trim();
}

/** 旧版曾硬切24字；只提示疑似缺失，不拼接或补造原文。 */
export function topicReasonDisplay(value: string | undefined): { text: string; incomplete: boolean } {
  const text = topicDisplayText(value || "");
  const stack: string[] = [];
  const pairs: Record<string, string> = { "（": "）", "(": ")", "【": "】", "[": "]", "“": "”", "‘": "’" };
  for (const char of text) {
    if (pairs[char]) stack.push(pairs[char]);
    else if (stack[stack.length - 1] === char) stack.pop();
  }
  return { text, incomplete: Boolean(text && (stack.length || !/[。！？.!?][”’」』）)]*$/.test(text))) };
}

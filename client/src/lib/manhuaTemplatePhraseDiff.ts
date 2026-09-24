export type TemplateTextPart = { text: string; changed: boolean };

/** 中文逐字、英文逐词对齐；相同文字不着色，只标试写模板版相对对照稿的改动。 */
export function compareTemplateText(before: string, after: string): { before: TemplateTextPart[]; after: TemplateTextPart[]; changed: boolean } {
  const tokenize = (value: string) => value.match(/[\u3400-\u9fff]|[A-Za-z0-9]+|\s+|[^\s]/g) || [];
  const left = tokenize(before);
  const right = tokenize(after);
  const dp = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = left[i] === right[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const beforeParts: TemplateTextPart[] = [];
  const afterParts: TemplateTextPart[] = [];
  const append = (parts: TemplateTextPart[], value: string, changed: boolean) => {
    const last = parts[parts.length - 1];
    if (last?.changed === changed) last.text += value;
    else parts.push({ text: value, changed });
  };
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      append(beforeParts, left[i++]!, false);
      append(afterParts, right[j++]!, false);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      append(beforeParts, left[i++]!, true);
    } else {
      append(afterParts, right[j++]!, true);
    }
  }
  while (i < left.length) append(beforeParts, left[i++]!, true);
  while (j < right.length) append(afterParts, right[j++]!, true);
  return { before: beforeParts, after: afterParts, changed: before !== after };
}

/** 位置采用 JavaScript UTF-16 索引，与输入框及 slice 保持一致。 */
export type KnowledgeCardTextReviewIssue = {
  id: string;
  start: number;
  end: number;
  original: string;
  suggestion?: string;
  kind: "ocr" | "typo" | "fluency" | "logic";
  reason: string;
  source: "rules" | "model";
  confidence: "high" | "medium" | "low";
};

const kinds = new Set(["ocr", "typo", "fluency", "logic"]);
const confidences = new Set(["high", "medium", "low"]);
const fields = new Set([
  "id",
  "start",
  "end",
  "original",
  "suggestion",
  "kind",
  "reason",
  "source",
  "confidence",
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const splitsSurrogate = (source: string, at: number) =>
  at > 0 &&
  at < source.length &&
  /[\uD800-\uDBFF]/.test(source[at - 1]!) &&
  /[\uDC00-\uDFFF]/.test(source[at]!);

/** 任一项格式或原文锚点错误即整体拒收，不能隐藏模型返回的坏条目。 */
export function validateKnowledgeCardReviewIssues(
  source: string,
  raw: unknown,
  origin: "rules" | "model"
): KnowledgeCardTextReviewIssue[] {
  if (typeof source !== "string" || (origin !== "rules" && origin !== "model"))
    throw new Error("校对来源参数无效");
  if (!Array.isArray(raw)) throw new Error("校对疑点必须是数组");
  for (let i = 0; i < raw.length; i++)
    if (!Object.prototype.hasOwnProperty.call(raw, i))
      throw new Error("校对疑点数组不能包含空项");
  const ids = new Set<string>();
  return raw.map((item, index) => {
    const invalid = () =>
      new Error(`第${index + 1}个校对疑点格式或原文锚点不一致`);
    if (
      !isRecord(item) ||
      [
        "id",
        "start",
        "end",
        "original",
        "kind",
        "reason",
        "source",
        "confidence",
      ].some(key => !Object.prototype.hasOwnProperty.call(item, key)) ||
      Object.keys(item).some(key => !fields.has(key))
    )
      throw invalid();
    if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id))
      throw invalid();
    if (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end))
      throw invalid();
    const start = item.start as number;
    const end = item.end as number;
    if (
      start < 0 ||
      end <= start ||
      end > source.length ||
      splitsSurrogate(source, start) ||
      splitsSurrogate(source, end)
    )
      throw invalid();
    if (
      typeof item.original !== "string" ||
      item.original !== source.slice(start, end)
    )
      throw invalid();
    if (typeof item.reason !== "string" || !item.reason.trim()) throw invalid();
    if (
      typeof item.kind !== "string" ||
      !kinds.has(item.kind) ||
      typeof item.confidence !== "string" ||
      !confidences.has(item.confidence) ||
      item.source !== origin
    )
      throw invalid();
    if (
      Object.prototype.hasOwnProperty.call(item, "suggestion") &&
      typeof item.suggestion !== "string"
    )
      throw invalid();
    ids.add(item.id);
    return {
      id: item.id,
      start,
      end,
      original: item.original,
      ...(typeof item.suggestion === "string"
        ? { suggestion: item.suggestion }
        : {}),
      kind: item.kind as KnowledgeCardTextReviewIssue["kind"],
      reason: item.reason,
      source: origin,
      confidence: item.confidence as KnowledgeCardTextReviewIssue["confidence"],
    };
  });
}

/** 规则只标记可疑内容；不推测原字，不自动改写数字、名称或术语。 */
export function ruleScanKnowledgeCardText(
  source: string
): KnowledgeCardTextReviewIssue[] {
  if (typeof source !== "string") throw new Error("待校对正文必须是文字");
  const issues: KnowledgeCardTextReviewIssue[] = [];
  function scan(
    pattern: RegExp,
    kind: KnowledgeCardTextReviewIssue["kind"],
    reason: string,
    confidence: KnowledgeCardTextReviewIssue["confidence"],
    anchorGroup = 0
  ) {
    for (const match of Array.from(source.matchAll(pattern))) {
      const original = match[anchorGroup]!;
      const start =
        match.index! + (anchorGroup ? match[0].indexOf(original) : 0);
      issues.push({
        id: `rules-${start}-${start + original.length}-${kind}`,
        start,
        end: start + original.length,
        original,
        kind,
        reason,
        source: "rules",
        confidence,
      });
    }
  }
  scan(
    /\uFFFD+/g,
    "ocr",
    "出现无法识别的替代字符，请对照原扫描页确认原字。",
    "high"
  );
  scan(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]+/g,
    "ocr",
    "出现异常控制字符，可能来自文字识别或文件解码，请核对原稿。",
    "high"
  );
  // 只提示汉字段内的单次换行；诗歌、列表、标题换行也可能合理，因此不直接提供替换。
  scan(
    /[\u3400-\u9FFF]([ \t]*\r?\n[ \t]*)(?=[\u3400-\u9FFF])/g,
    "fluency",
    "中文文字之间存在单次换行，请确认是段内误断行还是原文有意分行。",
    "low",
    1
  );
  scan(
    /[，,]{2,}|[。]{2,}|[；;]{2,}|[：:]{2,}|[？！!?]{3,}/g,
    "typo",
    "出现重复标点，可能是识别重复或有意强调，请结合上下文确认。",
    "low"
  );
  return validateKnowledgeCardReviewIssues(
    source,
    issues.sort((a, b) => a.start - b.start || a.end - b.end),
    "rules"
  );
}

/** 只应用同一份原文上用户明确选中的建议；所有检查通过后才执行替换。 */
export function applyKnowledgeCardReviewSuggestions(
  current: string,
  checkedSource: string,
  issues: KnowledgeCardTextReviewIssue[],
  selectedIds: string[]
): string {
  if (
    typeof current !== "string" ||
    typeof checkedSource !== "string" ||
    current !== checkedSource
  )
    throw new Error("正文已变化，请重新校对后再应用建议");
  if (
    !Array.isArray(issues) ||
    !Array.isArray(selectedIds) ||
    selectedIds.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new Error("所选校对疑点无效或重复");
  // 混合规则与模型结果仍逐项验证，但全局 ID 必须唯一。
  const allIds = new Set<string>();
  const validated = issues.map(issue => {
    if (
      !isRecord(issue) ||
      (issue.source !== "rules" && issue.source !== "model")
    )
      throw new Error("校对疑点来源无效");
    const item = validateKnowledgeCardReviewIssues(
      checkedSource,
      [issue],
      issue.source
    )[0]!;
    if (allIds.has(item.id)) throw new Error("校对疑点 ID 重复");
    allIds.add(item.id);
    return item;
  });
  const byId = new Map(validated.map(issue => [issue.id, issue]));
  const selected = selectedIds
    .map(id => {
      const issue = byId.get(id);
      if (!issue || typeof issue.suggestion !== "string")
        throw new Error("所选疑点缺少可应用的修改建议");
      return issue;
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < selected.length; i++)
    if (selected[i]!.start < selected[i - 1]!.end)
      throw new Error("所选修改范围重叠，请分别确认后重新校对");
  let result = current;
  for (let i = selected.length - 1; i >= 0; i--) {
    const issue = selected[i]!;
    result =
      result.slice(0, issue.start) + issue.suggestion + result.slice(issue.end);
  }
  return result;
}

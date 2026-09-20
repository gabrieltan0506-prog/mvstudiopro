export type SentenceDiffRow = { before: string; after: string; kind: "same" | "added" | "removed" | "changed" };
/** 保留标点、换行及全部正文；有界前瞻寻找相同句，避免长剧本的平方内存开销。 */
export function splitScriptSentences(text: string): string[] {
  return text.match(/[\s\S]+?(?:[。！？!?]+[”」’』"]*|\n+|$)/g) || [];
}
export function compareScriptSentences(before: string, after: string): SentenceDiffRow[] {
  const a = splitScriptSentences(before), b = splitScriptSentences(after);
  const rows: SentenceDiffRow[] = [];
  let i = 0, j = 0;
  const flush = (endA: number, endB: number) => {
    while (i < endA || j < endB) {
      const left = i < endA ? a[i++]! : "", right = j < endB ? b[j++]! : "";
      rows.push({ before: left, after: right, kind: left && right ? "changed" : left ? "removed" : "added" });
    }
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { rows.push({ before: a[i++]!, after: b[j++]!, kind: "same" }); continue; }
    let match: [number, number] | undefined;
    for (let distance = 1; distance <= 64 && !match; distance++) {
      for (let x = 0; x <= distance; x++) {
        const y = distance - x;
        if (i + x < a.length && j + y < b.length && a[i + x] === b[j + y]) { match = [i + x, j + y]; break; }
      }
    }
    if (match) flush(...match); else flush(i + 1, j + 1);
  }
  flush(a.length, b.length);
  return rows;
}

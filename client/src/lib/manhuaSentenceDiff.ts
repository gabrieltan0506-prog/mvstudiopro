export type SentenceDiffRow = { before: string; after: string; kind: "same" | "added" | "removed" | "changed" };
export type ScriptTextPart = { text: string; changed: boolean };

/** 句内按Unicode字符求公共子序列；只保留两行长度表，长稿不截字、不分配平方内存。 */
export function compareScriptCharacters(before: string, after: string): { before: ScriptTextPart[]; after: ScriptTextPart[] } {
  const a = Array.from(before), b = Array.from(after);
  const left: ScriptTextPart[] = [], right: ScriptTextPart[] = [];
  const append = (parts: ScriptTextPart[], text: string, changed: boolean) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.changed === changed) last.text += text;
    else parts.push({ text, changed });
  };
  const lengths = (x: string[], y: string[]) => {
    let previous = new Uint32Array(y.length + 1), current = new Uint32Array(y.length + 1);
    for (const char of x) {
      for (let j = 1; j <= y.length; j++) current[j] = char === y[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
      [previous, current] = [current, previous]; current.fill(0);
    }
    return previous;
  };
  const visit = (x: string[], y: string[]) => {
    let prefix = 0, suffix = 0;
    while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++;
    if (prefix) { const same = x.slice(0, prefix).join(""); append(left, same, false); append(right, same, false); }
    x = x.slice(prefix); y = y.slice(prefix);
    while (suffix < x.length && suffix < y.length && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix++;
    const tail = suffix ? x.slice(-suffix).join("") : "";
    if (suffix) { x = x.slice(0, -suffix); y = y.slice(0, -suffix); }
    if (!x.length || !y.length) {
      append(left, x.join(""), true); append(right, y.join(""), true);
    } else if (x.length === 1) {
      const index = y.indexOf(x[0]!);
      if (index < 0) { append(left, x[0]!, true); append(right, y.join(""), true); }
      else { append(right, y.slice(0, index).join(""), true); append(left, x[0]!, false); append(right, x[0]!, false); append(right, y.slice(index + 1).join(""), true); }
    } else {
      const characters = new Set(x);
      if (!y.some(char => characters.has(char))) { append(left, x.join(""), true); append(right, y.join(""), true); }
      else {
        const middle = Math.floor(x.length / 2);
        const forward = lengths(x.slice(0, middle), y), backward = lengths(x.slice(middle).reverse(), [...y].reverse());
        let split = 0, best = -1;
        for (let i = 0; i <= y.length; i++) { const score = forward[i]! + backward[y.length - i]!; if (score > best) { best = score; split = i; } }
        visit(x.slice(0, middle), y.slice(0, split)); visit(x.slice(middle), y.slice(split));
      }
    }
    if (tail) { append(left, tail, false); append(right, tail, false); }
  };
  visit(a, b);
  return { before: left, after: right };
}
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

/**
 * 两段中文正文的差异（纯函数，不依赖第三方库）。
 * 先按句（。！？…及换行）切分做 LCS 对齐；对不上的句块再做字级 LCS。
 * 句块过大时按句一一配对后再做字级比较，保证 4000 字量级在几十毫秒内完成。
 */
export type NovelDiffSegment = {
  type: "same" | "added" | "removed";
  text: string;
};
export type NovelTextDiff = {
  segments: NovelDiffSegment[];
  /** 新增字数 / 删除字数（不计空白）。 */
  added: number;
  removed: number;
  /** 改动占比 0–1：1 − 未改动字数 / 两版中较长一版的字数。 */
  changeRatio: number;
};

/** 字级 DP 的单块上限（两段长度之积）；超过时按句配对再比。 */
const CHAR_BLOCK_LIMIT = 600_000;

/** 按句切分，标点与换行留在句尾，拼回去与原文逐字相同。 */
export function splitNovelSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^。！？!?…\n]*(?:[。！？!?…]+[”」』"'’）)]*|\n+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      if (re.lastIndex >= text.length) break;
      re.lastIndex++;
      continue;
    }
    out.push(m[0]);
  }
  return out;
}

/** 通用 LCS 对齐：返回 [aIndex, bIndex] 匹配对（升序）。 */
function lcsPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean) {
  // 去掉公共前后缀，缩小 DP 规模。
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0) {
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * w + j] = eq(a[start + i], b[start + j])
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (eq(a[start + i], b[start + j])) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

function push(out: NovelDiffSegment[], type: NovelDiffSegment["type"], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

function diffChars(a: string, b: string, out: NovelDiffSegment[]) {
  const ac = Array.from(a);
  const bc = Array.from(b);
  const pairs = lcsPairs(ac, bc, (x, y) => x === y);
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    push(out, "removed", ac.slice(i, pi).join(""));
    push(out, "added", bc.slice(j, pj).join(""));
    push(out, "same", ac[pi]);
    i = pi + 1;
    j = pj + 1;
  }
  push(out, "removed", ac.slice(i).join(""));
  push(out, "added", bc.slice(j).join(""));
}

/** 一段对不上的句块：小块直接字级比较，大块按句配对后逐对比较。 */
function diffBlock(as: string[], bs: string[], out: NovelDiffSegment[]) {
  const a = as.join("");
  const b = bs.join("");
  if (!a || !b) {
    push(out, "removed", a);
    push(out, "added", b);
    return;
  }
  if (a.length * b.length <= CHAR_BLOCK_LIMIT) return diffChars(a, b, out);
  const k = Math.max(as.length, bs.length);
  for (let n = 0; n < k; n++) {
    const x = as[n] || "";
    const y = bs[n] || "";
    if (x && y && x.length * y.length <= CHAR_BLOCK_LIMIT) diffChars(x, y, out);
    else {
      push(out, "removed", x);
      push(out, "added", y);
    }
  }
}

const visible = (s: string) => s.replace(/\s+/g, "").length;

export function diffNovelText(original: string, revised: string): NovelTextDiff {
  const as = splitNovelSentences(original);
  const bs = splitNovelSentences(revised);
  const pairs = lcsPairs(as, bs, (x, y) => x === y);
  const segments: NovelDiffSegment[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    diffBlock(as.slice(i, pi), bs.slice(j, pj), segments);
    push(segments, "same", as[pi]);
    i = pi + 1;
    j = pj + 1;
  }
  diffBlock(as.slice(i), bs.slice(j), segments);
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const s of segments) {
    const n = visible(s.text);
    if (s.type === "added") added += n;
    else if (s.type === "removed") removed += n;
    else same += n;
  }
  const longest = Math.max(visible(original), visible(revised));
  return {
    segments,
    added,
    removed,
    changeRatio: longest ? Math.max(0, Math.min(1, 1 - same / longest)) : 0,
  };
}

/** 从差异片段还原某一版正文（same + 该侧片段），用于自检与按版渲染。 */
export function novelDiffSide(
  segments: NovelDiffSegment[],
  side: "original" | "revised"
) {
  return segments
    .filter(s => s.type === "same" || s.type === (side === "original" ? "removed" : "added"))
    .map(s => s.text)
    .join("");
}

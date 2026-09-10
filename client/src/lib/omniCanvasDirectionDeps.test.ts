/**
 * 源码级回归（审查 P1/P2）：OmniCanvas 里凡是读了导演法典/选卡的 useCallback、useEffect，
 * 依赖数组必须带上对应标识符。这类缺陷跑不出类型错误也过不了普通单测——
 * 回调捕获旧闭包，界面选了新卡，确认时仍冻结旧卡或空值。仓库没有 eslint react-hooks，
 * 这里用源码解析把这一类钉死。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(path.resolve(process.cwd(), "client/src/pages/OmniCanvas.tsx"), "utf8");
const LINES = SRC.split("\n");

/**
 * 找出每个 useCallback / useEffect 调用：从 `useCallback(` / `useEffect(` 起做括号配对，
 * 取整段调用文本；最后一个顶层 `[...]` 就是依赖数组，其余是回调体。
 * 两种书写都覆盖：`}, [a, b]);` 与 `  },
  [a, b],
);`
 */
function collectHooks(): Array<{ startLine: number; body: string; deps: string }> {
  const out: Array<{ startLine: number; body: string; deps: string }> = [];
  const re = /\b(useCallback|useEffect)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < SRC.length; i++) {
      const ch = SRC[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) continue;
    const call = SRC.slice(open + 1, end);
    // 最后一个顶层 [ ... ] 即依赖数组
    let d = 0, depsStart = -1;
    for (let i = call.length - 1; i >= 0; i--) {
      const ch = call[i];
      if (ch === "]") { if (d === 0) { d = 1; } else d++; }
      else if (ch === "[") { d--; if (d === 0) { depsStart = i; break; } }
    }
    const startLine = SRC.slice(0, m.index).split("\n").length;
    if (depsStart < 0) { out.push({ startLine, body: call, deps: "" }); continue; }
    out.push({ startLine, body: call.slice(0, depsStart), deps: call.slice(depsStart) });
  }
  return out;
}

const HOOKS = collectHooks();

describe("OmniCanvas 导演法典依赖完整性", () => {
  it("解析到足够多的 hook（解析器本身没坏）", () => {
    expect(HOOKS.length).toBeGreaterThan(20);
  });

  it.each(["activeDirectionCanon", "directionSelection"])(
    "读了 %s 的 hook，依赖数组必须带它",
    (ident) => {
      // 只算读状态变量本身；`session.directionSelection` 这类属性访问不需要进依赖
      const readRe = new RegExp(`(?<![.\\w])${ident}\\b`);
      const offenders = HOOKS.filter((h) => readRe.test(h.body) && !new RegExp(`(?<![.\\w])${ident}\\b`).test(h.deps)).map(
        (h) => `OmniCanvas.tsx:${h.startLine}`,
      );
      expect(offenders).toEqual([]);
    },
  );

  it("确认动作用同一份法典快照传 Bible 与铺板，不各读一次闭包", () => {
    const start = LINES.findIndex((l) => l.includes("const confirmWriterToDirector = useCallback"));
    expect(start).toBeGreaterThan(0);
    const body = LINES.slice(start, start + 260).join("\n");
    expect(body).toContain("const confirmedDirectionCanon = activeDirectionCanon;");
    expect((body.match(/directionCanon: confirmedDirectionCanon/g) || []).length).toBe(2);
    expect(body).not.toMatch(/directionCanon: activeDirectionCanon/);
  });
});

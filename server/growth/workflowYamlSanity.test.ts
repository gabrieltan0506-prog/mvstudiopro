/**
 * 工作流文件的结构自检（0912 事故后立）。
 *
 * 事故：给冷备工作流的步骤批量加 `if: env.BACKUP_DEFERRED != 'true'` 时，
 * 有两个步骤本来就带 `if`（一个 `${{ false }}` 停用、一个 `always()`），
 * 于是同一个映射里出现重复键。**PyYAML 默认容忍重复键、静默取最后一个**，
 * 本地校验因此全绿；GitHub 直接判整份文件非法，工作流连解析都过不去——
 * 定时冷备会一次都跑不起来，而失败记录里只有一句「workflow file issue」。
 *
 * 这条测试用严格解析（重复键报错）扫全部工作流，并顺带检查每个 step 至少有 run 或 uses。
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";

const dir = ".github/workflows";
const files = readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));

/**
 * 手工扫重复键：同一缩进层级、同一父块里出现两次相同键名。
 * 必须跳过块标量（`run: |`、`script: >` 之类）的正文——里面是 shell 或 JS，
 * `baseUrl:` 这种行不是 YAML 键，误报会把这条尺子变成噪音。
 */
function duplicateKeys(source: string): string[] {
  const stack: Array<{ indent: number; keys: Set<string>; path: string }> = [];
  const found: string[] = [];
  let blockIndent: number | null = null;
  source.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\t/g, "  ");
    if (blockIndent !== null) {
      if (!line.trim()) return;
      const indent = line.length - line.trimStart().length;
      if (indent > blockIndent) return;
      blockIndent = null;
    }
    if (!line.trim() || line.trim().startsWith("#")) return;
    const blockStart = line.match(/^(\s*)(?:-\s+)?[A-Za-z_][\w.-]*:\s*[|>][-+]?\s*$/);
    if (blockStart) {
      const indent = blockStart[1].length;
      const key = line.trim().split(":")[0]!;
      while (stack.length && stack[stack.length - 1]!.indent > indent) stack.pop();
      const top = stack[stack.length - 1];
      if (top && top.indent === indent) {
        if (top.keys.has(key)) found.push(`${key}（第 ${index + 1} 行，块 ${top.path}）`);
        else top.keys.add(key);
      }
      blockIndent = indent;
      return;
    }
    const match = line.match(/^(\s*)(-\s+)?([A-Za-z_][\w.-]*):(\s|$)/);
    if (!match) return;
    const indent = match[1].length + (match[2] ? match[2].length : 0);
    const key = match[3];
    // 列表项起一个新块
    if (match[2]) {
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
      stack.push({ indent, keys: new Set([key]), path: `${key}@${index + 1}` });
      return;
    }
    while (stack.length && stack[stack.length - 1]!.indent > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (top && top.indent === indent) {
      if (top.keys.has(key)) found.push(`${key}（第 ${index + 1} 行，块 ${top.path}）`);
      else top.keys.add(key);
      return;
    }
    stack.push({ indent, keys: new Set([key]), path: `${key}@${index + 1}` });
  });
  return found;
}

describe("GitHub 工作流文件结构自检", () => {
  it("能识别重复键（先证明这把尺子是准的）", () => {
    expect(duplicateKeys("jobs:\n  a:\n    x: 1\n    x: 2\n")).toHaveLength(1);
    expect(duplicateKeys("steps:\n  - name: a\n    if: always()\n  - name: b\n    if: false\n")).toEqual([]);
  });

  it.each(files)("%s 没有重复键（GitHub 会因此整份拒绝，定时任务一次都跑不起来）", file => {
    const source = readFileSync(nodePath.join(dir, file), "utf8");
    expect(duplicateKeys(source)).toEqual([]);
  });

  it.each(files)("%s 的每个 step 都有 run 或 uses", file => {
    const source = readFileSync(nodePath.join(dir, file), "utf8");
    const steps = source.split(/^\s{6}- name: /m).slice(1);
    const broken = steps
      .filter(step => !/^\s{8}(run:|uses:)/m.test(step))
      .map(step => step.split("\n")[0]);
    expect(broken).toEqual([]);
  });
});

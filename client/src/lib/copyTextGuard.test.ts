/**
 * 架构守门测试：防止裸剪贴板写入卷土重来。
 *
 * 背景：P0-2（复制失败伪装成功）之所以能在全仓扩散到十余处，是因为每个页面
 * 各写各的 `navigator.clipboard.writeText`，没有统一入口也没有防线。
 * 本测试把「只能从 @/lib/copyText 写剪贴板」变成会失败的红灯。
 *
 * 注意：readText（粘贴）不在管辖范围，允许直接调用。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CLIENT_SRC = path.resolve(import.meta.dirname, "..");

/** 唯一允许持有实现的文件 */
const IMPLEMENTATION_FILE = "lib/copyText.ts";

/**
 * 已知例外：暂不开发的页面，按用户 2026-08-18 指令不在本刀范围内改动。
 * 该页仍有 `navigator.clipboard?.writeText(url).catch(() => {})` + 无条件报「已复制」，
 * 属 P0-2 同型缺陷，待该页进入开发时一并迁移到 copyText 后，从本清单删除。
 *
 * 值 = 该文件当前**允许的裸写入处数**，不是「整份文件放行」——
 * 多出第二处就会让守门测试变红，防止例外文件继续长出新的裸写入。
 */
const KNOWN_EXCEPTIONS: Record<string, number> = {
  "pages/GodViewPage.tsx": 1,
};
const EXCEPTION_FILES = Object.keys(KNOWN_EXCEPTIONS);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // 只扫生产代码：测试文件里出现这些字样是桩/断言，不是真调用
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** 匹配写剪贴板：writeText / write，含可选链写法（?. 曾让上一版扫描漏网） */
const WRITE_PATTERN = /navigator\s*\??\.\s*clipboard\s*\??\.\s*(writeText|write)\s*\(/;
const EXEC_COPY_PATTERN = /document\s*\.\s*execCommand\s*\(\s*["'`]copy["'`]\s*\)/;

/** 数一份文件里的裸写入处数（writeText/write 与 execCommand("copy") 合并计数） */
function countRawWrites(text: string): number {
  const write = text.match(new RegExp(WRITE_PATTERN.source, "g"))?.length ?? 0;
  const exec = text.match(new RegExp(EXEC_COPY_PATTERN.source, "g"))?.length ?? 0;
  return write + exec;
}

describe("剪贴板写入单一真源守门", () => {
  const files = walk(CLIENT_SRC).map((f) => ({
    rel: path.relative(CLIENT_SRC, f).split(path.sep).join("/"),
    text: readFileSync(f, "utf8"),
  }));

  it("扫描到的源文件数量合理（防止 walk 失效导致空跑假绿）", () => {
    expect(files.length).toBeGreaterThan(100);
    // 确认实现文件本身在扫描范围内，否则规则形同虚设
    expect(files.some((f) => f.rel === IMPLEMENTATION_FILE)).toBe(true);
  });

  it("除 lib/copyText.ts 外不得直接调用 navigator.clipboard.writeText", () => {
    const offenders = files
      .filter((f) => f.rel !== IMPLEMENTATION_FILE)
      .filter((f) => !EXCEPTION_FILES.includes(f.rel))
      .filter((f) => WRITE_PATTERN.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("除 lib/copyText.ts 外不得直接调用 document.execCommand('copy')", () => {
    const offenders = files
      .filter((f) => f.rel !== IMPLEMENTATION_FILE)
      .filter((f) => !EXCEPTION_FILES.includes(f.rel))
      .filter((f) => EXEC_COPY_PATTERN.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("例外文件的裸写入处数必须与清单登记数完全一致（不许新增，也不许留过期条目）", () => {
    for (const [rel, allowed] of Object.entries(KNOWN_EXCEPTIONS)) {
      const hit = files.find((f) => f.rel === rel);
      expect(hit, `例外清单里的 ${rel} 不存在，请从清单删除`).toBeTruthy();
      const actual = countRawWrites(hit!.text);
      expect(
        actual,
        actual > allowed
          ? `${rel} 新增了裸写入（登记 ${allowed} 处，实测 ${actual} 处）——例外不是免死金牌，新代码必须走 copyText`
          : `${rel} 的裸写入已少于登记数（登记 ${allowed}，实测 ${actual}），请更新或删除例外条目`,
      ).toBe(allowed);
    }
  });

  it("readText（粘贴）不受限制，仍可直接使用", () => {
    const readers = files.filter((f) => /navigator\s*\??\.\s*clipboard\s*\??\.\s*readText/.test(f.text));
    expect(readers.length).toBeGreaterThan(0);
  });
});

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0928 生产事故回归：PR#1601 的兼容壳用 `export { 类型名, 值 } from` 转出，
 * tsc 与 vitest（vite-node）都放行，但生产启动命令 `tsx server/_core/index.ts`
 * 走逐文件转译 + 真实 Node ESM 具名链接，类型名找不到导出 → 进程启动即 exit 1。
 *
 * 所以这里**必须用 tsx 子进程真实加载**，不能在 vitest 进程内 import（那样恒绿，测不到）。
 * 覆盖：四个兼容壳 + 生产启动链上经过它们的模块
 * （server/_core/index.ts → server/routers.ts → shared/manhuaWriterRoom.ts
 *   → shared/manhuaStoryDistill.ts → shared/manhuaShotScheduler.ts）。
 */
const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

const MODULES = [
  "shared/manhuaCameraGrammar.ts",
  "shared/manhuaShotScheduler.ts",
  "shared/manhuaActionCameraRecipeBank.ts",
  "shared/manhuaPrevisCameraRecipe.ts",
  "shared/manhuaStoryDistill.ts",
  "shared/manhuaScriptVisualBrief.ts",
  "shared/manhuaWriterRoom.ts",
];

function loadUnderTsx(rel: string): { ok: boolean; out: string } {
  const spec = "./" + rel;
  try {
    const out = execFileSync(
      TSX,
      ["-e", `import(${JSON.stringify(spec)}).then(()=>process.stdout.write("LOADED"),(e)=>{process.stderr.write(String(e&&e.message||e));process.exit(1);})`],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
    );
    return { ok: out.includes("LOADED"), out };
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return { ok: false, out: String(e.stderr || e.message || error) };
  }
}

describe("镜头兼容壳在生产同款 tsx 运行时下可加载", () => {
  it("tsx 可执行文件存在（否则本测试没有测到任何东西）", () => {
    expect(existsSync(TSX)).toBe(true);
  });

  it.each(MODULES)("%s 真实加载不报具名导出缺失", (rel) => {
    const r = loadUnderTsx(rel);
    expect(r.out).not.toMatch(/does not provide an export named/);
    expect(r.ok).toBe(true);
  }, 90_000);
});

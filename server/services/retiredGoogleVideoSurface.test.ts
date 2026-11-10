import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Veo 与 Google Omni 淘汰面", () => {
  it("所有用户可见页面和模型注册表都不再提供入口", () => {
    for (const file of [
      "client/src/pages/CreativePage.tsx",
      "client/src/pages/TestLab.tsx",
      "client/src/pages/ResearchPage.tsx",
      "client/src/pages/WorkflowNodes.tsx",
      "client/src/lib/aiStudioRegistry.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/op=(?:veo|omni)|value=["']veo|createOp:\s*["']veo/i);
    }
  });

  it("旧 Google 视频 API 在任何上游调用前统一返回 410，且处理代码已删除（1110）", () => {
    const source = read("api/google.ts");
    const guard = source.indexOf("if (isRetiredGoogleVideoOp(op))");
    expect(guard).toBeGreaterThan(0);
    expect(source.slice(guard, guard + 400)).toContain("status(410)");
    // 410 之后不再保留不可达的 Veo / Omni / translateForVeo 处理分支，也不再引用 Omni 直连服务
    for (const op of ["veoCreate", "veoTask", "omniVideoCreate", "omniVideoTask", "omniMaterialUrl", "omniInteractionCreate", "omniInteractionGet", "translateForVeo"]) {
      expect(source, op).not.toMatch(new RegExp(`op\\s*===\\s*["']${op}["']`));
    }
    expect(source).not.toMatch(/geminiOmniVertexVideo|geminiOmniInteractions/);
    expect(fs.existsSync(path.join(root, "server/services/geminiOmniVertexVideo.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "server/services/geminiOmniInteractions.ts"))).toBe(false);
  });

  it("中央 Veo 服务固定不可用且每个执行函数首段均硬拒绝", () => {
    const source = read("server/veo.ts");
    expect(source).toContain("export function isVeoAvailable() {\n  return false;");
    expect(source.match(/rejectRetiredVeo\(\);/g)).toHaveLength(3);
  });
});

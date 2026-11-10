import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { testEvidenceDir } from "./testEvidenceDir";

it("缺省写系统临时目录，不落入库的 docs/evidence", () => {
  const dir = testEvidenceDir("code-motion-1011/images", {});
  expect(dir).toBe(path.join(tmpdir(), "mvstudiopro-test-evidence", "code-motion-1011/images"));
  expect(dir.startsWith(path.resolve("docs"))).toBe(false);
});
it("显式设 TEST_EVIDENCE_DIR 才写指定目录（含入库路径）；空白视为未设", () => {
  expect(testEvidenceDir("a/b", { TEST_EVIDENCE_DIR: "docs/evidence" })).toBe(path.resolve("docs/evidence/a/b"));
  expect(testEvidenceDir("a", { TEST_EVIDENCE_DIR: "  " })).toBe(path.join(tmpdir(), "mvstudiopro-test-evidence", "a"));
});
it("子目录不得越出根目录", () => {
  expect(() => testEvidenceDir("../../etc", {})).toThrow("不得越出");
});
it("测试文件不再把 docs/evidence 当写入目录（只读夹具与显式探针除外）", () => {
  const hits = execFileSync("git", ["grep", "-nE", "(resolve|mkdir|writeFile|path:)\\s*\\(?\\s*[\"'`]docs/evidence", "--", "*.test.ts", "*.test.tsx"], { encoding: "utf8" }).split("\n")
    .filter(line => line && !line.startsWith("shared/testEvidenceDir.test.ts") && !line.startsWith("server/services/manhuaVfxRender.blender.test.ts"));
  expect(hits).toEqual([]);
});

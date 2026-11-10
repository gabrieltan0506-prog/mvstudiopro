import { tmpdir } from "node:os";
import path from "node:path";

/** 设了才把测试证据写进指定目录；要刷新入库证据时显式设 TEST_EVIDENCE_DIR=docs/evidence。 */
export const TEST_EVIDENCE_DIR_ENV = "TEST_EVIDENCE_DIR" as const;

/**
 * 测试产出的截图 / 回执目录（仅测试用）。
 * 缺省落 os.tmpdir()/mvstudiopro-test-evidence/<子目录>，跑测试不再改写入库的 docs/evidence；
 * `sub` 是 docs/evidence 之下的相对路径，不得越出根目录。
 */
export function testEvidenceDir(sub: string, env: Record<string, string | undefined> = process.env): string {
  const configured = String(env[TEST_EVIDENCE_DIR_ENV] || "").trim();
  const root = configured ? path.resolve(configured) : path.join(tmpdir(), "mvstudiopro-test-evidence");
  const dir = path.resolve(root, sub);
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new Error("测试证据子目录不得越出根目录");
  return dir;
}

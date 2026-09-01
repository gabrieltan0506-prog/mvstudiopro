import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = [
  ".github/workflows/growth-archive-offload.yml",
  ".github/workflows/growth-backup.yml",
];

describe("growth archive workflow safety", () => {
  it.each(WORKFLOWS)(
    "%s 禁止自动删除，并通过 Fly shell 执行恢复验真",
    async relative => {
      const text = await fs.readFile(
        path.join(process.cwd(), relative),
        "utf8"
      );
      const deleteStep = text.match(
        /- name: Delete only release-verified unchanged(?: archive)? shards from Fly[\s\S]*?(?=\n {6}- name:)/
      )?.[0];

      expect(deleteStep).toContain("if: ${{ false }}");
      expect(deleteStep).toContain("仅 B站 + 冻结抓取 + 显式授权");
      expect(deleteStep).toContain(
        "-C \"sh -lc 'export GROWTH_GITHUB_OFFLOAD_CACHE_DIR="
      );
    }
  );
});

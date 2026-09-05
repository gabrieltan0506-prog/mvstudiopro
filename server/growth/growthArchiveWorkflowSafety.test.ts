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

describe("归档阶段有界执行", () => {
  it.each(WORKFLOWS)("%s 两入口共用守卫并限制收尾", async relative => {
    const text = await fs.readFile(path.join(process.cwd(), relative), "utf8");
    const download = text
      .split("- name: Download and verify archive bundles locally")[1]
      .split("\n      - name:")[0];
    expect(download).toContain("timeout-minutes: 30");
    expect(download).toContain(
      "node scripts/growth-archive-transfer.mjs -- flyctl"
    );
    expect(download).toContain('if [ "$transfer_status" -ne 75 ]');
    const cleanup = text.split(
      "- name: Always release archive hardlink snapshot"
    )[1];
    expect(cleanup).toContain("if: always()");
    expect(cleanup).toContain("timeout-minutes: 2");
    expect(cleanup).toContain("timeout --kill-after=5s 60s flyctl");
    expect(text).toContain("timeout-minutes: 120");
    expect(text).toContain("group: growth-cold-store-fly");
    expect(text).toContain("cancel-in-progress: false");
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const WORKFLOWS = [
  ".github/workflows/growth-archive-offload.yml",
  ".github/workflows/growth-backup.yml",
];

describe("growth archive workflow safety", () => {
  it.each(WORKFLOWS)(
    "%s 仅在备份与生产恢复验证成功后删除旧归档",
    async relative => {
      const text = await fs.readFile(
        path.join(process.cwd(), relative),
        "utf8"
      );
      const deleteStep = text.match(
        /- name: Delete only release-verified unchanged(?: archive)? shards from Fly[\s\S]*?(?=\n {6}- name:)/
      )?.[0] || "";

      expect(deleteStep).toMatch(/if: \$\{\{ success\(\)(?: && env\.BACKUP_DEFERRED != 'true')? \}\}/);
      expect(deleteStep).toContain("test -s /tmp/growth-archive-offload/DELETE_READY");
      expect(deleteStep).toContain("verified-assets.tsv");
      expect(deleteStep).toContain("manifest-assets.tsv");
      expect(deleteStep).toContain("growth-archive-restore-prefetch.mjs");
      expect(deleteStep).toContain("growthArchiveColdRestoreCli.ts $dir");
      expect(deleteStep.indexOf("growth-archive-restore-prefetch.mjs")).toBeLessThan(
        deleteStep.indexOf("growthArchiveColdRestoreCli.ts $dir")
      );
      expect(deleteStep.indexOf("growthArchiveColdRestoreCli.ts $dir")).toBeLessThan(
        deleteStep.indexOf("sh -s -- delete")
      );
      expect(deleteStep).toContain("'$source_fingerprint'");
      expect(deleteStep).toContain("UPLOAD_EMPTY");
      expect(deleteStep).toContain("names.slice(-2).includes(dir)");
      expect(deleteStep).toContain(
        "-C \"sh -lc 'export GROWTH_GITHUB_OFFLOAD_CACHE_DIR="
      );
    }
  );
  it.each(WORKFLOWS)("%s 对已备份旧分片也逐个回读、生产恢复后才删源", async relative => {
    const text = await fs.readFile(path.join(process.cwd(), relative), "utf8");
    const reusedStep = text.match(
      /- name: Restore-verify and delete bounded reused archive shards[\s\S]*?(?=\n {6}- name:)/
    )?.[0] || "";
    expect(reusedStep).toContain("reclaim.tsv");
    expect(reusedStep).toContain('gh release download "$manifest_tag"');
    expect(reusedStep).toContain('sha256sum "$readback"');
    expect(reusedStep).toContain("growth-archive-restore-prefetch.mjs");
    expect(reusedStep).toContain("growthArchiveColdRestoreCli.ts $dir");
    expect(reusedStep).toContain("sh -s -- delete '$BATCH_ID' '$dir' '$source_fingerprint'");
    expect(reusedStep).toContain("names.slice(-2).includes(dir)");
    expect(reusedStep.indexOf("gh release download")).toBeLessThan(
      reusedStep.indexOf("growth-archive-restore-prefetch.mjs")
    );
    expect(reusedStep.indexOf("growthArchiveColdRestoreCli.ts $dir")).toBeLessThan(
      reusedStep.indexOf("sh -s -- delete")
    );
  });
  it.each(WORKFLOWS)("%s 旧分片清单回读摘要错误时不调用 Fly 删源", async relative => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-reclaim-safety-"));
    try {
      const bin = path.join(root, "bin");
      const archive = path.join(root, "archive");
      await fs.mkdir(bin);
      await fs.mkdir(archive);
      await fs.writeFile(path.join(archive, "batch-id.txt"), "test-batch\n");
      const dir = "2026-08-30-00";
      const fingerprint = "a".repeat(64);
      const archiveSha = "b".repeat(64);
      const manifestName = `archive-${dir}.manifest.json`;
      const manifest = JSON.stringify({
        schemaVersion: 1, dir, sourceFingerprint: fingerprint,
        archive: { assetName: `archive-${dir}.tar.gz`, bytes: 100, sha256: archiveSha },
        parts: [{ assetName: `archive-${dir}.tar.gz`, bytes: 100, sha256: archiveSha, index: 0 }],
      });
      const manifestFile = path.join(root, manifestName);
      await fs.writeFile(manifestFile, manifest);
      await fs.writeFile(path.join(archive, "reclaim.tsv"), [
        dir, fingerprint, "100", `archive-${dir}.tar.gz`, "100", archiveSha,
        manifestName, String(Buffer.byteLength(manifest)), "c".repeat(64), "growth-cold-store-latest",
      ].join("\t") + "\n");
      await fs.writeFile(path.join(bin, "gh"), "#!/bin/sh\ncp \"$TEST_MANIFEST\" \"$TEST_ARCHIVE/reclaim-readback/$(basename \"$TEST_MANIFEST\")\"\n", { mode: 0o755 });
      await fs.writeFile(path.join(bin, "flyctl"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$TEST_FLY_CALLS\"\n", { mode: 0o755 });
      await fs.writeFile(path.join(bin, "stat"), "#!/bin/sh\ntest \"$1\" = '-c%s' && wc -c < \"$2\" | tr -d ' '\n", { mode: 0o755 });
      const workflow = await fs.readFile(path.join(process.cwd(), relative), "utf8");
      const step = workflow.match(/- name: Restore-verify and delete bounded reused archive shards[\s\S]*?(?=\n {6}- name:)/)?.[0];
      const script = step?.split("        run: |\n")[1]
        .replace(/^ {10}/gm, "")
        .replaceAll("/tmp/growth-archive-offload", archive);
      expect(script).toBeTruthy();
      const run = spawnSync("bash", ["-eo", "pipefail", "-c", script!], {
        cwd: process.cwd(), encoding: "utf8",
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`,
          TEST_MANIFEST: manifestFile, TEST_ARCHIVE: archive,
          TEST_FLY_CALLS: path.join(root, "fly-calls"),
          FLY_MACHINE_ID: "test-machine", GH_TOKEN: "test-key", FLY_API_TOKEN: "test-key",
        },
      });
      expect(run.status).not.toBe(0);
      await expect(fs.stat(path.join(root, "fly-calls"))).rejects.toThrow();
      const correctSha = createHash("sha256").update(manifest).digest("hex");
      const row = await fs.readFile(path.join(archive, "reclaim.tsv"), "utf8");
      await fs.writeFile(path.join(archive, "reclaim.tsv"), row.replace("c".repeat(64), correctSha));
      const verifiedRun = spawnSync("bash", ["-eo", "pipefail", "-c", script!], {
        cwd: process.cwd(), encoding: "utf8",
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`,
          TEST_MANIFEST: manifestFile, TEST_ARCHIVE: archive,
          TEST_FLY_CALLS: path.join(root, "fly-calls"),
          FLY_MACHINE_ID: "test-machine", GH_TOKEN: "test-key", FLY_API_TOKEN: "test-key",
        },
      });
      expect(verifiedRun.status, verifiedRun.stderr + verifiedRun.stdout).toBe(0);
      const calls = (await fs.readFile(path.join(root, "fly-calls"), "utf8")).trim().split("\n");
      expect(calls).toHaveLength(4);
      expect(calls[0]).toContain("--input-type=module");
      expect(calls[1]).toContain("growthArchiveColdRestoreCli.ts");
      expect(calls[2]).toContain("names.slice(-2).includes(dir)");
      expect(calls[2]).toContain('require("node:fs")');
      expect(calls[3]).toContain("sh -s -- delete");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("归档阶段有界执行", () => {
  it.each(WORKFLOWS)("%s 两入口共用守卫并限制收尾", async relative => {
    const text = await fs.readFile(path.join(process.cwd(), relative), "utf8");
    const download = text
      .split("- name: Download and verify archive bundles locally")[1]
      .split("\n      - name:")[0];
    expect(download).toContain("timeout-minutes: 30");
    expect(download).toContain(
      'node scripts/growth-archive-transfer.mjs --max-ms "$transfer_budget" -- flyctl'
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

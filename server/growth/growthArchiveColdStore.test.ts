import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeGrowthArchiveTarEntries,
  parseGrowthArchiveColdManifest,
} from "./trendStore";

const DIR = "2026-08-30-16";
const ARCHIVE = `archive-${DIR}.tar.gz`;
const SHA = "a".repeat(64);

describe("growth archive cold-store contract", () => {
  it("只接受可由生产端直接恢复的单一稳定名资产", () => {
    expect(parseGrowthArchiveColdManifest({
      schemaVersion: 1,
      dir: DIR,
      archive: { assetName: ARCHIVE, bytes: 123, sha256: SHA },
      parts: [{ assetName: ARCHIVE, bytes: 123, sha256: SHA, index: 0 }],
    }, DIR).archive.bytes).toBe(123);
  });

  it("拒绝分片、错 SHA、错目录与路径穿越", () => {
    expect(() => parseGrowthArchiveColdManifest({
      schemaVersion: 1,
      dir: DIR,
      archive: { assetName: ARCHIVE, bytes: 123, sha256: SHA },
      parts: [{ assetName: `${ARCHIVE}.part-0000`, bytes: 123, sha256: SHA, index: 0 }],
    }, DIR)).toThrow("growth_archive_manifest_invalid");
    expect(() => parseGrowthArchiveColdManifest({
      schemaVersion: 1,
      dir: "../../data",
      archive: { assetName: ARCHIVE, bytes: 123, sha256: "bad" },
      parts: [],
    }, DIR)).toThrow("growth_archive_manifest_invalid");
    expect(() => assertSafeGrowthArchiveTarEntries(DIR, `${DIR}/ok.json.gz\n../escape`)).toThrow("growth_archive_tar_path_invalid");
    expect(() => assertSafeGrowthArchiveTarEntries("../../data", "../../data/file")).toThrow("growth_archive_dir_invalid");
  });

  it("两条工作流都上传原名包、逐目录 manifest，并对分片关闭删除", async () => {
    for (const relative of [
      ".github/workflows/growth-archive-offload.yml",
      ".github/workflows/growth-backup.yml",
    ]) {
      const text = await fs.readFile(path.join(process.cwd(), relative), "utf8");
      expect(text).toContain('parts=("$output")');
      expect(text).toContain("manifest-assets.tsv");
      expect(text).toContain('manifest_asset="archive-$dir.manifest.json"');
      expect(text).toContain('if [ "$part_count" -ne 1 ] || [ "$direct_asset_count" -ne 1 ]');
      expect(text).toContain("growthArchiveColdRestoreCli.ts");
    }
  });
});

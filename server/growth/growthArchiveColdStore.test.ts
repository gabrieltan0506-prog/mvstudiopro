import { describe, expect, it } from "vitest";
import {
  assertSafeGrowthArchiveTarEntries,
  parseGrowthArchiveColdManifest,
} from "./trendStore";

const DIR = "2026-08-30-16";
const ARCHIVE = `archive-${DIR}.tar.gz`;
const SHA = "a".repeat(64);

describe("growth archive cold-store contract", () => {
  it("接受历史单一稳定名资产", () => {
    expect(parseGrowthArchiveColdManifest({
      schemaVersion: 1,
      dir: DIR,
      archive: { assetName: ARCHIVE, bytes: 123, sha256: SHA },
      parts: [{ assetName: ARCHIVE, bytes: 123, sha256: SHA, index: 0 }],
    }, DIR).archive.bytes).toBe(123);
  });

  it("拒绝不连续分片、错 SHA、错目录与路径穿越", () => {
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

  it("接受连续分片且总字节匹配的清单", () => {
    const parts = [0, 1].map(index => ({ assetName: `${ARCHIVE}.part-${String(index).padStart(4, "0")}`, bytes: 50, sha256: SHA, index }));
    expect(parseGrowthArchiveColdManifest({schemaVersion: 1, dir: DIR, archive: {assetName: ARCHIVE, bytes: 100, sha256: SHA}, parts}, DIR).parts).toHaveLength(2);
  });
});

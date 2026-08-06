import { describe, expect, it } from "vitest";
import {
  classifyManhuaAssetZipEntryPath,
  dedupeManhuaAssetZipEntriesByHash,
  planManhuaAssetZipImport,
} from "./manhuaAssetZipImportPlan.js";

describe("classifyManhuaAssetZipEntryPath", () => {
  it("classifies the six asset directories + script + manifest", () => {
    expect(classifyManhuaAssetZipEntryPath("characters/沈策.png")).toEqual({
      path: "characters/沈策.png",
      skip: false,
      category: "character",
    });
    expect(classifyManhuaAssetZipEntryPath("scenes/雁门关.png")).toMatchObject({
      category: "scene",
    });
    expect(classifyManhuaAssetZipEntryPath("props/道具设定01.png")).toMatchObject({
      category: "prop",
    });
    // costumes 并入道具，不单开一栏
    expect(classifyManhuaAssetZipEntryPath("costumes/黑色劲装.png")).toMatchObject({
      category: "prop",
    });
    expect(classifyManhuaAssetZipEntryPath("director_boards/第01集_导演分镜板.png")).toMatchObject(
      { category: "directorBoard" },
    );
    expect(classifyManhuaAssetZipEntryPath("script/第一集.md")).toMatchObject({
      category: "script",
    });
    expect(classifyManhuaAssetZipEntryPath("asset_canon.json")).toMatchObject({
      category: "manifest",
    });
    expect(classifyManhuaAssetZipEntryPath("manifest.json")).toMatchObject({
      category: "manifest",
    });
  });

  it("skips source_sheets/ as a duplicate of the split output", () => {
    const c = classifyManhuaAssetZipEntryPath("source_sheets/道具设定01.png");
    expect(c.skip).toBe(true);
    expect(c.skip && c.reason).toBe("sourceSheetsCopy");
  });

  it("filters .DS_Store and AppleDouble ._* by filename, not MIME", () => {
    expect(classifyManhuaAssetZipEntryPath(".DS_Store")).toMatchObject({
      skip: true,
      reason: "hiddenSystemFile",
    });
    expect(classifyManhuaAssetZipEntryPath("characters/.DS_Store")).toMatchObject({
      skip: true,
      reason: "hiddenSystemFile",
    });
    expect(classifyManhuaAssetZipEntryPath("characters/._沈策.png")).toMatchObject({
      skip: true,
      reason: "hiddenSystemFile",
    });
  });

  it("recognizes nested asset-pack paths (dir name appears at any depth)", () => {
    expect(
      classifyManhuaAssetZipEntryPath("_asset_pack_yanmen_ep01-06/assets/characters/沈策.png"),
    ).toMatchObject({ category: "character" });
  });

  it("marks unrecognized top-level junk as skipped", () => {
    const c = classifyManhuaAssetZipEntryPath("_workflow_run/tiles/random.png");
    expect(c.skip).toBe(true);
    expect(c.skip && c.reason).toBe("unrecognized");
  });
});

describe("planManhuaAssetZipImport", () => {
  it("classifies a realistic 6-episode asset pack listing without throwing on .DS_Store", () => {
    const paths = [
      ".DS_Store",
      "characters/._沈策.png",
      "characters/沈策.png",
      "characters/韩廷玉.png",
      "scenes/雁门关.png",
      "director_boards/第01集_导演分镜板.png",
      "props/道具设定01.png",
      "costumes/黑色劲装.png",
      "source_sheets/道具设定01.png",
      "script/第一集.md",
      "asset_canon.json",
      "_workflow_run/tiles/dup.png",
    ];
    const plan = planManhuaAssetZipImport(paths);
    expect(plan.byCategory.character).toEqual(["characters/沈策.png", "characters/韩廷玉.png"]);
    expect(plan.byCategory.scene).toEqual(["scenes/雁门关.png"]);
    expect(plan.byCategory.directorBoard).toEqual(["director_boards/第01集_导演分镜板.png"]);
    expect(plan.byCategory.prop).toEqual(["props/道具设定01.png", "costumes/黑色劲装.png"]);
    expect(plan.byCategory.script).toEqual(["script/第一集.md"]);
    expect(plan.byCategory.manifest).toEqual(["asset_canon.json"]);
    expect(plan.skipped.some((s) => s.path === ".DS_Store")).toBe(true);
    expect(plan.skipped.some((s) => s.path === "characters/._沈策.png")).toBe(true);
    expect(plan.skipped.some((s) => s.path === "source_sheets/道具设定01.png")).toBe(true);
  });
});

describe("dedupeManhuaAssetZipEntriesByHash", () => {
  it("keeps the first occurrence per content hash and drops the rest", () => {
    const entries = [
      { path: "characters/沈策.png", category: "character" as const, sha256: "aaa" },
      { path: "_asset_pack_x/assets/characters/沈策.png", category: "character" as const, sha256: "aaa" },
      { path: "_workflow_run/tiles/沈策.png", category: "character" as const, sha256: "aaa" },
      { path: "scenes/雁门关.png", category: "scene" as const, sha256: "bbb" },
    ];
    const { keep, dropped } = dedupeManhuaAssetZipEntriesByHash(entries);
    expect(keep.map((e) => e.path)).toEqual(["characters/沈策.png", "scenes/雁门关.png"]);
    expect(dropped).toEqual([
      { path: "_asset_pack_x/assets/characters/沈策.png", duplicateOfPath: "characters/沈策.png" },
      { path: "_workflow_run/tiles/沈策.png", duplicateOfPath: "characters/沈策.png" },
    ]);
  });

  it("does not dedupe entries with distinct hashes", () => {
    const entries = [
      { path: "characters/a.png", category: "character" as const, sha256: "aaa" },
      { path: "characters/b.png", category: "character" as const, sha256: "bbb" },
    ];
    const { keep, dropped } = dedupeManhuaAssetZipEntriesByHash(entries);
    expect(keep).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });
});

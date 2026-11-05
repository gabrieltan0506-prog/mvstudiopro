import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
const WORKFLOWS=[".github/workflows/growth-backup.yml",".github/workflows/growth-archive-offload.yml"];
describe("scheduled backups cannot authorize source or historical backup deletion",()=>{
 it.each(WORKFLOWS)("%s keeps reports and only retires sources through verified Fly restore",async file=>{
  const text=await fs.readFile(file,"utf8");
  expect(text).not.toContain("sh -s -- delete");
  expect(text).not.toContain("growth-release-headroom.sh");
  expect(text).not.toContain("prune-growth-release-batch-assets.sh");
  expect(text).toContain("growth-archive-retire.mjs --scope=bilibili-archives --allow-remote-download");
  expect(text.indexOf("- name: Retire verified Bilibili archive sources")).toBeGreaterThan(text.indexOf("- name: Always release archive hardlink snapshot"));
  expect(text).toContain("SNAPSHOT_RELEASED");
  expect(text).toContain("source-inventory.json");
  expect(text).toContain("anomalies.jsonl");
  expect(text).toContain("GROWTH_REQUIRE_SOURCE_INVENTORY=1");
  expect(text).toContain("group: growth-cold-store-fly");
  expect(text).toContain("cancel-in-progress: false");
  expect(text).toContain("node /app/scripts/growth-cold-store-routing-check.mjs");
  expect(text).toContain(".codeAndConfigurationReady == true and .metadataReadable == true and .restoreVerified == false");
  // 工作流调用部署门禁，门禁再加载实际还原器；不能把模块加载冒充还原完成。
  const gate=await fs.readFile("scripts/growth-cold-store-routing-check.mjs","utf8");
  expect(gate).toContain('"shared/growthArchiveRestore.mjs"');
  expect(gate).toContain("await import(pathToFileURL(path.join(root, relative)).href)");
 });
 it("ordinary backup publishes one immutable generation and reports incomplete coverage",async()=>{
  const text=await fs.readFile(WORKFLOWS[0],"utf8");
  expect(text).toContain("node scripts/growth-backup-generation.mjs");
  expect(text).not.toContain("--clobber");
  expect(text).toContain(".coreFiles[]");
  expect(text).toContain("fullStoreComplete!==true");
  expect(text).not.toMatch(/capture_directory_from_fly[^\n]+\|\| true/);
 });
});

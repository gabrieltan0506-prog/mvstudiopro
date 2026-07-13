import { describe, expect, it } from "vitest";
import {
  MEDICAL_RESOURCE_SITES,
  buildMedicalResourcePromptBlock,
  ensureMedicalResourceCiteInCopy,
  formatMedicalResourceCite,
  inferMedicalAudience,
  listMedicalResourceHubs,
  pickMedicalResources,
  textHasMedicalResourceCite,
} from "../../shared/medicalResourceLibrary.js";
import { composePlatformSkillsPromptBlock, parsePlatformSkillMarkdown } from "../../shared/platformSkills.js";
import { routePlatformSkillIds, PLATFORM_SKILL_ROUTER_CORE_IDS } from "../../shared/platformSkillRouter.js";

describe("medicalResourceLibrary", () => {
  it("lists verified hubs for all catalog sites", () => {
    const hubs = listMedicalResourceHubs();
    expect(hubs.length).toBe(MEDICAL_RESOURCE_SITES.length);
    expect(hubs.map((h) => h.id)).toContain("msd-home");
    expect(hubs.map((h) => h.id)).toContain("medlineplus");
    expect(hubs.find((h) => h.id === "msd-home")?.hubUrl).toContain("/home/resource");
  });

  it("uses biodigital for consumer 3D, not dead 3d-models path", () => {
    const msd = MEDICAL_RESOURCE_SITES.find((s) => s.id === "msd-home")!;
    expect(msd.secondaryUrls?.biodigital3d).toContain("/biodigital");
    expect(msd.caveats?.some((c) => c.includes("3d-models"))).toBe(true);
  });

  it("marks medlineplus videosandtutorials as dead in caveats", () => {
    const mp = MEDICAL_RESOURCE_SITES.find((s) => s.id === "medlineplus")!;
    expect(mp.secondaryUrls?.anatomyVideos).toContain("anatomyvideos.html");
    expect(mp.caveats?.join(" ")).toMatch(/videosandtutorials/);
  });

  it("builds MSD / MedlinePlus / Radiopaedia search URLs", () => {
    const msd = MEDICAL_RESOURCE_SITES.find((s) => s.id === "msd-home")!;
    expect(msd.buildSearchUrl?.("胰岛素")).toContain("SearchResults?query=");
    expect(msd.buildSearchUrl?.("胰岛素")).toContain(encodeURIComponent("胰岛素"));

    const mp = MEDICAL_RESOURCE_SITES.find((s) => s.id === "medlineplus")!;
    expect(mp.buildSearchUrl?.("insulin")).toContain("medlineplus");
    expect(mp.buildSearchUrl?.("insulin")).toContain("insulin");

    const rp = MEDICAL_RESOURCE_SITES.find((s) => s.id === "radiopaedia")!;
    expect(rp.buildSearchUrl?.("pneumothorax")).toContain("radiopaedia.org/search");
  });

  it("picks CardioSmart for heart topics and Radiopaedia for imaging", () => {
    const cardio = pickMedicalResources({ topic: "房颤和支架术后要注意什么", max: 4 });
    expect(cardio.some((p) => p.siteId === "cardiosmart")).toBe(true);
    expect(cardio[0]?.searchUrl || cardio[0]?.hubUrl).toMatch(/^https?:\/\//);

    const radio = pickMedicalResources({ topic: "气胸 CT 怎么读片", audience: "professional", max: 4 });
    expect(radio.some((p) => p.siteId === "radiopaedia")).toBe(true);
    expect(inferMedicalAudience("专业版临床计算器鉴别诊断")).toBe("professional");
  });

  it("formats cite and patches copy when missing", () => {
    const pick = pickMedicalResources({ topic: "急救海姆立克", max: 1 })[0]!;
    const cite = formatMedicalResourceCite(pick);
    expect(cite).toMatch(/公开资源可对照/);
    expect(cite).toMatch(/http/);

    expect(textHasMedicalResourceCite("随便说说")).toBe(false);
    const patched = ensureMedicalResourceCiteInCopy({
      copywriting: "今天讲海姆立克急救，先别慌。",
      topic: "急救",
      force: true,
    });
    expect(patched.patched).toBe(true);
    expect(textHasMedicalResourceCite(patched.copywriting)).toBe(true);
  });

  it("prompt block bans known dead links and encodes mk high-engagement shell", () => {
    const block = buildMedicalResourcePromptBlock({ topic: "医学科普 3D 可视化" });
    expect(block).toContain("biodigital");
    expect(block).toContain("videosandtutorials.html");
    expect(block).toContain("msd-home");
    expect(block).toMatch(/高赞壳|谁写谁火|3D讲清/);
  });
});

describe("medical skill wiring", () => {
  const pool = [
    ...PLATFORM_SKILL_ROUTER_CORE_IDS,
    "crossover-popsci",
    "medical-resource-library",
    "authority-cite-endorsement",
    "director-craft",
  ];

  it("routes 医学科普 context to medical-resource-library", () => {
    const r = routePlatformSkillIds({
      poolIds: pool,
      context: "医学科普：默沙东 3D 可视化讲清发病原理",
      sheetKind: "video",
    });
    expect(r.primaryLane).toBe("crossover");
    expect(r.selectedIds).toContain("medical-resource-library");
    expect(r.selectedIds).toContain("crossover-popsci");
  });

  it("composePlatformSkillsPromptBlock appends live URL block", () => {
    const skill = parsePlatformSkillMarkdown(
      `---
id: medical-resource-library
name: 医学多媒体资源库
description: test
defaultEnabled: true
---
body`,
      { id: "medical-resource-library", source: "builtin" },
    );
    const block = composePlatformSkillsPromptBlock([skill], { topicHint: "胰岛素 3D" });
    expect(block).toContain("医学多媒体资源库");
    expect(block).toContain("msdmanuals.cn");
    expect(block).toContain("biodigital");
  });
});

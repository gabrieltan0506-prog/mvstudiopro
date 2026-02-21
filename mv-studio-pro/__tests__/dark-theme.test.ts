import { describe, it, expect } from "vitest";
import { themeColors } from "../theme.config";
import * as fs from "fs";
import * as path from "path";

describe("Dark Theme Configuration (Suno.com style)", () => {
  it("should have dark background colors", () => {
    expect(themeColors.background.light).toBe("#101012");
    expect(themeColors.background.dark).toBe("#101012");
  });

  it("should have warm primary color matching Suno.com style", () => {
    expect(themeColors.primary.light).toBe("#E8825E");
    expect(themeColors.primary.dark).toBe("#E8825E");
  });

  it("should have dark surface color", () => {
    expect(themeColors.surface.light).toBe("#1A1A1D");
    expect(themeColors.surface.dark).toBe("#1A1A1D");
  });

  it("should have warm off-white foreground text color", () => {
    expect(themeColors.foreground.light).toBe("#F7F4EF");
    expect(themeColors.foreground.dark).toBe("#F7F4EF");
  });

  it("should have accent color defined", () => {
    expect(themeColors.accent).toBeDefined();
    expect(themeColors.accent.light).toBe("#C77DBA");
  });

  it("should have cyan color defined", () => {
    expect(themeColors.cyan).toBeDefined();
    expect(themeColors.cyan.light).toBe("#64D2FF");
  });
});

describe("Coming-soon pages have correct structure", () => {
  // mv-compare is still a coming-soon page
  const comingSoonPages = [
    "app/mv-compare.tsx",
  ];

  comingSoonPages.forEach((pagePath) => {
    it(`${pagePath} should contain "即將推出" text`, () => {
      const fullPath = path.resolve(__dirname, "..", pagePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).toContain("即将推出");
    });

    it(`${pagePath} should have a back button`, () => {
      const fullPath = path.resolve(__dirname, "..", pagePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).toContain("返回");
    });

    it(`${pagePath} should use Suno-style dark theme colors`, () => {
      const fullPath = path.resolve(__dirname, "..", pagePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).toContain("#F7F4EF");
      expect(content).toContain("#E8825E");
    });
  });

  // intro-preview is now a full functional page with templates
  it("app/intro-preview.tsx should have intro animation templates", () => {
    const fullPath = path.resolve(__dirname, "..", "app/intro-preview.tsx");
    const content = fs.readFileSync(fullPath, "utf-8");
    expect(content).toContain("INTRO_TEMPLATES");
    expect(content).toContain("useRouter");
  });
});

describe("Functional pages have correct structure", () => {
  it("analyze.tsx should have upload functionality", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/analyze.tsx"),
      "utf-8"
    );
    expect(content).toContain("上传");
    expect(content).toContain("analyzeFrame");
    expect(content).toContain("fileInputRef");
  });

  it("avatar.tsx should have generation functionality", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/avatar.tsx"),
      "utf-8"
    );
    expect(content).toContain("生成");
    expect(content).toContain("virtualIdol");
    expect(content).toContain("generateMutation");
  });

  it("effects.tsx should have filter and effects functionality", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/effects.tsx"),
      "utf-8"
    );
    expect(content).toContain("FILTERS");
    expect(content).toContain("EFFECTS");
    expect(content).toContain("TRANSITIONS");
    expect(content).toContain("filterIntensity");
    expect(content).toContain("导出特效方案");
  });

  it("publish.tsx should have multi-platform publishing functionality", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/publish.tsx"),
      "utf-8"
    );
    expect(content).toContain("PLATFORMS");
    expect(content).toContain("小红书");
    expect(content).toContain("B站");
    expect(content).toContain("抖音");
    expect(content).toContain("视频号");
    expect(content).toContain("CONTENT_TEMPLATES");
    expect(content).toContain("一键拷贝全部内容");
  });
});

describe("Homepage structure", () => {
  it("should have MV gallery link", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("mv-gallery");
    expect(content).toContain("视频展厅");
  });

  it("should have contact section", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("contact-section");
    expect(content).toContain("GuestbookSection");
  });

  it("should have feature cards section", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("FEATURES");
  });

  it("should use dark background colors", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("#120818");
    expect(content).toContain("#140D1A");
  });

  it("should have aurora gradient effects", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("heroOrb");
    expect(content).toContain("radial-gradient");
  });

  it("should have gradient CTA button", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("linear-gradient");
  });

  it("should have multi-color MV showcase with play buttons", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("MV_SHOWCASE");
    expect(content).toContain("handlePlayMV");
    expect(content).toContain("mvPlay");
  });

  it("should have colorful section dividers", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("rainbowBar");
    expect(content).toContain("#FF6B6B");
    expect(content).toContain("#64D2FF");
    expect(content).toContain("#C77DBA");
    expect(content).toContain("#30D158");
  });
});

describe("Vercel routing config", () => {
  it("should have SPA fallback rewrite", () => {
    const config = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf-8")
    );
    const rewrites = config.rewrites;
    expect(rewrites).toBeDefined();
    expect(rewrites.length).toBeGreaterThanOrEqual(2);
    const spaRewrite = rewrites.find((r: any) => r.destination === "/index.html");
    expect(spaRewrite).toBeDefined();
  });
});

describe("Global CSS", () => {
  it("should set Suno-style dark background on html and body", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../global.css"),
      "utf-8"
    );
    expect(content).toContain("background-color: #101012");
  });

  it("should have dark scrollbar styling", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../global.css"),
      "utf-8"
    );
    expect(content).toContain("scrollbar");
  });

  it("should have multi-color animation keyframes", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../global.css"),
      "utf-8"
    );
    expect(content).toContain("rainbowGlow");
    expect(content).toContain("auroraFloat");
    expect(content).toContain("shimmer");
  });
});

describe("Play button consistency", () => {
  it("should use MaterialIcons play-arrow in MV gallery", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/mv-gallery.tsx"),
      "utf-8"
    );
    expect(content).toContain("MaterialIcons");
    expect(content).toContain("play-arrow");
  });

  it("should use MaterialIcons play-arrow on homepage", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/(tabs)/index.tsx"),
      "utf-8"
    );
    expect(content).toContain("MaterialIcons");
    expect(content).toContain("play-arrow");
  });

  it("MV gallery play button should have circular style", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../app/mv-gallery.tsx"),
      "utf-8"
    );
    expect(content).toContain("playCircle");
    expect(content).toContain("borderRadius");
  });
});

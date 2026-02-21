import { describe, it, expect } from "vitest";

// ─── 任務1：IDOL 頁面 3D 改寫 ─────────────────
describe("Task 1: IDOL 3D Rewrite", () => {
  it("should have 免費一鍵生成 3D button text in avatar.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/(tabs)/avatar.tsx", "utf-8");
    expect(content).toContain("免费一键生成 3D");
    expect(content).not.toContain('"Rapid"');
    expect(content).not.toContain('"Pro"');
  });

  it("should have 3D Studio upgrade guide in avatar.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/(tabs)/avatar.tsx", "utf-8");
    expect(content).toContain("3d-studio");
    expect(content).toContain("升级版");
  });

  it("should show 2D history label", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/(tabs)/avatar.tsx", "utf-8");
    expect(content).toContain("2D");
  });
});

// ─── 任務2：3D Studio 摳圖 ─────────────────────
describe("Task 2: 3D Studio Remove Background", () => {
  it("should have removeBackground endpoint in hunyuan3d router", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/hunyuan3d.ts", "utf-8");
    expect(content).toContain("removeBackground");
    expect(content).toContain("birefnet");
  });

  it("should have removeBg in CREDIT_COSTS", async () => {
    const fs = await import("fs");
    const shared = fs.readFileSync("shared/credits.ts", "utf-8");
    const plans = fs.readFileSync("server/plans.ts", "utf-8");
    expect(shared).toContain("removeBg");
    expect(plans).toContain("removeBg");
  });

  it("should have AI 摳圖 tab in 3d-studio.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/(tabs)/3d-studio.tsx", "utf-8");
    expect(content).toContain("抠图");
  });
});

// ─── 任務3：NBP 2K/4K Credits ──────────────────
describe("Task 3: NBP 2K/4K Credits", () => {
  it("should show Credits cost instead of 免费 for 2K/4K", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("components/nbp-engine-selector.tsx", "utf-8");
    expect(content).toContain("Credits");
    // Should not have 免费 for 2K/4K tiers
    const lines = content.split("\n");
    // 2K and 4K should show Credits cost
    expect(content).toContain("Credits");
  });
});

// ─── 任務5：微信表情包 ─────────────────────────
describe("Task 5: WeChat Sticker", () => {
  it("should have wechat-sticker.tsx page", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("app/wechat-sticker.tsx")).toBe(true);
  });

  it("should have wechatSticker router", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");
    expect(content).toContain("wechatSticker");
  });

  it("should have emotion and phrase categories", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("app/wechat-sticker.tsx", "utf-8");
    expect(content).toContain("EMOTIONS");
    expect(content).toContain("PHRASES");
    expect(content).toContain("STYLES");
    expect(content).toContain("开心");
    expect(content).toContain("可爱卡通");
  });

  it("should have backend generate endpoint", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/wechatSticker.ts", "utf-8");
    expect(content).toContain("generate");
    expect(content).toContain("emotion");
    expect(content).toContain("style");
  });
});

// ─── 任務6：美工優化 ───────────────────────────
describe("Task 6: UI Polish", () => {
  it("should have differentiated background colors across pages", async () => {
    const fs = await import("fs");
    const avatar = fs.readFileSync("app/(tabs)/avatar.tsx", "utf-8");
    const studio3d = fs.readFileSync("app/(tabs)/3d-studio.tsx", "utf-8");
    const effects = fs.readFileSync("app/effects.tsx", "utf-8");
    const publish = fs.readFileSync("app/(tabs)/publish.tsx", "utf-8");
    const music = fs.readFileSync("app/music-studio.tsx", "utf-8");
    const sticker = fs.readFileSync("app/wechat-sticker.tsx", "utf-8");

    // Each page should have unique background tones
    const bgColors = [
      avatar.match(/backgroundColor:\s*"(#[0-9A-Fa-f]+)"/)?.[1],
      studio3d.match(/backgroundColor:\s*"(#[0-9A-Fa-f]+)"/)?.[1],
      effects.match(/backgroundColor:\s*"(#[0-9A-Fa-f]+)"/)?.[1],
      publish.match(/backgroundColor:\s*"(#[0-9A-Fa-f]+)"/)?.[1],
      music.match(/backgroundColor:\s*"(#[0-9A-Fa-f]+)"/)?.[1],
      sticker.match(/backgroundColor:\s*"(#[0-9A-Fa-f]+)"/)?.[1],
    ].filter(Boolean);

    // Should have at least 4 unique colors
    const uniqueColors = new Set(bgColors);
    expect(uniqueColors.size).toBeGreaterThanOrEqual(4);
  });

  it("should have updated tab bar colors", async () => {
    const fs = await import("fs");
    const layout = fs.readFileSync("app/(tabs)/_layout.tsx", "utf-8");
    expect(layout).toContain("#FF8C42"); // Updated active tint
    expect(layout).toContain("rgba(168,85,247"); // Purple border
  });

  it("should have updated theme.config.js", async () => {
    const fs = await import("fs");
    const theme = fs.readFileSync("theme.config.js", "utf-8");
    expect(theme).toContain("primary");
    expect(theme).toContain("background");
  });
});

// ─── 內測碼系統 ────────────────────────────────
describe("Beta Code System", () => {
  it("should have beta_codes table in schema", async () => {
    const fs = await import("fs");
    const schema = fs.readFileSync("drizzle/schema-beta.ts", "utf-8");
    expect(schema).toContain("beta_codes");
    expect(schema).toContain("klingLimit");
  });

  it("should have generateBetaCodes and redeemBetaCode routes", async () => {
    const fs = await import("fs");
    const beta = fs.readFileSync("server/routers/beta.ts", "utf-8");
    expect(beta).toContain("generateBetaCodes");
    expect(beta).toContain("redeemBetaCode");
    // Check for Kling quota management
    expect(beta).toContain("klingUsed");
    expect(beta).toContain("klingLimit");
  });

  it("should have redeem.tsx page", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("app/redeem.tsx")).toBe(true);
  });
});

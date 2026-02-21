import { describe, expect, it, vi } from "vitest";

/**
 * Suno 音乐工作室测试
 *
 * 测试覆盖：
 * 1. 后端路由完整性
 * 2. 前端页面文件存在
 * 3. Simple / Custom 双模式 UI
 * 4. 风格标签和情绪标签
 * 5. 引擎选择（V4/V5）
 * 6. AI 歌词助手
 * 7. 首页入口
 */

// Mock dependencies
vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "[Verse]\n测试歌词" } }],
  }),
  invokeLLMFlash: vi.fn(),
  invokeLLMPro: vi.fn(),
}));

vi.mock("../server/_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("../server/_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://forge.example.com",
    forgeApiKey: "test-key",
    databaseUrl: "",
    appId: "test",
    cookieSecret: "test",
    oAuthServerUrl: "",
    ownerOpenId: "",
    isProduction: false,
  },
}));

describe("Music Studio - Suno Integration", () => {
  describe("Backend Routes", () => {
    it("should have suno router with all required procedures", async () => {
      const mod = await import("../server/routers/suno");
      expect(mod.sunoRouter).toBeDefined();
      expect(mod.sunoRouter._def).toBeDefined();
    });

    it("should have BGM style presets defined", async () => {
      const mod = await import("../server/routers/suno");
      expect(mod.BGM_STYLE_PRESETS).toBeDefined();
      expect(mod.BGM_STYLE_PRESETS.length).toBeGreaterThan(10);
    });

    it("should include Chinese Traditional and Japanese Anime styles", async () => {
      const mod = await import("../server/routers/suno");
      const ids = mod.BGM_STYLE_PRESETS.map(p => p.id);
      expect(ids).toContain("chinese_traditional");
      expect(ids).toContain("japanese_anime");
    });

    it("should have V4 and V5 model support in router file", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/suno.ts"),
        "utf-8"
      );
      expect(content).toContain('V4');
      expect(content).toContain('V5');
      expect(content).toContain("generateMusic");
      expect(content).toContain("generateLyrics");
      expect(content).toContain("getTaskStatus");
      expect(content).toContain("getStylePresets");
      expect(content).toContain("getCreditCosts");
    });

    it("should have correct credit costs for Suno", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/plans.ts"),
        "utf-8"
      );
      expect(content).toContain("sunoMusicV4: 12");
      expect(content).toContain("sunoMusicV5: 22");
      expect(content).toContain("sunoLyrics: 3");
    });
  });

  describe("Frontend - Music Studio Page", () => {
    it("should have music-studio.tsx page file", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const exists = fs.existsSync(
        path.resolve(__dirname, "../app/music-studio.tsx")
      );
      expect(exists).toBe(true);
    });

    it("should have Simple and Custom mode toggle", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain('"simple"');
      expect(content).toContain('"custom"');
      expect(content).toContain("Simple");
      expect(content).toContain("Custom");
      expect(content).toContain("modeSwitch");
    });

    it("should have V4 and V5 engine selector", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("engineSwitch");
      expect(content).toContain('"V4"');
      expect(content).toContain('"V5"');
      expect(content).toContain("12C");
      expect(content).toContain("22C");
    });

    it("should have style tags with emojis", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("STYLE_TAGS");
      expect(content).toContain("流行");
      expect(content).toContain("摇滚");
      expect(content).toContain("中国风");
      expect(content).toContain("Lo-Fi");
    });

    it("should have mood tags", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("MOOD_TAGS");
      expect(content).toContain("欢快");
      expect(content).toContain("感人");
      expect(content).toContain("浪漫");
    });

    it("should have lyrics input in Custom mode", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("lyricsInput");
      expect(content).toContain("[Verse]");
      expect(content).toContain("[Chorus]");
    });

    it("should have AI lyrics assistant", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("lyricsAssistant");
      expect(content).toContain("AI 歌词助手");
      expect(content).toContain("3 Credits");
      expect(content).toContain("handleGenerateLyrics");
    });

    it("should have instrumental toggle in Simple mode", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("instrumental");
      expect(content).toContain("纯音乐");
    });

    it("should have vocal gender selection in Custom mode", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("vocalGender");
      expect(content).toContain("男声");
      expect(content).toContain("女声");
      expect(content).toContain("自动");
    });

    it("should have song result display with play and download", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("songCard");
      expect(content).toContain("playBtn");
      expect(content).toContain("downloadBtn");
      expect(content).toContain("播放");
    });

    it("should have polling mechanism for task status", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/music-studio.tsx"),
        "utf-8"
      );
      expect(content).toContain("startPolling");
      expect(content).toContain("getTaskStatus");
      expect(content).toContain("pollingRef");
    });
  });

  describe("Navigation Integration", () => {
    it("should have music studio entry in home page features", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/(tabs)/index.tsx"),
        "utf-8"
      );
      expect(content).toContain("music-studio");
      expect(content).toContain("音乐工作室");
      expect(content).toContain("/music-studio");
    });
  });
});

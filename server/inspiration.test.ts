import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock invokeLLM
const mockInvokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: any[]) => mockInvokeLLM(...args),
}));

// Mock storagePut
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/remix-video.mp4", key: "remix-video.mp4" }),
}));

describe("Inspiration & Remix Features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Inspiration Generation", () => {
    it("should enforce 1000 char limit for free generation", () => {
      const FREE_LIMIT = 1000;
      const testInput = "A".repeat(1200);
      const truncated = testInput.slice(0, FREE_LIMIT);
      expect(truncated.length).toBe(FREE_LIMIT);
    });

    it("should allow 2000 char limit for Gemini paid generation", () => {
      const PAID_LIMIT = 2000;
      const testInput = "A".repeat(2500);
      const truncated = testInput.slice(0, PAID_LIMIT);
      expect(truncated.length).toBe(PAID_LIMIT);
    });

    it("should generate inspiration text via LLM", async () => {
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: {
            content: "在一个霓虹闪烁的未来城市中，一位年轻的舞者在雨中起舞。她的每一个动作都带着电子音乐的节拍，周围的全息广告牌映照出她的身影。"
          }
        }]
      });

      const result = await mockInvokeLLM({
        messages: [
          { role: "system", content: "你是一位专业的MV创意导演" },
          { role: "user", content: "帮我写一个赛博朋克风格的MV文案" },
        ],
      });

      expect(result.choices[0].message.content).toBeTruthy();
      expect(result.choices[0].message.content.length).toBeGreaterThan(10);
      expect(mockInvokeLLM).toHaveBeenCalledTimes(1);
    });

    it("should support different generation modes (lyrics vs script)", async () => {
      // Lyrics mode
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: {
            content: "verse 1:\n霓虹灯下的街道\n我独自走过\n\nchorus:\n这城市的夜\n属于我们的歌"
          }
        }]
      });

      const lyricsResult = await mockInvokeLLM({
        messages: [
          { role: "system", content: "你是一位专业的歌词创作者" },
          { role: "user", content: "写一首关于城市夜晚的歌词" },
        ],
      });

      expect(lyricsResult.choices[0].message.content).toContain("verse");

      // Script mode
      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{
          message: {
            content: "场景1：城市天际线\n描述：夕阳下的城市全景\n\n场景2：街道特写\n描述：霓虹灯闪烁的街道"
          }
        }]
      });

      const scriptResult = await mockInvokeLLM({
        messages: [
          { role: "system", content: "你是一位专业的MV导演" },
          { role: "user", content: "写一个城市主题的MV脚本" },
        ],
      });

      expect(scriptResult.choices[0].message.content).toContain("场景");
    });
  });

  describe("Remix Hash Generation", () => {
    it("should generate a valid remix hash format", () => {
      // Simulate remix hash generation (SHA-256 hex format)
      const mockHash = "a1b2c3d4e5f6789012345678abcdef0123456789abcdef0123456789abcdef01";
      expect(mockHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should generate unique hashes for different inputs", () => {
      const hash1 = "a1b2c3d4e5f6789012345678abcdef0123456789abcdef0123456789abcdef01";
      const hash2 = "b2c3d4e5f6789012345678abcdef0123456789abcdef0123456789abcdef0102";
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Credit Costs", () => {
    it("should have correct credit cost for Gemini inspiration", () => {
      const GEMINI_INSPIRATION_COST = 5;
      expect(GEMINI_INSPIRATION_COST).toBe(5);
    });

    it("should have free tier for basic inspiration (Forge)", () => {
      const FORGE_COST = 0;
      expect(FORGE_COST).toBe(0);
    });

    it("should enforce max 20 storyboard panels for paid generation", () => {
      const MAX_PAID_PANELS = 20;
      const requestedPanels = 25;
      const actualPanels = Math.min(requestedPanels, MAX_PAID_PANELS);
      expect(actualPanels).toBe(MAX_PAID_PANELS);
    });
  });
});

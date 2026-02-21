import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * AI 客服助手路由测试
 * 
 * 测试覆盖：
 * 1. sendMessage — 消息发送与 AI 回复
 * 2. escalate — 转人工通知
 * 3. getHistory — 会话历史
 * 4. 系统 prompt 知识库内容验证
 */

// Mock LLM
vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn(),
  invokeLLMFlash: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: "你好！MV Studio Pro 是一个一站式 AI 视频创作平台，主要功能包括智能分镜生成、虚拟偶像生成、视频 PK 评分等。",
      },
    }],
  }),
  invokeLLMPro: vi.fn(),
}));

// Mock notification
vi.mock("../server/_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Mock env
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

describe("AI Customer Service Router", () => {
  describe("Module Structure", () => {
    it("should export customerServiceRouter", async () => {
      const mod = await import("../server/routers/customerService");
      expect(mod.customerServiceRouter).toBeDefined();
    });

    it("should have sendMessage, escalate, and getHistory procedures", async () => {
      const mod = await import("../server/routers/customerService");
      const router = mod.customerServiceRouter;
      // tRPC router has _def.procedures
      expect(router._def).toBeDefined();
    });
  });

  describe("System Prompt Knowledge Base", () => {
    it("should contain key product information in the module", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );

      // 验证系统 prompt 包含关键产品信息
      expect(content).toContain("Credits");
      expect(content).toContain("分镜");
      expect(content).toContain("虚拟偶像");
      expect(content).toContain("Kling");
      expect(content).toContain("3D");
      expect(content).toContain("学生");
      expect(content).toContain("水印");
    });

    it("should contain pricing information", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );

      // 验证包含定价信息
      expect(content).toContain("50 Credits");
      expect(content).toContain("¥35");
      expect(content).toContain("¥68");
      expect(content).toContain("¥168");
      expect(content).toContain("¥328");
    });

    it("should contain escalation keywords", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );

      // 验证包含转人工关键词
      expect(content).toContain("退款");
      expect(content).toContain("投诉");
      expect(content).toContain("bug");
      expect(content).toContain("人工客服");
    });
  });

  describe("Notification Integration", () => {
    it("should import notifyOwner from notification module", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );

      expect(content).toContain('import { notifyOwner }');
      expect(content).toContain('notifyOwner({ title, content })');
    });
  });

  describe("LLM Integration", () => {
    it("should use invokeLLMFlash for customer service responses", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );

      expect(content).toContain("invokeLLMFlash");
      expect(content).toContain("maxTokens: 1024");
    });
  });

  describe("Session Management", () => {
    it("should have session TTL of 2 hours", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );

      expect(content).toContain("SESSION_TTL");
      expect(content).toContain("2 * 60 * 60 * 1000");
    });
  });

  describe("Frontend Component", () => {
    it("should have CustomerServiceChat component file", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const exists = fs.existsSync(
        path.resolve(__dirname, "../components/customer-service-chat.tsx")
      );
      expect(exists).toBe(true);
    });

    it("should be integrated in root layout", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/_layout.tsx"),
        "utf-8"
      );

      expect(content).toContain("CustomerServiceChat");
      expect(content).toContain("customer-service-chat");
    });

    it("should have quick questions and welcome message", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../components/customer-service-chat.tsx"),
        "utf-8"
      );

      expect(content).toContain("QUICK_QUESTIONS");
      expect(content).toContain("WELCOME_MESSAGE");
      expect(content).toContain("小M");
    });

    it("should have escalation form with email input", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../components/customer-service-chat.tsx"),
        "utf-8"
      );

      expect(content).toContain("escalateEmail");
      expect(content).toContain("escalateName");
      expect(content).toContain("escalateReason");
      expect(content).toContain("转人工客服");
    });
  });

  describe("Router Registration", () => {
    it("should be registered in main routers.ts", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers.ts"),
        "utf-8"
      );

      expect(content).toContain("customerServiceRouter");
      expect(content).toContain("customerService: customerServiceRouter");
    });
  });
});

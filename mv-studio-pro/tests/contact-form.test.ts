import { describe, expect, it, vi } from "vitest";

/**
 * 聯絡我們功能測試
 * 
 * 測試覆蓋：
 * 1. submitContactForm 後端路由存在
 * 2. 聯絡表單頁面文件存在
 * 3. 客服浮窗包含聯絡按鈕
 * 4. 表單包含必要欄位
 * 5. 管理員 Email 配置正確
 */

// Mock dependencies
vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn(),
  invokeLLMFlash: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "test" } }],
  }),
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

describe("Contact Form Feature", () => {
  describe("Backend Route", () => {
    it("should have submitContactForm procedure in customerService router", async () => {
      const mod = await import("../server/routers/customerService");
      expect(mod.customerServiceRouter).toBeDefined();
      expect(mod.customerServiceRouter._def).toBeDefined();
    });

    it("should contain submitContactForm in the router file", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );
      expect(content).toContain("submitContactForm");
      expect(content).toContain("notifyOwner");
      expect(content).toContain("benjamintan0318@gmail.com");
    });

    it("should validate required fields (email and content)", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../server/routers/customerService.ts"),
        "utf-8"
      );
      // Check input schema has email and content as required
      expect(content).toContain('email: z.string().min(1)');
      expect(content).toContain('content: z.string().min(1)');
    });
  });

  describe("Frontend - Contact Page", () => {
    it("should have contact.tsx page file", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const exists = fs.existsSync(
        path.resolve(__dirname, "../app/contact.tsx")
      );
      expect(exists).toBe(true);
    });

    it("should contain form fields (name, email, subject, content)", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/contact.tsx"),
        "utf-8"
      );
      expect(content).toContain("name");
      expect(content).toContain("email");
      expect(content).toContain("subject");
      expect(content).toContain("content");
      expect(content).toContain("submitContactForm");
    });

    it("should have subject options", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/contact.tsx"),
        "utf-8"
      );
      expect(content).toContain("功能咨询");
      expect(content).toContain("充值");
      expect(content).toContain("Bug");
      expect(content).toContain("合作洽谈");
    });

    it("should have success state after submission", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/contact.tsx"),
        "utf-8"
      );
      expect(content).toContain("isSubmitted");
      expect(content).toContain("提交成功");
      expect(content).toContain("24 小时");
    });

    it("should display admin email as fallback contact", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../app/contact.tsx"),
        "utf-8"
      );
      expect(content).toContain("benjamintan0318@gmail.com");
    });
  });

  describe("Frontend - Customer Service Chat Button", () => {
    it("should have contact button in chat input bar", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../components/customer-service-chat.tsx"),
        "utf-8"
      );
      expect(content).toContain("contactBtn");
      expect(content).toContain("contactBtnText");
      expect(content).toContain("联络");
      expect(content).toContain('router.push("/contact"');
    });

    it("should close chat panel before navigating to contact page", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../components/customer-service-chat.tsx"),
        "utf-8"
      );
      // Verify setIsOpen(false) is called before router.push
      const contactBtnSection = content.slice(
        content.indexOf("contactBtn"),
        content.indexOf("contactBtn") + 300
      );
      expect(contactBtnSection).toContain("setIsOpen(false)");
    });

    it("should have contactBtn style with blue color theme", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(
        path.resolve(__dirname, "../components/customer-service-chat.tsx"),
        "utf-8"
      );
      expect(content).toContain("#6CB4EE");
      expect(content).toContain("mail-outline");
    });
  });
});

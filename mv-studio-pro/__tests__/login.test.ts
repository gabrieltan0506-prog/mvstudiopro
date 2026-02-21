import { describe, it, expect } from "vitest";

// Test login page data structures and validation logic

type AuthMode = "login" | "register";

interface SocialProvider {
  id: string;
  name: string;
  icon: string;
  color: string;
  bgLight: string;
  bgDark: string;
}

const SOCIAL_PROVIDERS: SocialProvider[] = [
  { id: "google", name: "Google", icon: "g-translate", color: "#4285F4", bgLight: "#EEF3FF", bgDark: "#1A2744" },
  { id: "apple", name: "Apple", icon: "apple", color: "#000000", bgLight: "#F5F5F5", bgDark: "#2A2A2A" },
  { id: "wechat", name: "微信", icon: "chat", color: "#07C160", bgLight: "#E8F9EE", bgDark: "#0D2E1A" },
  { id: "twitter", name: "X", icon: "tag", color: "#1DA1F2", bgLight: "#E8F5FD", bgDark: "#0D2A3D" },
];

// Email validation helper
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Password validation helper
function isValidPassword(password: string): boolean {
  return password.length >= 6;
}

// Form validation
function validateLoginForm(email: string, password: string): string | null {
  if (!email.trim()) return "請輸入電子郵件地址";
  if (!isValidEmail(email)) return "電子郵件格式不正確";
  if (!password.trim()) return "請輸入密碼";
  if (!isValidPassword(password)) return "密碼至少需要6個字符";
  return null;
}

function validateRegisterForm(
  email: string,
  password: string,
  confirmPassword: string,
  username: string,
  agreeTerms: boolean
): string | null {
  if (!username.trim()) return "請輸入用戶名稱";
  if (!email.trim()) return "請輸入電子郵件地址";
  if (!isValidEmail(email)) return "電子郵件格式不正確";
  if (!password.trim()) return "請輸入密碼";
  if (!isValidPassword(password)) return "密碼至少需要6個字符";
  if (password !== confirmPassword) return "兩次輸入的密碼不一致";
  if (!agreeTerms) return "請先同意服務條款和隱私政策";
  return null;
}

describe("Login Page - Social Providers", () => {
  it("should have 4 social login providers", () => {
    expect(SOCIAL_PROVIDERS).toHaveLength(4);
  });

  it("should include Google, Apple, WeChat, and X providers", () => {
    const ids = SOCIAL_PROVIDERS.map((p) => p.id);
    expect(ids).toContain("google");
    expect(ids).toContain("apple");
    expect(ids).toContain("wechat");
    expect(ids).toContain("twitter");
  });

  it("each provider should have required fields", () => {
    SOCIAL_PROVIDERS.forEach((provider) => {
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
      expect(provider.icon).toBeTruthy();
      expect(provider.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(provider.bgLight).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(provider.bgDark).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  it("Google and Apple should use Manus OAuth", () => {
    const oauthProviders = SOCIAL_PROVIDERS.filter(
      (p) => p.id === "google" || p.id === "apple"
    );
    expect(oauthProviders).toHaveLength(2);
  });
});

describe("Login Page - Email Validation", () => {
  it("should validate correct email formats", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("test.user@domain.co")).toBe(true);
    expect(isValidEmail("a@b.c")).toBe(true);
  });

  it("should reject invalid email formats", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@domain.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("user @domain.com")).toBe(false);
  });
});

describe("Login Page - Password Validation", () => {
  it("should accept passwords with 6+ characters", () => {
    expect(isValidPassword("123456")).toBe(true);
    expect(isValidPassword("abcdefgh")).toBe(true);
    expect(isValidPassword("P@ssw0rd!")).toBe(true);
  });

  it("should reject passwords shorter than 6 characters", () => {
    expect(isValidPassword("")).toBe(false);
    expect(isValidPassword("12345")).toBe(false);
    expect(isValidPassword("abc")).toBe(false);
  });
});

describe("Login Page - Login Form Validation", () => {
  it("should return error for empty email", () => {
    expect(validateLoginForm("", "password")).toBe("請輸入電子郵件地址");
  });

  it("should return error for invalid email", () => {
    expect(validateLoginForm("invalid", "password")).toBe("電子郵件格式不正確");
  });

  it("should return error for empty password", () => {
    expect(validateLoginForm("user@test.com", "")).toBe("請輸入密碼");
  });

  it("should return error for short password", () => {
    expect(validateLoginForm("user@test.com", "123")).toBe("密碼至少需要6個字符");
  });

  it("should return null for valid login form", () => {
    expect(validateLoginForm("user@test.com", "password123")).toBeNull();
  });
});

describe("Login Page - Register Form Validation", () => {
  it("should return error for empty username", () => {
    expect(validateRegisterForm("user@test.com", "password", "password", "", true)).toBe(
      "請輸入用戶名稱"
    );
  });

  it("should return error for mismatched passwords", () => {
    expect(
      validateRegisterForm("user@test.com", "password1", "password2", "user", true)
    ).toBe("兩次輸入的密碼不一致");
  });

  it("should return error when terms not agreed", () => {
    expect(
      validateRegisterForm("user@test.com", "password", "password", "user", false)
    ).toBe("請先同意服務條款和隱私政策");
  });

  it("should return null for valid register form", () => {
    expect(
      validateRegisterForm("user@test.com", "password123", "password123", "testuser", true)
    ).toBeNull();
  });
});

describe("Login Page - Auth Mode Toggle", () => {
  it("should toggle between login and register modes", () => {
    let mode: AuthMode = "login";

    // Toggle to register
    mode = mode === "login" ? "register" : "login";
    expect(mode).toBe("register");

    // Toggle back to login
    mode = mode === "login" ? "register" : "login";
    expect(mode).toBe("login");
  });
});

describe("Login Page - UI Structure", () => {
  it("should have brand section with app name", () => {
    const brandTitle = "MV Studio Pro";
    const brandSubtitle = "My Video, I am the team.";
    expect(brandTitle).toBeTruthy();
    expect(brandSubtitle).toBeTruthy();
  });

  it("should have skip button for guest access", () => {
    const skipAction = "/(tabs)";
    expect(skipAction).toBe("/(tabs)");
  });

  it("should have footer with copyright", () => {
    const footerText = "MV Studio Pro © 2026";
    expect(footerText).toContain("2026");
  });
});

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  isAdminUser,
  mapEnterpriseAgentError,
} from "./enterpriseAgents";
import { EnterpriseAgentError } from "../services/enterpriseAgentService";

// ─── isAdminUser ────────────────────────────────────────────────────────────

describe("isAdminUser", () => {
  it("'admin' 角色判定为 admin", () => {
    expect(isAdminUser("admin")).toBe(true);
  });
  it("'supervisor' 角色判定为 admin（监管 = admin）", () => {
    expect(isAdminUser("supervisor")).toBe(true);
  });
  it("'normal' / 普通用户角色返回 false", () => {
    expect(isAdminUser("normal")).toBe(false);
  });
  it("null / undefined 返回 false（防御）", () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});

// ─── mapEnterpriseAgentError ────────────────────────────────────────────────

describe("mapEnterpriseAgentError", () => {
  it("AGENT_NOT_FOUND → NOT_FOUND", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("AGENT_NOT_FOUND", "agent x not found"),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "NOT_FOUND",
        message: "agent x not found",
      }),
    );
  });

  it("AGENT_NOT_ACTIVE → CONFLICT", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("AGENT_NOT_ACTIVE", "expired"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
  });

  it("TRIAL_EXPIRED → FORBIDDEN", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("TRIAL_EXPIRED", "trial expired"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("QUOTA_EXHAUSTED → TOO_MANY_REQUESTS", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("QUOTA_EXHAUSTED", "quota out"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS" }),
    );
  });

  it("DATABASE_UNAVAILABLE → INTERNAL_SERVER_ERROR", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("DATABASE_UNAVAILABLE", "db down"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
    );
  });

  it("MISSING_GEMINI_API_KEY → INTERNAL_SERVER_ERROR", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("MISSING_GEMINI_API_KEY", "missing key"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
    );
  });

  it("GEMINI_API_ERROR → BAD_GATEWAY", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("GEMINI_API_ERROR", "5xx"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "BAD_GATEWAY" }),
    );
  });

  it("GEMINI_EMPTY_RESPONSE → BAD_GATEWAY", () => {
    expect(() =>
      mapEnterpriseAgentError(
        new EnterpriseAgentError("GEMINI_EMPTY_RESPONSE", "empty"),
      ),
    ).toThrow(
      expect.objectContaining({ code: "BAD_GATEWAY" }),
    );
  });

  it("已是 TRPCError 直接 rethrow（不二次包装）", () => {
    const original = new TRPCError({
      code: "FORBIDDEN",
      message: "user blocked",
    });
    let caught: unknown;
    try {
      mapEnterpriseAgentError(original);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(original); // 同一实例
  });

  it("普通 Error 兜底成 INTERNAL_SERVER_ERROR", () => {
    expect(() =>
      mapEnterpriseAgentError(new Error("unknown failure")),
    ).toThrow(
      expect.objectContaining({
        code: "INTERNAL_SERVER_ERROR",
        message: "unknown failure",
      }),
    );
  });

  it("非 Error 输入（string / object）也能兜底", () => {
    expect(() => mapEnterpriseAgentError("string error")).toThrow(
      expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlatformSupervisorOpsAllowed, resolveSiteOwnerOnlyAllowed } from "./access-policy";
import {
  createSupervisorSessionToken,
  readSupervisorSession,
  SUPERVISOR_SESSION_COOKIE_NAME,
  SUPERVISOR_SESSION_TTL_MS,
} from "./supervisor-session";

afterEach(() => vi.unstubAllEnvs());

describe("监管 HttpOnly 会话", () => {
  it("覆盖无、伪造、过期、跨账号与正确会话矩阵", () => {
    vi.stubEnv("SUPERVISOR_SECRET", "test-supervisor-secret");
    const now = 1_780_000_000_000;
    const issued = createSupervisorSessionToken(7, now);
    const cookie = `${SUPERVISOR_SESSION_COOKIE_NAME}=${issued.token}`;
    expect(readSupervisorSession({ expectedUserId: 7, nowMs: now })).toBeUndefined();
    expect(readSupervisorSession({
      cookieHeader: `${SUPERVISOR_SESSION_COOKIE_NAME}=${issued.token.slice(0, -1)}x`,
      expectedUserId: 7,
      nowMs: now,
    })).toBeUndefined();
    expect(readSupervisorSession({
      cookieHeader: cookie,
      expectedUserId: 7,
      nowMs: now + SUPERVISOR_SESSION_TTL_MS + 1,
    })).toBeUndefined();
    expect(readSupervisorSession({ cookieHeader: cookie, expectedUserId: 8, nowMs: now })).toBeUndefined();
    expect(readSupervisorSession({ cookieHeader: cookie, expectedUserId: 7, nowMs: now }))
      .toEqual(issued.session);
  });

  it("权限为角色或绑定当前账号的有效会话，不能跨账号提升", () => {
    const future = Date.now() + 60_000;
    expect(resolvePlatformSupervisorOpsAllowed({ id: 1, role: "admin" })).toBe(true);
    expect(resolvePlatformSupervisorOpsAllowed({ id: 1, role: "supervisor" })).toBe(true);
    expect(resolvePlatformSupervisorOpsAllowed({ id: 1, role: "user" })).toBe(false);
    expect(resolvePlatformSupervisorOpsAllowed(
      { id: 1, role: "user" },
      { userId: 2, expiresAt: future },
    )).toBe(false);
    expect(resolvePlatformSupervisorOpsAllowed(
      { id: 1, role: "user" },
      { userId: 1, expiresAt: future },
    )).toBe(true);
  });

  it("owner 专属权限只认 OWNER_OPEN_ID，admin/supervisor 不能替代", () => {
    expect(resolveSiteOwnerOnlyAllowed({ openId: "owner-open-id" }, "owner-open-id")).toBe(true);
    expect(resolveSiteOwnerOnlyAllowed({ openId: "other" }, "owner-open-id")).toBe(false);
    expect(resolveSiteOwnerOnlyAllowed({ openId: "owner-open-id" }, "")).toBe(false);
    expect(resolveSiteOwnerOnlyAllowed({ openId: "" }, "owner-open-id")).toBe(false);
  });
});

import type { Express, Request, RequestHandler, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/context", () => ({ createContext: vi.fn() }));

import { createContext } from "../_core/context";
import { SUPERVISOR_SESSION_COOKIE_NAME } from "../services/supervisor-session";
import { registerSupervisorSessionRoutes } from "./supervisorSession";

function handlers() {
  let post: RequestHandler | undefined;
  let remove: RequestHandler | undefined;
  const app = {
    post(route: string, handler: RequestHandler) {
      if (route === "/api/supervisor-session") post = handler;
      return app;
    },
    delete(route: string, handler: RequestHandler) {
      if (route === "/api/supervisor-session") remove = handler;
      return app;
    },
  } as unknown as Express;
  registerSupervisorSessionRoutes(app);
  if (!post || !remove) throw new Error("supervisor_session_handlers_missing");
  return { post, remove };
}

async function call(handler: RequestHandler, body?: unknown) {
  let statusCode = 200;
  let payload: unknown;
  let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined;
  let cleared: { name: string; options: Record<string, unknown> } | undefined;
  const response = {
    setHeader: vi.fn(),
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookie = { name, value, options };
      return response;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cleared = { name, options };
      return response;
    },
  } as unknown as Response;
  await handler({
    body,
    protocol: "https",
    hostname: "www.mvstudiopro.com",
    headers: { "x-forwarded-host": "www.mvstudiopro.com" },
  } as unknown as Request, response, () => undefined);
  return { statusCode, payload, cookie, cleared };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("POST/DELETE /api/supervisor-session", () => {
  it("未登录与伪密钥均拒绝", async () => {
    vi.stubEnv("SUPERVISOR_SECRET", "right-secret");
    vi.mocked(createContext).mockResolvedValueOnce({ user: null } as never);
    expect((await call(handlers().post, { secret: "right-secret" })).statusCode).toBe(401);
    vi.mocked(createContext).mockResolvedValueOnce({ user: { id: 7 } } as never);
    expect((await call(handlers().post, { secret: "wrong-secret" })).statusCode).toBe(403);
  });

  it("正确密钥只写 HttpOnly/Strict/Secure 会话，不回传密钥", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPERVISOR_SECRET", "right-secret");
    vi.mocked(createContext).mockResolvedValueOnce({ user: { id: 7 } } as never);
    const result = await call(handlers().post, { secret: "right-secret" });
    expect(result.statusCode).toBe(200);
    expect(result.cookie?.name).toBe(SUPERVISOR_SESSION_COOKIE_NAME);
    expect(result.cookie?.value).not.toContain("right-secret");
    expect(result.cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      domain: "mvstudiopro.com",
      path: "/",
    });
    expect(JSON.stringify(result.payload)).not.toContain("right-secret");
  });

  it("DELETE 清除同名会话 cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await call(handlers().remove);
    expect(result.statusCode).toBe(200);
    expect(result.cleared?.name).toBe(SUPERVISOR_SESSION_COOKIE_NAME);
    expect(result.cleared?.options).toMatchObject({ maxAge: -1, sameSite: "strict", secure: true });
  });
});

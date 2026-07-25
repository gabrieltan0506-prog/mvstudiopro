import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    credits: 0,
    roleTag: "normal",
    contactWechat: null,
    contactPhone: null,
    verifyStatus: "none",
    enterpriseTrialPaid: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    // secure / sameSite 随 NODE_ENV 变（生产才 secure+none），写死会在本地假红。
    // 真正要守的是：清 cookie 的属性必须与设置时逐项一致，否则浏览器不会真的删掉它。
    expect(clearedCookies[0]?.options).toMatchObject({
      ...getSessionCookieOptions(ctx.req),
      maxAge: -1,
    });
    expect(clearedCookies[0]?.options).toMatchObject({
      httpOnly: true,
      path: "/",
    });
  });
});

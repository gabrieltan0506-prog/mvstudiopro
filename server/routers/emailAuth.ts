import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { emailAuth, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import { getSessionCookieOptions } from "../_core/cookies";
import * as sessionDb from "../sessionDb";
import * as crypto from "crypto";

/**
 * Hash password using SHA-256
 */
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export const emailAuthRouter = router({
  /**
   * 注册新用户
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // 检查 email 是否已存在
      const existingAuth = await db.select().from(emailAuth).where(eq(emailAuth.email, input.email)).limit(1);
      if (existingAuth.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      }

      // 创建用户
      const [newUser] = await db.insert(users).values({
        openId: `email_${input.email}`,
        email: input.email,
        name: input.name || input.email.split("@")[0],
        loginMethod: "email",
        role: "user",
      });

      // 创建 email 认证记录
      const passwordHash = hashPassword(input.password);
      await db.insert(emailAuth).values({
        email: input.email,
        passwordHash,
        userId: newUser.insertId,
      });

      // Email 注册成功，返回用户 ID
      return { success: true, userId: newUser.insertId };
    }),

  /**
   * 登录
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // 查找 email 认证记录
      const [auth] = await db.select().from(emailAuth).where(eq(emailAuth.email, input.email)).limit(1);
      if (!auth) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      // 验证密码
      const passwordHash = hashPassword(input.password);
      if (passwordHash !== auth.passwordHash) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      // 获取用户数据
      const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
      if (!user) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "User not found" });
      }

      // 更新用户最后登录时间
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, auth.userId));

      // 创建 session token
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      // 设置 session cookie
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Persist session to database
      await sessionDb.createSession({
        userId: user.id,
        openId: user.openId,
        token: sessionToken,
        loginMethod: "email_password",
        userAgent: ctx.req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + ONE_YEAR_MS),
      });

      return {
        success: true,
        sessionToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    }),
});

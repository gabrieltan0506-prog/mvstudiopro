import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError, ServiceUnavailableError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

/**
 * `DATABASE_URL` 未設定時的單機 Session 使用者，須與 `drizzle/schema` 的 `users` 表
 * {@link User} 保持欄位一致（新增欄位時請同步更新此函數）。
 */
function buildLocalDevUser(session: SessionPayload, signedInAt: Date): User {
  return {
    id: 0,
    openId: session.openId,
    name: session.name || "Local Dev User",
    email: null,
    loginMethod: "local_dev",
    role: "admin",
    credits: 9999,
    roleTag: "normal",
    contactWechat: null,
    contactPhone: null,
    verifyStatus: "approved",
    enterpriseTrialPaid: false,
    createdAt: signedInAt,
    updatedAt: signedInAt,
    lastSignedIn: signedInAt,
  };
}

/** 「最后登录时间」最多多久写一次库（流水账，不值得每个请求一写） */
const LAST_SIGNED_IN_THROTTLE_MS = 10 * 60_000;

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }

  private decodeState(state: string): string {
    const redirectUri = atob(state);
    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId || "mvstudiopro",
        name: options.name || "user",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null,
    options: { silentMissing?: boolean } = {}
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      if (!options.silentMissing) {
        console.warn("[Auth] Missing session cookie");
      }
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (!isNonEmptyString(openId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields", { openId, name });
        return null;
      }

      return {
        openId,
        appId: isNonEmptyString(appId) ? appId : (ENV.appId || "mvstudiopro"),
        name,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  /**
   * 记录「最后登录时间」是流水账，不是鉴权的一部分。
   *
   * 原先每个请求都写一次库：轮询长任务时等于每几秒一次写入，撞上连接抖动的概率被放大，
   * 而这一写失败还会把整个有效会话否掉。改成按 {@link LAST_SIGNED_IN_THROTTLE_MS} 节流，
   * 且失败只记日志。
   */
  private async touchLastSignedIn(
    openId: string,
    previous: Date | null | undefined,
    now: Date
  ): Promise<void> {
    const prevMs = previous instanceof Date ? previous.getTime() : 0;
    if (prevMs && now.getTime() - prevMs < LAST_SIGNED_IN_THROTTLE_MS) return;
    try {
      await db.upsertUser({ openId, lastSignedIn: now });
    } catch (error) {
      console.warn("[Auth] lastSignedIn bookkeeping skipped:", String(error));
    }
  }

  async authenticateRequest(
    req: Request,
    options: { silentMissing?: boolean } = {}
  ): Promise<User> {
    // Regular authentication flow
    const cookies = this.parseCookies((req as any).headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie, {
      silentMissing: options.silentMissing,
    });

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user: Awaited<ReturnType<typeof db.getUserByOpenId>>;
    try {
      user = await db.getUserByOpenId(sessionUserId);
    } catch (error) {
      /**
       * 库连不上 ≠ 凭证无效。会话 JWT 是本地验过的，这里把读库故障往上抛成 503，
       * 免得前台把一次数据库抖动显示成「登录状态已失效」，把长任务的轮询也判死。
       */
      console.error("[Auth] User lookup failed (auth store unavailable):", error);
      throw ServiceUnavailableError("Auth store unavailable");
    }

    if (!user && !ENV.databaseUrl) {
      return buildLocalDevUser(session, signedInAt);
    }

    // If user not in DB, sync from OAuth server automatically
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await this.touchLastSignedIn(user.openId, user.lastSignedIn, signedInAt);

    return user;
  }
}

export const sdk = new SDKServer();

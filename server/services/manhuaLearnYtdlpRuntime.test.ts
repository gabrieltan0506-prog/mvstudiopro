import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { openYtdlpCookieSession, ytdlpCookieCandidateCount } from "./manhuaLearnYtdlpRuntime";

const OLD_ENV = {
  DOUYIN_COOKIE: process.env.DOUYIN_COOKIE,
  DOUYIN_COOKIE_BACKUP: process.env.DOUYIN_COOKIE_BACKUP,
  DOUYIN_COOKIE_POOL: process.env.DOUYIN_COOKIE_POOL,
  MANHUA_LEARN_YTDLP_COOKIES_FILE: process.env.MANHUA_LEARN_YTDLP_COOKIES_FILE,
  YTDLP_COOKIES_FILE: process.env.YTDLP_COOKIES_FILE,
  MANHUA_LEARN_YTDLP_COOKIES_FROM_BROWSER: process.env.MANHUA_LEARN_YTDLP_COOKIES_FROM_BROWSER,
};

afterEach(() => {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("manhuaLearnYtdlpRuntime Cookie 候选", () => {
  it("按编号为 yt-dlp 生成备用账号临时 Cookie 文件", async () => {
    delete process.env.MANHUA_LEARN_YTDLP_COOKIES_FILE;
    delete process.env.YTDLP_COOKIES_FILE;
    delete process.env.MANHUA_LEARN_YTDLP_COOKIES_FROM_BROWSER;
    process.env.DOUYIN_COOKIE = "sessionid=account-a";
    process.env.DOUYIN_COOKIE_BACKUP = "sessionid=account-b";
    delete process.env.DOUYIN_COOKIE_POOL;

    expect(ytdlpCookieCandidateCount()).toBe(2);
    const session = await openYtdlpCookieSession(1);
    try {
      expect(session.args[0]).toBe("--cookies");
      const body = await fs.readFile(session.args[1]!, "utf8");
      expect(body).toContain("sessionid\taccount-b");
      expect(body).not.toContain("sessionid\taccount-a");
    } finally {
      await session.cleanup();
    }
  });
});

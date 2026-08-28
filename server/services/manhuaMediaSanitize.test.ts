/**
 * PR1325 第一节：统一脱敏回归。每类敏感物各有断言——Cookie/Set-Cookie、
 * Authorization(Bearer/Basic)、DOUYIN_COOKIE 环境值与赋值串、GCS V4 签名参数、
 * 带查询串的签名媒体 URL（砍到主机）、禁换行、限长 300；
 * describeErrorChain（脚本层 catch 打印的唯一出口）整链序列化后零泄漏。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeErrorChain, sanitizeSensitiveText } from "./manhuaMediaSanitize";

const LEAK = "test-cookie-DO-NOT-LEAK";

describe("sanitizeSensitiveText", () => {
  const originalEnvCookie = process.env.DOUYIN_COOKIE;
  beforeEach(() => {
    process.env.DOUYIN_COOKIE = LEAK;
  });
  afterEach(() => {
    if (originalEnvCookie === undefined) delete process.env.DOUYIN_COOKIE;
    else process.env.DOUYIN_COOKIE = originalEnvCookie;
  });

  it("遮蔽 Cookie 头整值（含分号多键）", () => {
    const out = sanitizeSensitiveText("请求头 Cookie: sessionid=abc123; ttwid=secret456 已发送");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("secret456");
    expect(out).toContain("<REDACTED>");
  });

  it("遮蔽 Set-Cookie 响应头", () => {
    const out = sanitizeSensitiveText("set-cookie: passport_csrf=deadbeef; Path=/; HttpOnly");
    expect(out).not.toContain("deadbeef");
    expect(out).toContain("<REDACTED>");
  });

  it("遮蔽 Authorization Bearer 与 Basic", () => {
    const bearer = sanitizeSensitiveText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig");
    expect(bearer).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    const basic = sanitizeSensitiveText("上游返回 401，曾发送 basic dXNlcjpwYXNz 认证");
    expect(basic).not.toContain("dXNlcjpwYXNz");
  });

  it("遮蔽 DOUYIN_COOKIE 环境变量字面值（即使不带任何头名）", () => {
    const out = sanitizeSensitiveText(`拼接串里混入了 ${LEAK} 也不能出去`);
    expect(out).not.toContain(LEAK);
    expect(out).toContain("<REDACTED>");
  });

  it("遮蔽 DOUYIN_COOKIE=xxx 赋值串（值与 env 不同也遮）", () => {
    const out = sanitizeSensitiveText("child env DOUYIN_COOKIE=another-secret-value crashed");
    expect(out).not.toContain("another-secret-value");
    expect(out).toContain("DOUYIN_COOKIE=<REDACTED>");
  });

  it("遮蔽 GCS V4 签名参数（URL 之外的裸参数）", () => {
    const out = sanitizeSensitiveText("params X-Goog-Signature=aabbcc112233 X-Goog-Credential=sa%40proj.iam");
    expect(out).not.toContain("aabbcc112233");
    expect(out).not.toContain("sa%40proj.iam");
  });

  it("带查询串的 https 签名媒体 URL 砍到主机", () => {
    const out = sanitizeSensitiveText(
      "下载失败 https://storage.googleapis.com/bucket/o/video.mp4?X-Goog-Signature=ff00ff&X-Goog-Expires=600 请重试",
    );
    expect(out).not.toContain("ff00ff");
    expect(out).not.toContain("X-Goog-Expires=600");
    expect(out).not.toContain("/bucket/o/video.mp4");
    expect(out).toContain("https://storage.googleapis.com");
  });

  it("抖音媒体签名 URL 查询串不外泄", () => {
    const out = sanitizeSensitiveText(
      "ffmpeg 输入 http://v3-web.douyinvod.com/abc/video/tos/mp4?a=1&auth_key=173-0-0-secret 打不开",
    );
    expect(out).not.toContain("auth_key");
    expect(out).not.toContain("secret");
    expect(out).toContain("douyinvod.com");
  });

  it("禁换行并限长 300", () => {
    const out = sanitizeSensitiveText(`第一行\r\n第二行\t第三行 ${"长".repeat(500)}`);
    expect(out).not.toMatch(/[\r\n\t]/);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain("第一行 第二行 第三行");
  });

  it("非字符串输入（Error/对象）也可脱敏", () => {
    const out = sanitizeSensitiveText(new Error(`fetch failed with Cookie: ${LEAK}`));
    expect(out).not.toContain(LEAK);
    const objOut = sanitizeSensitiveText({ headers: { Cookie: LEAK } });
    expect(objOut).not.toContain(LEAK);
  });

  describe("describeErrorChain（脚本层 catch 的唯一序列化出口）", () => {
    it("整链 name/code/message 序列化后不含 cookie、签名参数与 URL 查询串", () => {
      const root = new Error(
        `connect failed for https://v3-web.douyinvod.com/a.mp4?auth_key=zzz-secret with Cookie: ${LEAK}`,
      );
      (root as Error & { code?: string }).code = "ECONNRESET";
      const middle = new Error(`yt-dlp argv 曾含 DOUYIN_COOKIE=${LEAK}`, { cause: root });
      const top = new Error("抖音片源解析失败", { cause: middle });
      const chain = describeErrorChain(top);
      const serialized = JSON.stringify(chain);
      expect(chain.length).toBe(3);
      expect(serialized).not.toContain(LEAK);
      expect(serialized).not.toContain("auth_key");
      expect(serialized).not.toContain("zzz-secret");
      expect(serialized).toContain("ECONNRESET");
      expect(serialized).toContain("抖音片源解析失败");
    });
  });
});

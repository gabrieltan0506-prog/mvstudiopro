import { describe, expect, it } from "vitest";
import { ownedResourcePolicy, isOwnedResourceUrl } from "./ownedResourceUrl";
import { PdfHtmlRejectedError, sanitizePdfHtml } from "./pdfHtmlSanitize";

const policy = ownedResourcePolicy({
  GCS_BUCKET_NAME: "my-bucket",
  FLY_APP_NAME: "mvstudiopro",
  AWS_ENDPOINT_URL_S3: "https://fly.storage.tigris.dev",
  BUCKET_NAME: "my-s3",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbC123_secret",
});
const run = (html: string, maxBytes?: number) => sanitizePdfHtml(html, { policy, maxBytes }).html;
const SSRF = /169\.254\.169\.254|metadata\.google|localhost|127\.0\.0\.1|10\.0\.0\.\d|evil\.example|\[::1\]/;

describe("自有资源白名单", () => {
  it.each([
    "https://www.mvstudiopro.com/a.png",
    "https://mvstudiopro.fly.dev/api/blog-media/x.png",
    "https://storage.googleapis.com/my-bucket/uploads/u7/a.png?X-Goog-Signature=1",
    "https://my-bucket.storage.googleapis.com/a.png",
    "https://storage.googleapis.com/mv-studio-pro-vertex-video-temp/x.jpg",
    "https://fly.storage.tigris.dev/my-s3/uploads/a.png",
    "https://abc123.public.blob.vercel-storage.com/a.png",
    "//www.mvstudiopro.com/a.png",
  ])("放行 %s", url => expect(isOwnedResourceUrl(url, policy)).toBe(true));

  it.each([
    "http://www.mvstudiopro.com/a.png",
    "https://169.254.169.254/computeMetadata/v1/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://www.mvstudiopro.com:8443/a",
    "https://user:pw@www.mvstudiopro.com/a",
    "https://storage.googleapis.com/someone-else/a.png",
    "https://other.public.blob.vercel-storage.com/a.png",
    "https://fly.storage.tigris.dev/other/a.png",
    "https://evil.example/a.png",
    "https://mvstudiopro.com.evil.example/a.png",
    "file:///etc/passwd",
  ])("拒绝 %s", url => expect(isOwnedResourceUrl(url, policy)).toBe(false));
});

describe("sanitizePdfHtml", () => {
  it("超过大小上限 → 拒收", () => {
    expect(() => run("<p>x</p>".repeat(100), 200)).toThrow(PdfHtmlRejectedError);
  });

  it("去掉脚本、内嵌框架、对象、base、meta refresh、导入类 link、事件属性、javascript:", () => {
    const html = run(`<html><head><base href="http://169.254.169.254/"><meta http-equiv="refresh" content="0;url=http://10.0.0.5/">
      <link rel="import" href="https://www.mvstudiopro.com/x.html"><link rel="preconnect" href="https://evil.example">
      <script src="https://www.mvstudiopro.com/a.js"></script><SCRIPT>fetch("http://localhost")</SCRIPT></head>
      <body onload="fetch('http://127.0.0.1')"><iframe src="http://metadata.google.internal/"></iframe>
      <object data="http://10.0.0.1/x"></object><embed src="http://10.0.0.2/x"><frameset><frame src="http://10.0.0.3/"></frameset>
      <a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)"><p>正文保留</p></body></html>`);
    expect(html).not.toMatch(/<\s*(script|iframe|object|embed|frame|frameset|base)\b/i);
    expect(html).not.toMatch(/http-equiv="refresh"|rel="import"|rel="preconnect"|onload=|onerror=|javascript:/i);
    expect(html).not.toMatch(SSRF);
    expect(html).toContain("<p>正文保留</p>");
  });

  it("外链资源只留本站与自有存储：img / srcset / poster / style url() / <style> @import / svg image", () => {
    const html = run(`<head></head><body>
      <img src="https://storage.googleapis.com/my-bucket/a.png"><img src="http://169.254.169.254/latest/meta-data/">
      <img srcset="https://www.mvstudiopro.com/a.png 1x, https://evil.example/b.png 2x">
      <video poster="https://metadata.google.internal/x"></video>
      <div style="background:url('http://localhost:8080/x')">a</div>
      <style>@import url("https://evil.example/x.css"); .a{background:url(https://10.0.0.9/x)} .b{background:url(https://www.mvstudiopro.com/ok.png)}</style>
      <svg><image href="http://127.0.0.1/x"/><image xlink:href="https://evil.example/y"/></svg>
      <img src="data:image/png;base64,AAAA"><img src="/relative.png"></body>`);
    expect(html).toContain('src="https://storage.googleapis.com/my-bucket/a.png"');
    expect(html).toContain("https://www.mvstudiopro.com/a.png 1x");
    expect(html).toContain("url(https://www.mvstudiopro.com/ok.png)");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toMatch(SSRF);
  });

  it("头部注入 CSP：默认全禁，资源只许 data: 与白名单源，禁脚本 / 框架 / 连接", () => {
    const html = run("<html><head><title>t</title></head><body><p>x</p></body></html>");
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] || "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("https://storage.googleapis.com/my-bucket/");
    expect(csp).not.toMatch(/\*|evil/);
    expect(run("<p>无 head</p>")).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
  });

  it("合法报告快照基本不变（只多一个 CSP meta）", () => {
    const report = `<html><head><style>.r{color:#333}</style></head><body><div id="platform-report"><h1>报告</h1><img src="https://storage.googleapis.com/my-bucket/c.png" alt="图"></div></body></html>`;
    const html = run(report);
    expect(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")).toBe(report);
  });
});

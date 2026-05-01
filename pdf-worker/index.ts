import express from "express";
import puppeteer from "puppeteer";

const app = express();
// Increase body limit to 100mb — static HTML snapshots can be several MB
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const PORT = process.env.PORT || 8080;

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/generate-pdf", async (req, res) => {
  const { html, token } = req.body as { html?: string; token?: string };

  if (!html || html.length < 100) {
    res.status(400).json({ error: "html body is required and must be non-empty" });
    return;
  }

  // Log token presence for audit trail — does not affect page.setContent() flow.
  // When this worker is upgraded to page.goto(url), use token to inject auth cookie.
  if (token) {
    console.log(`[pdf-worker] token present (${token === "supervisor" ? "supervisor" : "user"}, len=${token.length})`);
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-web-security",
        "--single-process",
        "--no-zygote",
      ],
    });

    const page = await browser.newPage();

    // Set viewport for high-quality capture
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

    // Load the static HTML snapshot directly via setContent.
    // This bypasses auth/state issues entirely — the DOM was already rendered by the user's browser.
    // Scripts were stripped by the frontend so React won't re-render and clear the charts.
    //
    // 2026-05-01 实测验证：
    //   - networkidle0 在 8.87 MB HTML 下 44s 完成（PR #353 hotfix 验证过）
    //   - 改 networkidle2 后反而卡死 11+ 分钟无日志（Chrome 内部 favicon.ico 之类
    //     的 phantom 请求让 idle≤2 永远不满足）→ 退回 networkidle0
    //   - 800 ms 硬等不够把 2.18 MB base64 PNG 封面解码 + 绘背景 → 拉到 30s
    //   - document.fonts.ready 用 page.evaluate 而不是 evaluateHandle（后者不 auto-await Promise）
    //
    // 2026-05-01 用户决策（第二次调整）：之前 1_500_000 (25 min) 是为应付理论上的
    // 25 MB 报告，代价是任何卡住请求都让用户等 25 分钟。改回 14 分钟 (840_000 ms)，
    // 比 fly 端 fetch AbortController (900_000 / 15 min) 略短，让 pdf-worker 主动失败
    // 返回 500 给 fly，fly 转发错误给 UI，用户能立刻知道并重试。
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 840_000,
    });

    // 等所有自定义字体加载完毕 — 避免 PDF 里出现字体 fallback / 方块字
    // 用字符串 page.evaluate 避免 pdf-worker tsconfig 没 lib.dom 的编译错
    // 注意：page.evaluate 字符串形式会自动 await 表达式如果是 Promise
    await page.evaluate("document.fonts.ready");

    // Extra wait for base64 image decode + CSS transitions + ECharts SVG layout to fully settle
    // 30s 是给 2 MB+ base64 cover image 解码 + 绘背景的留量（800ms 不够，封面渲染不出来）
    await new Promise((r) => setTimeout(r, 30_000));

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16px", bottom: "16px", left: "12px", right: "12px" },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mvstudio-analysis-${Date.now()}.pdf"`,
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[pdf-worker] generation failed:", msg);
    res.status(500).json({ error: msg });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
});

const server = app.listen(PORT, () => {
  console.log(`[pdf-worker] listening on port ${PORT}`);
});

// Cloud Run timeout is set to 2000s in deploy.sh (Gemini reviewer 建议从 1800 拉到 2000，
// 给 PDF 序列化 + 跨云回传 500s 缓冲)；server socket 超时设在 Cloud Run 之内、setContent
// 之上，足够处理 25 min puppeteer render + 30s hard wait + PDF gen overhead。
server.setTimeout(1_950_000);
server.keepAliveTimeout = 1_955_000;
server.headersTimeout = 1_960_000;

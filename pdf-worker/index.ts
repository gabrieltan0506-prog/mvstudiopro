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
    // 2026-05-01 用户决策：Deep Research Max 16-25 MB HTML 已成常态，原 480s 不够。
    //   - waitUntil: "networkidle0" → "networkidle2" — 允许 ≤2 个 idle 连接，
    //     避免某个长 ECharts 内部 XHR 卡住整个 wait
    //   - timeout 480_000 → 1_500_000 (25 min)，给 16-25 MB 足够渲染时间
    //   - 显式 await document.fonts.ready —— 确保自定义 Noto Sans CJK 完全落地
    //     再开始 PDF 生成（之前漏的，PR #350 提过但当时改的是 pdfGenerator 路径）
    await page.setContent(html, {
      waitUntil: "networkidle2",
      timeout: 1_500_000,
    });

    // 等所有自定义字体加载完毕 — 避免 PDF 里出现字体 fallback / 方块字
    await page.evaluateHandle("document.fonts.ready");

    // Extra wait for CSS transitions and ECharts SVG layout to fully settle
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

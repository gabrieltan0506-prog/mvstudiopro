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
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 480_000,
    });

    // Extra wait for CSS transitions and font loads to fully settle
    await new Promise((r) => setTimeout(r, 2500));

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

// Cloud Run timeout is set to 600s in deploy.sh;
// keep server socket timeout slightly above that to avoid premature drops.
server.setTimeout(620_000);
server.keepAliveTimeout = 625_000;
server.headersTimeout = 630_000;

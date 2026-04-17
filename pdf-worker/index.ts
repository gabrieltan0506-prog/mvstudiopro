import express from "express";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/generate-pdf", async (req, res) => {
  const { url, token } = req.body as { url?: string; token?: string };

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
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

    // Inject auth token so the page can render authenticated content
    if (token) {
      await page.setExtraHTTPHeaders({
        Authorization: `Bearer ${token}`,
      });
    }

    // Navigate to the target URL
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });

    // Wait for main analysis container to appear; fall back gracefully if not present
    try {
      await page.waitForSelector(
        ".main-chart-container, .analysis-export-container, [data-export-root]",
        { timeout: 20_000 },
      );
    } catch {
      // Page may not have a specific container; proceed with full-page capture
    }

    // Extra wait for charts/animations to settle
    await new Promise((r) => setTimeout(r, 2000));

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

app.listen(PORT, () => {
  console.log(`[pdf-worker] listening on port ${PORT}`);
});

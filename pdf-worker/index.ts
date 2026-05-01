import express from "express";
import puppeteer, { type Page } from "puppeteer";
import { spawn } from "node:child_process";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const app = express();
// Deep Research Max：静态快照可达数十 MB
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

const PORT = process.env.PORT || 8080;

// ════════════════════════════════════════════════════════════════════════════
// 2026-05-01 体积优化 + 失败诊断（叠加在 PR #353 / #357 既有调整之上）
//
// 企业级默认可跑 + 适度压体积/墙钟（品质仍近原样）；一律可用 env 拉回高质量慢速档。
//   PDF_SCALE_FACTOR             默认 1.35（视口 DPR；略低于 1.5 → step5 page.pdf 光栅更快）
//   PDF_POST_LAYOUT_WAIT_MS     默认 18_000（图已 decode 后短沉淀；过短易 B，过长浪费墙钟）
//   PDF_PER_IMAGE_WAIT_MS       默认 20_000（单图 load 兜底）
//   PDF_GHOSTSCRIPT_COMPRESS     默认 true
//   PDF_GS_LEVEL                 默认 ebook
//   PDF_GS_COLOR_DPI / GRAY_DPI  默认 132（原 150；肉眼难辨、gs 更快更小）
//   PDF_GS_MONO_DPI             默认 240（原 300）
//   PDF_GS_TIMEOUT_MS            默认 180_000
//   PDF_SET_CONTENT_WAIT_UNTIL   默认 load
//   PDF_SET_CONTENT_TIMEOUT_MS  默认 1_800_000（30min；把 Cloud Run 余量多留给 step5）
//   PDF_PAGE_PDF_TIMEOUT_MS     默认 0（禁用 puppeteer 内置 30s step5 限时）
//   PDF_UNIFY_CJK_FONT_STACK    默认 true（@media print 統一 Noto CJK，利於子集嵌入/GS 壓縮）
// ════════════════════════════════════════════════════════════════════════════
const SCALE_FACTOR = Number(process.env.PDF_SCALE_FACTOR) || 1.35;
const POST_LAYOUT_WAIT_MS = Number(process.env.PDF_POST_LAYOUT_WAIT_MS) || 18_000;
const PER_IMAGE_WAIT_MS = Number(process.env.PDF_PER_IMAGE_WAIT_MS) || 20_000;
const ENABLE_GS_COMPRESS = process.env.PDF_GHOSTSCRIPT_COMPRESS !== "false";
const GS_LEVEL = (process.env.PDF_GS_LEVEL || "ebook") as
  | "screen" | "ebook" | "printer" | "prepress";
const GS_TIMEOUT_MS = Number(process.env.PDF_GS_TIMEOUT_MS) || 180_000;
const GS_COLOR_DPI = Number(process.env.PDF_GS_COLOR_DPI) || 132;
const GS_GRAY_DPI = Number(process.env.PDF_GS_GRAY_DPI) || 132;
const GS_MONO_DPI = Number(process.env.PDF_GS_MONO_DPI) || 240;

const ALLOWED_WAIT = new Set(["load", "domcontentloaded", "networkidle0", "networkidle2"]);
const SET_CONTENT_WAIT_RAW = (process.env.PDF_SET_CONTENT_WAIT_UNTIL || "load").toLowerCase();
const SET_CONTENT_WAIT_UNTIL = ALLOWED_WAIT.has(SET_CONTENT_WAIT_RAW)
  ? (SET_CONTENT_WAIT_RAW as "load" | "domcontentloaded" | "networkidle0" | "networkidle2")
  : "load";

const SET_CONTENT_TIMEOUT_MS = Number(process.env.PDF_SET_CONTENT_TIMEOUT_MS) || 1_800_000;

/** page.pdf 单步超时（ms）。0 = 禁用 Puppeteer 内置限时（其默认 30s 会害死 Max）。 */
const PAGE_PDF_TIMEOUT_ENV = process.env.PDF_PAGE_PDF_TIMEOUT_MS;
const PAGE_PDF_TIMEOUT_PARSED =
  PAGE_PDF_TIMEOUT_ENV !== undefined && PAGE_PDF_TIMEOUT_ENV !== ""
    ? Number(PAGE_PDF_TIMEOUT_ENV)
    : 0;
const PAGE_PDF_TIMEOUT_MS =
  Number.isFinite(PAGE_PDF_TIMEOUT_PARSED) && PAGE_PDF_TIMEOUT_PARSED >= 0
    ? PAGE_PDF_TIMEOUT_PARSED
    : 0;

/** 打印前統一為容器內 Noto CJK，減少多字體混嵌、利於 Ghostscript subset。設為 false 可回退舊版視覺。 */
const UNIFY_CJK_FONT_STACK = process.env.PDF_UNIFY_CJK_FONT_STACK !== "false";

console.log(
  `[pdf-worker] startup config: ` +
  `scale=${SCALE_FACTOR}, postLayoutWaitMs=${POST_LAYOUT_WAIT_MS}, perImageWaitMs=${PER_IMAGE_WAIT_MS}, ` +
  `setContentWaitUntil=${SET_CONTENT_WAIT_UNTIL} ` +
  `setContentTimeoutMs=${SET_CONTENT_TIMEOUT_MS} ` +
  `pagePdfTimeoutMs=${PAGE_PDF_TIMEOUT_MS === 0 ? "0(disabled)" : PAGE_PDF_TIMEOUT_MS} ` +
  `unifyCjkFontStack=${UNIFY_CJK_FONT_STACK} ` +
  `gs=${ENABLE_GS_COMPRESS ? GS_LEVEL : "off"} dpi=color/${GS_COLOR_DPI} gray/${GS_GRAY_DPI} mono/${GS_MONO_DPI} ` +
  `gsTimeout=${GS_TIMEOUT_MS}ms`,
);

async function compressPdfWithGhostscript(
  input: Buffer,
  level: typeof GS_LEVEL = "ebook",
  timeoutMs = GS_TIMEOUT_MS,
  colorDpi = GS_COLOR_DPI,
  grayDpi = GS_GRAY_DPI,
  monoDpi = GS_MONO_DPI,
): Promise<Buffer> {
  const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const inPath = join(tmpdir(), `pdf-in-${stamp}.pdf`);
  const outPath = join(tmpdir(), `pdf-out-${stamp}.pdf`);

  try {
    await writeFile(inPath, input);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("gs", [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=/${level}`,
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        "-dDetectDuplicateImages=true",
        "-dColorImageDownsampleType=/Bicubic",
        `-dColorImageResolution=${colorDpi}`,
        "-dGrayImageDownsampleType=/Bicubic",
        `-dGrayImageResolution=${grayDpi}`,
        "-dMonoImageDownsampleType=/Bicubic",
        `-dMonoImageResolution=${monoDpi}`,
        "-dEmbedAllFonts=true",
        "-dSubsetFonts=true",
        "-dCompressFonts=true",
        `-sOutputFile=${outPath}`,
        inPath,
      ]);

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`gs compress timeout ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`gs exit ${code}`));
      });
    });

    return Buffer.from(await readFile(outPath));
  } finally {
    await Promise.all([
      unlink(inPath).catch(() => {}),
      unlink(outPath).catch(() => {}),
    ]);
  }
}

/** 與 client 端表紙列印規則一致；以 JSON 塞入 evaluate 字串避免 pdf-worker tsconfig 無 DOM lib。 */
const MYREPORTS_SNAPSHOT_PRINT_CSS = `
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  #myreports-pdf-root {
    background: #fff !important;
  }
  figure:not(.cover-page), img:not(:is(.cover-page img)), .echart-mount {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .cover-page img, .cover-page.cover-image-only img {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }
  .cover-page, .cover-page.cover-image-only {
    page-break-before: avoid !important;
    break-before: avoid !important;
    page-break-after: auto !important;
    break-after: auto !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    box-sizing: border-box !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background-color: #fff !important;
    width: 100% !important;
    height: 262mm !important;
    max-height: 262mm !important;
    min-height: 0 !important;
    overflow: hidden !important;
    position: relative !important;
  }
  .cover-page img, .cover-page.cover-image-only img {
    position: static !important;
    display: block !important;
    flex-shrink: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    width: auto !important;
    height: auto !important;
    object-fit: contain !important;
    aspect-ratio: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    transform: none !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    outline: none !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  #myreports-pdf-root:has(> figure.cover-page) > [data-report-surface] {
    page-break-before: always !important;
    break-before: page !important;
    margin-top: 0 !important;
  }
}
`.trim();

/**
 * 作品庫 DOM 快照：head 裡的全域樣式可能與表紙規則打架。在 body 末尾再寫一層 @media print
 *（整份文檔最後出現 → !important 同階時優先），並為 cover <img> 補 width/height 以利 page.pdf 繪製。
 */
async function applyMyreportsSnapshotPrintGuarantees(page: Page): Promise<void> {
  await page.evaluate(
    `(function () {
      var css = ${JSON.stringify(MYREPORTS_SNAPSHOT_PRINT_CSS)};
      var STYLE_ID = "mvs-pdf-worker-myreports-print-overrides";
      if (!document.getElementById(STYLE_ID)) {
        var el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = css;
        document.body.appendChild(el);
      }
      document.querySelectorAll("figure.cover-page img").forEach(function (node) {
        if (!node || node.tagName !== "IMG") return;
        var img = node;
        if (img.naturalWidth > 0 && !img.getAttribute("width")) {
          img.setAttribute("width", String(img.naturalWidth));
          img.setAttribute("height", String(img.naturalHeight));
        }
      });
    })()`,
  );
}

/** page.pdf 直前：只寫 log，協助定位首頁空白（封面 DOM / 圖 intrinsic / 分頁相關計算樣式）。不影響輸出。 */
async function logMyreportsCoverDiagnosticsBeforePdf(page: Page, reqId: string): Promise<void> {
  try {
    const raw = await page.evaluate(
      `(() => {
        var root = document.getElementById("myreports-pdf-root");
        var directCover = root ? root.querySelector(":scope > figure.cover-page") : null;
        var fig = document.querySelector("figure.cover-page");
        var img = fig ? fig.querySelector("img") : null;
        var surface = document.querySelector("[data-report-surface]");
        var images = Array.prototype.slice.call(document.images);
        var zeroNat = 0;
        for (var i = 0; i < images.length; i++) {
          if (images[i].naturalWidth === 0) zeroNat++;
        }
        var surfaceSt = null;
        try {
          if (surface) {
            var cs = getComputedStyle(surface);
            surfaceSt = { breakBefore: cs.breakBefore, pageBreakBefore: cs.pageBreakBefore };
          }
        } catch (e) {
          surfaceSt = { error: "surface_computed" };
        }
        var figSt = null;
        try {
          if (fig) {
            var fcs = getComputedStyle(fig);
            figSt = {
              breakBefore: fcs.breakBefore,
              breakInside: fcs.breakInside,
              breakAfter: fcs.breakAfter,
              height: fcs.height,
              maxHeight: fcs.maxHeight,
              display: fcs.display,
            };
          }
        } catch (e2) {
          figSt = { error: "fig_computed" };
        }
        var imgNatural = null;
        if (img && img.tagName === "IMG") {
          imgNatural = {
            naturalW: img.naturalWidth,
            naturalH: img.naturalHeight,
            complete: img.complete,
            offsetW: img.offsetWidth,
            offsetH: img.offsetHeight,
            widthAttr: img.getAttribute("width"),
            heightAttr: img.getAttribute("height"),
            srcPrefix: String(img.getAttribute("src") || img.src || "").slice(0, 80),
          };
        }
        var figBox = fig ? { offsetW: fig.offsetWidth, offsetH: fig.offsetHeight } : null;
        return JSON.stringify({
          hasRoot: !!root,
          directChildCoverFig: !!directCover,
          coverFigCount: document.querySelectorAll("figure.cover-page").length,
          imgNatural: imgNatural,
          figBox: figBox,
          figComputed: figSt,
          surfaceBreak: surfaceSt,
          imagesTotal: images.length,
          imagesZeroNatural: zeroNat,
          workerOverrideStyle: !!document.getElementById("mvs-pdf-worker-myreports-print-overrides"),
          sanitizeStyle: !!document.getElementById("mvs-pdf-snapshot-sanitize"),
        });
      })()`,
    );
    const d = JSON.parse(String(raw));
    console.log(`[pdf-worker:${reqId}] DIAG_MYREPORTS_PRE_PDF ${JSON.stringify(d)}`);
  } catch (err) {
    console.warn(
      `[pdf-worker:${reqId}] DIAG_MYREPORTS_PRE_PDF failed: ${(err as Error).message}`,
    );
  }
}

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    config: {
      scaleFactor: SCALE_FACTOR,
      postLayoutWaitMs: POST_LAYOUT_WAIT_MS,
      perImageWaitMs: PER_IMAGE_WAIT_MS,
      setContentWaitUntil: SET_CONTENT_WAIT_UNTIL,
      setContentTimeoutMs: SET_CONTENT_TIMEOUT_MS,
      pagePdfTimeoutMs: PAGE_PDF_TIMEOUT_MS,
      gsCompress: ENABLE_GS_COMPRESS ? GS_LEVEL : "off",
      gsDpi: { color: GS_COLOR_DPI, gray: GS_GRAY_DPI, mono: GS_MONO_DPI },
      gsTimeoutMs: GS_TIMEOUT_MS,
      unifyCjkFontStack: UNIFY_CJK_FONT_STACK,
    },
  }),
);

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

  // ════════════════════════════════════════════════════════════════════════
  // 细粒度耗时打点 — 下次再 timeout 立刻看出卡在哪一步
  // 通过对比每段 elapsed 时间精确定位 setContent / fonts.ready / pdf / gs
  // ════════════════════════════════════════════════════════════════════════
  const reqId = randomBytes(4).toString("hex");
  const t0 = Date.now();
  const htmlMb = (html.length / 1024 / 1024).toFixed(2);
  console.log(`[pdf-worker:${reqId}] start html=${htmlMb}MB scale=${SCALE_FACTOR}`);

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
        "--disable-extensions",
        "--disable-sync",
        "--single-process",
        "--no-zygote",
      ],
    });
    console.log(`[pdf-worker:${reqId}] browser launched +${Date.now() - t0}ms`);

    const page = await browser.newPage();
    await page.setViewport({
      width: 1280,
      height: 800,
      deviceScaleFactor: SCALE_FACTOR,
    });

    // Load the static HTML snapshot directly via setContent.
    // This bypasses auth/state issues entirely — the DOM was already rendered by the user's browser.
    // Scripts were stripped by the frontend so React won't re-render and clear the charts.
    //
    // waitUntil 由 PDF_SET_CONTENT_WAIT_UNTIL 控制（默认 load）：
    //   超大快照下 networkidle0 可能永远等不到「零连接」，拖到 Navigation timeout → A 类。
    //   load 之后仍执行 document.fonts.ready、全图 load+decode、以及固定 hard wait，可覆盖 B 类（缺封面/白页）。
    const tSc = Date.now();
    console.log(
      `[pdf-worker:${reqId}] step1/6 setContent start (waitUntil=${SET_CONTENT_WAIT_UNTIL}, ` +
      `timeoutMs=${SET_CONTENT_TIMEOUT_MS})`,
    );
    await page.setContent(html, {
      waitUntil: SET_CONTENT_WAIT_UNTIL,
      timeout: SET_CONTENT_TIMEOUT_MS,
    });
    console.log(`[pdf-worker:${reqId}] step1/6 setContent done +${Date.now() - tSc}ms`);

    // 等所有自定义字体加载完毕 — 避免 PDF 里出现字体 fallback / 方块字
    // 用字符串 page.evaluate 避免 pdf-worker tsconfig 没 lib.dom 的编译错
    // 注意：page.evaluate 字符串形式会自动 await 表达式如果是 Promise
    const tFonts = Date.now();
    console.log(`[pdf-worker:${reqId}] step2/6 fonts.ready start`);
    await page.evaluate("document.fonts.ready");
    console.log(`[pdf-worker:${reqId}] step2/6 fonts.ready done +${Date.now() - tFonts}ms`);

    // 等大体积 data: PNG/JPEG 全部 load + decode 完再进 hard wait。
    // 否则 page.pdf() 时 naturalWidth=0 → 封面白屏 / 页数统计失真（用户实测 B 类问题）。
    const tImg = Date.now();
    console.log(`[pdf-worker:${reqId}] step3/6 images load+decode start`);
    await page.evaluate(
      `Promise.all(Array.from(document.images).map(function (img) {
      return new Promise(function (resolve) {
        function done() { resolve(null); }
        if (img.complete && img.naturalWidth > 0) return done();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, ${PER_IMAGE_WAIT_MS});
      });
    })).then(function () {
      return Promise.all(Array.from(document.images).map(function (img) {
        return (img.decode && typeof img.decode === "function")
          ? img.decode().catch(function () {})
          : Promise.resolve();
      }));
    })`,
    );
    console.log(`[pdf-worker:${reqId}] step3/6 images load+decode +${Date.now() - tImg}ms`);

    const tHard0 = Date.now();
    console.log(`[pdf-worker:${reqId}] step4/6 layout settle wait ${POST_LAYOUT_WAIT_MS}ms start`);
    await new Promise((r) => setTimeout(r, POST_LAYOUT_WAIT_MS));
    console.log(
      `[pdf-worker:${reqId}] step4/6 layout settle done +${Date.now() - tHard0}ms (since step1 +${Date.now() - tSc}ms)`,
    );

    await page.emulateMediaType("print");

    await page.addStyleTag({
      content: `
        [data-sonner-toaster],[data-sonner-toast],[data-sonner-toaster] li,
        ol[data-sonner-toaster],section[aria-label*="tific" i],section[aria-label*="通知" i],
        [class*="sonner-toast"],.toaster {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          width: 0 !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
          #myreports-pdf-root { margin: 0 !important; padding: 0 !important; }
        }
      `,
    });

    if (UNIFY_CJK_FONT_STACK) {
      await page.addStyleTag({
        content: `
          @media print {
            html, body, html body *:not(img):not(video):not(canvas) {
              font-family: "Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK JP", "Noto Sans CJK KR",
                "Noto Serif CJK SC", "Noto Serif CJK JP", serif !important;
            }
          }
        `,
      });
    }

    await applyMyreportsSnapshotPrintGuarantees(page);

    await logMyreportsCoverDiagnosticsBeforePdf(page, reqId);

    const pdfTimeout = PAGE_PDF_TIMEOUT_MS;
    const tPdf = Date.now();
    console.log(
      `[pdf-worker:${reqId}] step5/6 page.pdf start ` +
      `(通常最耗时；timeoutMs=${pdfTimeout === 0 ? "disabled" : pdfTimeout})`,
    );
    const rawPdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: false,
        // 盡量減少白邊；若印表機預覽有裁切可改回 2–4mm
        margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
        timeout: pdfTimeout,
      }),
    );
    const pdfMb = (rawPdfBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`[pdf-worker:${reqId}] step5/6 page.pdf done +${Date.now() - tPdf}ms size=${pdfMb}MB`);

    let pdfBuffer: Buffer = rawPdfBuffer;
    if (ENABLE_GS_COMPRESS) {
      const tGs = Date.now();
      console.log(`[pdf-worker:${reqId}] step6/6 ghostscript start`);
      try {
        const compressed = await compressPdfWithGhostscript(rawPdfBuffer, GS_LEVEL);
        const ratio = compressed.length / rawPdfBuffer.length;
        if (ratio < 0.95) {
          pdfBuffer = compressed;
          const compressedMb = (compressed.length / 1024 / 1024).toFixed(2);
          console.log(
            `[pdf-worker:${reqId}] gs ${pdfMb}MB → ${compressedMb}MB ` +
            `(${(ratio * 100).toFixed(0)}%, +${Date.now() - tGs}ms)`,
          );
        } else {
          console.log(
            `[pdf-worker:${reqId}] gs 收益 < 5% (${(ratio * 100).toFixed(0)}%)，回退原 PDF`,
          );
        }
      } catch (err) {
        console.warn(
          `[pdf-worker:${reqId}] gs 压缩失败，回退原 PDF: ${(err as Error).message}`,
        );
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mvstudio-analysis-${Date.now()}.pdf"`,
    );

    const finalMb = (pdfBuffer.length / 1024 / 1024).toFixed(2);
    console.log(
      `[pdf-worker:${reqId}] DONE html=${htmlMb}MB pdf=${finalMb}MB total=+${Date.now() - t0}ms`,
    );

    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[pdf-worker:${reqId}] FAILED after ${elapsedSec}s: ${msg}`);
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

// 与 deploy.sh --timeout=3600 对齐；防 Express 先于 puppeteer 关掉长连接
server.setTimeout(3_580_000);
server.keepAliveTimeout = 3_585_000;
server.headersTimeout = 3_590_000;

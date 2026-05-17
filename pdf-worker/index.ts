import express from "express";
import puppeteer, { type Page } from "puppeteer";
import { randomBytes } from "node:crypto";
import {
  buildSubsetFaceCss,
  collectPdfSubsetChars,
  SUBSET_FONT_FAMILY,
} from "./pdfPySubset";

const app = express();
// Deep Research Max：静态快照可达数十 MB
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

const PORT = process.env.PORT || 8080;

// ════════════════════════════════════════════════════════════════════════════
// 2026-05-01 体积优化 + 失败诊断（叠加在 PR #353 / #357 既有调整之上）
//
// 企业级默认可跑：page.pdf（Skia）前以 fonttools pyftsubset 注入 **WOFF2 中文子集**（縮檔且不經 PDF 二次改寫，保留背景色）。
//   PDF_SCALE_FACTOR             默认 1.35（视口 DPR；略低于 1.5 → page.pdf 光栅更快）
//   PDF_POST_LAYOUT_WAIT_MS     默认 18_000（图已 decode 后短沉淀；过短易 B，过长浪费墙钟）
//   PDF_PER_IMAGE_WAIT_MS       默认 20_000（单图 load 兜底）
//   PDF_SET_CONTENT_WAIT_UNTIL   默认 load
//   PDF_SET_CONTENT_TIMEOUT_MS  默认 1_800_000（30min；把 Cloud Run 余量多留给 page.pdf）
//   PDF_VIEWPORT_WIDTH           默认 1920（须 ≥ 决策智库 1680 宽，可防横向裁切）
//   PDF_VIEWPORT_HEIGHT          默认 1600（较高视口利长页纵向排版）
//   PDF_FONT_SUBSET               默认 true：pyftsubset 動態子集 + @font-face（設 false 跳過）
//   PDF_PYFTSUBSET_TIMEOUT_MS      默认 120000（2min / 次子集）；0 = 不限時
//   NOTO_SANS_CJK_REGULAR_TTC     默认 /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
//   NOTO_SANS_CJK_BOLD_TTC        默认 …/NotoSansCJK-Bold.ttc
//   NOTO_SANS_CJK_TTC_FONT_INDEX  默认 2（SC；JP/KR/TC 順序因字型版本而異，可 env 修正）
//   page.pdf preferCSSPageSize   固定 true：尊重 HTML @page（平台横版 / 作品库直版）
// ════════════════════════════════════════════════════════════════════════════
const SCALE_FACTOR = Number(process.env.PDF_SCALE_FACTOR) || 1.35;
const POST_LAYOUT_WAIT_MS = Number(process.env.PDF_POST_LAYOUT_WAIT_MS) || 18_000;
const PER_IMAGE_WAIT_MS = Number(process.env.PDF_PER_IMAGE_WAIT_MS) || 20_000;
const ALLOWED_WAIT = new Set(["load", "domcontentloaded", "networkidle0", "networkidle2"]);
const SET_CONTENT_WAIT_RAW = (process.env.PDF_SET_CONTENT_WAIT_UNTIL || "load").toLowerCase();
const SET_CONTENT_WAIT_UNTIL = ALLOWED_WAIT.has(SET_CONTENT_WAIT_RAW)
  ? (SET_CONTENT_WAIT_RAW as "load" | "domcontentloaded" | "networkidle0" | "networkidle2")
  : "load";

const SET_CONTENT_TIMEOUT_MS = Number(process.env.PDF_SET_CONTENT_TIMEOUT_MS) || 1_800_000;

/** 決策智庫等寬幅快照：須 ≥ 儀表板 md 寬度（1680）以免 Puppeteer 排版裁切；可 env 覆寫 */
const PDF_VIEWPORT_WIDTH = Math.min(4096, Math.max(1280, Number(process.env.PDF_VIEWPORT_WIDTH) || 1920));
const PDF_VIEWPORT_HEIGHT = Math.min(8192, Math.max(800, Number(process.env.PDF_VIEWPORT_HEIGHT) || 1600));

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

/** 打印前統一為容器內 Noto CJK，減少多字體混嵌。設為 false 可回退舊版視覺。 */
const UNIFY_CJK_FONT_STACK = process.env.PDF_UNIFY_CJK_FONT_STACK !== "false";

/** 預設 true：用 pyftsubset 依 DOM 文字生成 WOFF2 子集並注入（無 Ghostscript）。 */
const PDF_FONT_SUBSET = process.env.PDF_FONT_SUBSET !== "false";
const PYFT_TIMEOUT_PARSED = Number(process.env.PDF_PYFTSUBSET_TIMEOUT_MS);
const PDF_PYFTSUBSET_TIMEOUT_MS =
  Number.isFinite(PYFT_TIMEOUT_PARSED) && PYFT_TIMEOUT_PARSED >= 0
    ? PYFT_TIMEOUT_PARSED
    : 120_000;

const NOTO_SANS_CJK_REGULAR_TTC =
  process.env.NOTO_SANS_CJK_REGULAR_TTC ||
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
const NOTO_SANS_CJK_BOLD_TTC =
  process.env.NOTO_SANS_CJK_BOLD_TTC ||
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";
const NOTO_SANS_CJK_TTC_FONT_INDEX_RAW = process.env.NOTO_SANS_CJK_TTC_FONT_INDEX;
const NOTO_SANS_CJK_TTC_FONT_INDEX_PARSED = Number(
  NOTO_SANS_CJK_TTC_FONT_INDEX_RAW !== undefined && NOTO_SANS_CJK_TTC_FONT_INDEX_RAW !== ""
    ? NOTO_SANS_CJK_TTC_FONT_INDEX_RAW
    : "2",
);
const NOTO_SANS_CJK_TTC_FONT_INDEX =
  Number.isFinite(NOTO_SANS_CJK_TTC_FONT_INDEX_PARSED) && NOTO_SANS_CJK_TTC_FONT_INDEX_PARSED >= 0
    ? Math.floor(NOTO_SANS_CJK_TTC_FONT_INDEX_PARSED)
    : 2;

console.log(
  `[pdf-worker] startup config: ` +
  `viewport=${PDF_VIEWPORT_WIDTH}x${PDF_VIEWPORT_HEIGHT}, scale=${SCALE_FACTOR}, postLayoutWaitMs=${POST_LAYOUT_WAIT_MS}, perImageWaitMs=${PER_IMAGE_WAIT_MS}, ` +
  `setContentWaitUntil=${SET_CONTENT_WAIT_UNTIL} ` +
  `setContentTimeoutMs=${SET_CONTENT_TIMEOUT_MS} ` +
  `pagePdfTimeoutMs=${PAGE_PDF_TIMEOUT_MS === 0 ? "0(disabled)" : PAGE_PDF_TIMEOUT_MS} ` +
  `preferCssPageSize=true ` +
  `unifyCjkFontStack=${UNIFY_CJK_FONT_STACK} ` +
  `pdfFontSubset=${PDF_FONT_SUBSET} pyftSubsetTimeoutMs=${PDF_PYFTSUBSET_TIMEOUT_MS === 0 ? "0(disabled)" : PDF_PYFTSUBSET_TIMEOUT_MS} ` +
  `notoTtcIndex=${NOTO_SANS_CJK_TTC_FONT_INDEX}`,
);

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
  figure:not(.cover-page) img,
  .report-raw-html figure:not(.cover-page) img,
  img:not(:is(.cover-page img)) {
    max-height: 277mm !important;
    max-width: 100% !important;
    width: auto !important;
    height: auto !important;
    object-fit: contain !important;
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
    align-items: stretch !important;
    justify-content: flex-start !important;
    box-sizing: border-box !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background-color: #fff !important;
    width: 100% !important;
    height: 297mm !important;
    max-height: 297mm !important;
    min-height: 0 !important;
    overflow: hidden !important;
    position: relative !important;
  }
  .cover-page img, .cover-page.cover-image-only img {
    position: static !important;
    display: block !important;
    flex: 1 1 auto !important;
    min-height: 0 !important;
    flex-shrink: 0 !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    object-fit: cover !important;
    object-position: center !important;
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
      viewport: { width: PDF_VIEWPORT_WIDTH, height: PDF_VIEWPORT_HEIGHT },
      scaleFactor: SCALE_FACTOR,
      postLayoutWaitMs: POST_LAYOUT_WAIT_MS,
      perImageWaitMs: PER_IMAGE_WAIT_MS,
      setContentWaitUntil: SET_CONTENT_WAIT_UNTIL,
      setContentTimeoutMs: SET_CONTENT_TIMEOUT_MS,
      pagePdfTimeoutMs: PAGE_PDF_TIMEOUT_MS,
      unifyCjkFontStack: UNIFY_CJK_FONT_STACK,
      pdfFontSubset: PDF_FONT_SUBSET,
      pyftSubsetTimeoutMs: PDF_PYFTSUBSET_TIMEOUT_MS,
      notoSansCjkRegularTtc: NOTO_SANS_CJK_REGULAR_TTC,
      notoSansCjkBoldTtc: NOTO_SANS_CJK_BOLD_TTC,
      notoSansCjkTtcFontIndex: NOTO_SANS_CJK_TTC_FONT_INDEX,
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
  // 通过对比每段 elapsed 时间精确定位 setContent / fonts.ready / page.pdf
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
      width: PDF_VIEWPORT_WIDTH,
      height: PDF_VIEWPORT_HEIGHT,
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
      `[pdf-worker:${reqId}] step1/5 setContent start (waitUntil=${SET_CONTENT_WAIT_UNTIL}, ` +
      `timeoutMs=${SET_CONTENT_TIMEOUT_MS})`,
    );
    await page.setContent(html, {
      waitUntil: SET_CONTENT_WAIT_UNTIL,
      timeout: SET_CONTENT_TIMEOUT_MS,
    });
    console.log(`[pdf-worker:${reqId}] step1/5 setContent done +${Date.now() - tSc}ms`);

    // 等所有自定义字体加载完毕 — 避免 PDF 里出现字体 fallback / 方块字
    // 用字符串 page.evaluate 避免 pdf-worker tsconfig 没 lib.dom 的编译错
    // 注意：page.evaluate 字符串形式会自动 await 表达式如果是 Promise
    const tFonts = Date.now();
    console.log(`[pdf-worker:${reqId}] step2/5 fonts.ready start`);
    await page.evaluate("document.fonts.ready");
    console.log(`[pdf-worker:${reqId}] step2/5 fonts.ready done +${Date.now() - tFonts}ms`);

    let pdfUsesInjectedSubset = false;
    if (PDF_FONT_SUBSET && UNIFY_CJK_FONT_STACK) {
      const tSub = Date.now();
      try {
        const charsFromDom = await collectPdfSubsetChars(page);
        const built = await buildSubsetFaceCss({
          charsFromDom,
          paths: {
            regularTtc: NOTO_SANS_CJK_REGULAR_TTC,
            boldTtc: NOTO_SANS_CJK_BOLD_TTC,
            fontNumber: NOTO_SANS_CJK_TTC_FONT_INDEX,
            timeoutMs: PDF_PYFTSUBSET_TIMEOUT_MS,
          },
        });
        if (built.ok) {
          await page.addStyleTag({ content: built.css });
          await page.evaluate(
            `Promise.all([
              document.fonts.load("16px '${SUBSET_FONT_FAMILY}'"),
              document.fonts.load("bold 16px '${SUBSET_FONT_FAMILY}'"),
            ]).catch(function () {})`,
          );
          await page.evaluate("document.fonts.ready");
          pdfUsesInjectedSubset = true;
          console.log(
            `[pdf-worker:${reqId}] step2b/5 pyftsubset woff2 injected +${Date.now() - tSub}ms ` +
            `domUnique=${built.domUnique} mergedUnique=${built.mergedUnique}`,
          );
        } else {
          console.warn(
            `[pdf-worker:${reqId}] step2b/5 pyftsubset skipped (${built.reason}); using system Noto`,
          );
        }
      } catch (err) {
        console.warn(
          `[pdf-worker:${reqId}] step2b/5 pyftsubset failed: ${(err as Error).message}; using system Noto`,
        );
      }
    }

    // 等大体积 data: PNG/JPEG 全部 load + decode 完再进 hard wait。
    // 否则 page.pdf() 时 naturalWidth=0 → 封面白屏 / 页数统计失真（用户实测 B 类问题）。
    const tImg = Date.now();
    console.log(`[pdf-worker:${reqId}] step3/5 images load+decode start`);
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
    console.log(`[pdf-worker:${reqId}] step3/5 images load+decode +${Date.now() - tImg}ms`);

    const tHard0 = Date.now();
    console.log(`[pdf-worker:${reqId}] step4/5 layout settle wait ${POST_LAYOUT_WAIT_MS}ms start`);
    await new Promise((r) => setTimeout(r, POST_LAYOUT_WAIT_MS));
    console.log(
      `[pdf-worker:${reqId}] step4/5 layout settle done +${Date.now() - tHard0}ms (since step1 +${Date.now() - tSc}ms)`,
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
      const printStack = pdfUsesInjectedSubset
        ? `'${SUBSET_FONT_FAMILY}', "Noto Sans CJK SC", sans-serif`
        : `"Noto Sans CJK SC", "Noto Serif CJK SC", serif`;
      await page.addStyleTag({
        content: `
          @media print {
            html, body, html body *:not(img):not(video):not(canvas) {
              font-family: ${printStack} !important;
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
      `[pdf-worker:${reqId}] step5/5 page.pdf start ` +
      `(通常最耗时；timeoutMs=${pdfTimeout === 0 ? "disabled" : pdfTimeout})`,
    );
    // preferCSSPageSize=true：尊重快照 HTML 內 @page（平台決策智庫為 A4 landscape；作品庫為 portrait），
    // 避免寬幅 Recharts 區塊在「強制 A4 直向」下被錯誤縮放出空白/截斷。
    const rawPdfBuffer = Buffer.from(
      await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
        timeout: pdfTimeout,
      }),
    );
    const pdfMb = (rawPdfBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`[pdf-worker:${reqId}] step5/5 page.pdf done +${Date.now() - tPdf}ms size=${pdfMb}MB`);

    const pdfBuffer = rawPdfBuffer;

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

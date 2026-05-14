import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer";

const execFileAsync = promisify(execFile);

/** 列印時與 index 內 @media print 對齊的家族名 */
export const SUBSET_FONT_FAMILY = "MVSPdfSubsetSans";

const BASE_SAFE_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "!@#$%^&*()_+-=[]{}|;:,.<>?/~`\"'\\ \n\r\t" +
  "，。、；：？！「」『』（）【】《》〈〉…—·￥％‰℃°×÷±§¶•";

/** NodeFilter.SHOW_TEXT = 4（避免 pdf-worker tsconfig 無 DOM lib 時引用 NodeFilter） */
const SHOW_TEXT = 4;

/**
 * 收集快照 DOM 內出現過的字元（去重），供 pyftsubset 做中文子集。
 */
export async function collectPdfSubsetChars(page: Page): Promise<string> {
  const raw = await page.evaluate(`(() => {
    var root = document.body;
    if (!root) return "";
    var walker = document.createTreeWalker(root, ${SHOW_TEXT}, null);
    var seen = {};
    var node;
    while ((node = walker.nextNode())) {
      var t = node.nodeValue;
      if (!t) continue;
      for (var i = 0; i < t.length; i++) {
        seen[t.charAt(i)] = true;
      }
    }
    return Object.keys(seen).join("");
  })()`);
  return String(raw || "");
}

export type PySubsetFontPaths = {
  regularTtc: string;
  boldTtc: string;
  fontNumber: number;
  timeoutMs: number;
};

export type BuildSubsetCssResult =
  | { ok: true; css: string; domUnique: number; mergedUnique: number }
  | { ok: false; reason: string };

function mergeChars(fromDom: string): { text: string; domUnique: number; mergedUnique: number } {
  const set = new Set<string>();
  for (const ch of BASE_SAFE_CHARS) set.add(ch);
  const domUnique = new Set<string>();
  for (const ch of fromDom) {
    set.add(ch);
    domUnique.add(ch);
  }
  const text = [...set].join("");
  return { text, domUnique: domUnique.size, mergedUnique: set.size };
}

async function pyftSubsetToWoff2(
  inputTtc: string,
  fontNumber: number,
  textFile: string,
  outputWoff2: string,
  timeoutMs: number,
): Promise<void> {
  await execFileAsync(
    "pyftsubset",
    [
      inputTtc,
      `--font-number=${fontNumber}`,
      `--text-file=${textFile}`,
      `--output-file=${outputWoff2}`,
      "--flavor=woff2",
      "--desubroutinize",
    ],
    {
      timeout: timeoutMs > 0 ? timeoutMs : undefined,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

/**
 * 以 pyftsubset（fonttools）從系統 Noto TTC 抽出本文用到的字形 → WOFF2，組成 @font-face（不改 PDF、不經 Ghostscript）。
 */
export async function buildSubsetFaceCss(args: {
  charsFromDom: string;
  paths: PySubsetFontPaths;
}): Promise<BuildSubsetCssResult> {
  const merged = mergeChars(args.charsFromDom);
  if (merged.text.length < 1) {
    return { ok: false, reason: "no_merged_chars" };
  }

  const id = randomBytes(8).toString("hex");
  const textFile = join(tmpdir(), `mvs-chars-${id}.txt`);
  const out400 = join(tmpdir(), `mvs-sub-400-${id}.woff2`);
  const out700 = join(tmpdir(), `mvs-sub-700-${id}.woff2`);

  try {
    await writeFile(textFile, merged.text, "utf8");
    await pyftSubsetToWoff2(
      args.paths.regularTtc,
      args.paths.fontNumber,
      textFile,
      out400,
      args.paths.timeoutMs,
    );
    try {
      await pyftSubsetToWoff2(
        args.paths.boldTtc,
        args.paths.fontNumber,
        textFile,
        out700,
        args.paths.timeoutMs,
      );
    } catch {
      await pyftSubsetToWoff2(
        args.paths.regularTtc,
        args.paths.fontNumber,
        textFile,
        out700,
        args.paths.timeoutMs,
      );
    }

    const buf400 = await readFile(out400);
    const buf700 = await readFile(out700);
    if (!buf400.length || !buf700.length) {
      return { ok: false, reason: "empty_woff2" };
    }

    const b64400 = buf400.toString("base64");
    const b64700 = buf700.toString("base64");
    const css =
      `@font-face{font-family:'${SUBSET_FONT_FAMILY}';font-style:normal;font-weight:400;` +
      `src:url(data:font/woff2;base64,${b64400}) format("woff2");}` +
      `@font-face{font-family:'${SUBSET_FONT_FAMILY}';font-style:normal;font-weight:700;` +
      `src:url(data:font/woff2;base64,${b64700}) format("woff2");}`;

    return {
      ok: true,
      css,
      domUnique: merged.domUnique,
      mergedUnique: merged.mergedUnique,
    };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer };
    if (err.code === "ENOENT") {
      return { ok: false, reason: "pyftsubset_not_found" };
    }
    const hint =
      (err.stderr && err.stderr.toString().slice(0, 160)) ||
      (err.stdout && err.stdout.toString().slice(0, 160)) ||
      (e instanceof Error ? e.message : String(e));
    return { ok: false, reason: hint.slice(0, 240) };
  } finally {
    await unlink(textFile).catch(() => {});
    await unlink(out400).catch(() => {});
    await unlink(out700).catch(() => {});
  }
}

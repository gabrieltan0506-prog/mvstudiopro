import fs from "node:fs";
import { buildSync } from "esbuild";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";
import {
  PDF_IMPORT_ASSETS,
  OCR_IMPORT_ASSETS,
} from "../shared/documentImportAssets";

/** Ship workers/decoders on our origin, not executable CDN scripts. */
export function documentImportAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const files = new Map<string, string>();
  const pdf = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const ocr = path.dirname(require.resolve("tesseract.js/package.json"));
  const core = path.dirname(
    createRequire(path.join(ocr, "package.json")).resolve(
      "tesseract.js-core/package.json"
    )
  );
  files.set(
    `${PDF_IMPORT_ASSETS}pdf.worker.mjs`,
    path.join(pdf, "build/pdf.worker.min.mjs")
  );
  for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
    for (const name of fs.readdirSync(path.join(pdf, dir))) {
      if (fs.statSync(path.join(pdf, dir, name)).isFile())
        files.set(
          `${PDF_IMPORT_ASSETS}${dir}/${name}`,
          path.join(pdf, dir, name)
        );
    }
  }
  files.set(
    `${OCR_IMPORT_ASSETS}worker.min.js`,
    path.join(ocr, "dist/worker.min.js")
  );
  for (const name of fs.readdirSync(core)) {
    if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(name))
      files.set(`${OCR_IMPORT_ASSETS}${name}`, path.join(core, name));
  }
  const docWorker = buildSync({
    entryPoints: [path.resolve("scripts/document-import-doc-worker.ts")],
    inject: [path.resolve("scripts/document-import-globals.ts")],
    alias: { stream: require.resolve("readable-stream/lib/ours/browser.js") },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    minify: true,
  }).outputFiles[0].contents;
  const docWorkerUrl = "/document-import/doc-1.0.4/worker.js";
  return {
    name: "document-import-runtime-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === docWorkerUrl) {
          res.setHeader("Content-Type", "text/javascript");
          return res.end(docWorker);
        }
        const file = files.get((req.url || "").split("?")[0]);
        if (!file || (req.method !== "GET" && req.method !== "HEAD"))
          return next();
        res.setHeader(
          "Content-Type",
          /\.m?js$/.test(file)
            ? "text/javascript"
            : file.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream"
        );
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: docWorkerUrl.slice(1),
        source: docWorker,
      });
      for (const [name, file] of Array.from(files.entries()))
        this.emitFile({
          type: "asset",
          fileName: name.slice(1),
          source: fs.readFileSync(file),
        });
    },
  };
}

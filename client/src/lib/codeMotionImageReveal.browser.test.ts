/** New image-wipe path only. Actual JPEG + shared studio/React preview, no movie/model. */
import { afterAll, beforeAll, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { artMotionSpecSchema } from "../../../shared/artMotion";
import {
  codeMotionPlanSceneSchema,
  resolveCodeMotionCompositionImages,
} from "../../../shared/codeMotionComposition";

type Direction = "left" | "right" | "top" | "bottom";
type Runtime = Window & {
  renderFrame: (seconds: number) => void;
  __canvas: HTMLCanvasElement;
  __bootFailed?: string;
};
let browser: Browser, server: Server, origin: string, previewBundle: string;
const observations: unknown[] = [];
const fixture = "client/public/showcase/shenzhen.jpg";
const imageId = "694b9944-ecc1-4c39-8dc9-30f1bb28b11e";
const uri = "gs://fixture/image-reveal/shenzhen.jpg";

beforeAll(async () => {
  const root = path.resolve("client/public/art-motion/engine");
  const photo = await readFile(fixture);
  observations.push({
    fixture,
    bytes: photo.length,
    sha256: createHash("sha256").update(photo).digest("hex"),
  });
  server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end('<div id="root"></div>');
        return;
      }
      if (pathname === "/photo.jpg") {
        res.setHeader("Content-Type", "image/jpeg");
        res.end(photo);
        return;
      }
      const file = path.resolve(
        root,
        pathname.replace(/^\/art-motion\/engine\//, "").replace(/^\//, "")
      );
      if (!file.startsWith(root + path.sep)) throw Error("invalid path");
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".html")
            ? "text/html"
            : "application/octet-stream"
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Preview from './client/src/components/code-motion/CodeMotionPreview';createRoot(document.getElementById('root')).render(<Preview spec={globalThis.testSpec}/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  previewBundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (process.env.INK_IMAGE_REVEAL_EVIDENCE) {
    await mkdir(path.dirname(process.env.INK_IMAGE_REVEAL_EVIDENCE), {
      recursive: true,
    });
    await writeFile(
      process.env.INK_IMAGE_REVEAL_EVIDENCE,
      JSON.stringify(observations, null, 2)
    );
  }
});

function spec(
  direction?: Direction,
  fit: "contain" | "cover" = "cover",
  rotation = 0,
  scale = 1
) {
  const scene = codeMotionPlanSceneSchema.parse({
    id: "photo",
    duration: 3,
    elements: [
      {
        id: "photo",
        type: "image",
        imageId,
        width: 0.75,
        height: 0.75,
        fit,
        revealDirection: direction,
        transform: { rotation, scale },
        keyframes: [
          { at: 0, reveal: 0 },
          { at: 2, reveal: 1 },
        ],
      },
      {
        id: "sibling",
        type: "shape",
        shape: "rect",
        width: 0.04,
        height: 0.04,
        layer: 2,
        transform: { x: 0.9, y: 0.9, fill: "#ee7700" },
      },
    ],
  });
  const parsed = artMotionSpecSchema.parse({
    version: 1,
    mode: "animation",
    grammar: "y5_kinetic_type",
    duration: 3,
    width: 1280,
    height: 720,
    fps: 30,
    background: "#112233",
    cues: [{ at: 0, kind: "image", imageUri: uri }],
    composition: resolveCodeMotionCompositionImages(
      [scene],
      [{ id: imageId, gcsUri: uri }]
    ),
  });
  return {
    ...parsed,
    cues: parsed.cues.map(cue => ({ ...cue, image: origin + "/photo.jpg" })),
  };
}

async function open(value: ReturnType<typeof spec>, preview = false) {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on(
    "request",
    request =>
      void (request.url().startsWith(origin + "/")
        ? request.continue()
        : request.abort())
  );
  if (preview) {
    await page.goto(origin);
    await page.evaluate(s => {
      (window as Window & { testSpec?: unknown }).testSpec = s;
    }, value);
    await page.addScriptTag({ content: previewBundle });
    await page.waitForFunction(
      () =>
        document.querySelector("button") &&
        !(document.querySelector("button") as HTMLButtonElement).disabled
    );
  } else {
    await page.evaluateOnNewDocument(s => {
      (window as Window & { __ART_SPEC?: unknown }).__ART_SPEC = s;
    }, value);
    await page.goto(origin + "/studio.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction("window.__productReady || window.__bootFailed");
    expect(
      await page.evaluate(() => (window as Runtime).__bootFailed)
    ).toBeUndefined();
  }
  return { page, errors };
}

const cases: {
  name: string;
  direction: Direction;
  fit: "cover" | "contain";
  rotation: number;
  scale: number;
}[] = [];
for (const direction of ["left", "right", "top", "bottom"] as const)
  for (const fit of ["cover", "contain"] as const)
    cases.push({
      name: `${direction}/${fit}`,
      direction,
      fit,
      rotation: 0,
      scale: 1,
    });
cases.push({
  name: "local-rotation-scale",
  direction: "left",
  fit: "cover",
  rotation: 35,
  scale: 0.7,
});

it.each(cases)(
  "real JPEG local wipe: $name",
  async testCase => {
    const { page, errors } = await open(
      spec(testCase.direction, testCase.fit, testCase.rotation, testCase.scale)
    );
    try {
      const result = await page.evaluate(({ direction, rotation, scale }) => {
        const runtime = window as Runtime;
        const canvas = runtime.__canvas,
          ctx = canvas.getContext("2d")!;
        const read = (time: number) => {
          runtime.renderFrame(time);
          return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const empty = read(0),
          full = read(2),
          width = canvas.width,
          height = canvas.height;
        const same = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) =>
          a[i] === b[i] &&
          a[i + 1] === b[i + 1] &&
          a[i + 2] === b[i + 2] &&
          a[i + 3] === b[i + 3];
        let photoPixels = 0;
        for (let i = 0; i < full.length; i += 4)
          if (!same(full, empty, i)) photoPixels++;
        const rows = [0.25, 0.5, 0.75, 0.5].map(progress => {
          const actual = read(progress * 2);
          const mismatchDetails: {
            point: number[];
            local: number[];
            actual: number[];
            expected: number[];
            outerEdgeDistance: number;
            maskEdgeDistance: number;
          }[] = [];
          let mismatches = 0,
            checked = 0,
            hash = 0;
          const cos = Math.cos((rotation * Math.PI) / 180),
            sin = Math.sin((rotation * Math.PI) / 180);
          const horizontal = direction === "left" || direction === "right";
          const span = (horizontal ? width : height) * 0.75;
          const endEdge = direction === "right" || direction === "bottom";
          const boundary = endEdge
            ? span / 2 - span * progress
            : -span / 2 + span * progress;
          for (let y = 1; y < height; y += 3)
            for (let x = 1; x < width; x += 3) {
              const dx = (x + 0.5 - width / 2) / scale,
                dy = (y + 0.5 - height / 2) / scale;
              const coordinate = horizontal
                ? dx * cos + dy * sin
                : -dx * sin + dy * cos;
              if (Math.abs(coordinate - boundary) < 3) continue; // Do not assert antialiasing on the mask edge.
              const localX = dx * cos + dy * sin,
                localY = -dx * sin + dy * cos,
                outerEdgeDistance = Math.min(
                  Math.abs(Math.abs(localX) - (width * 0.75) / 2),
                  Math.abs(Math.abs(localY) - (height * 0.75) / 2)
                );
              // Rotated clip rasterization differs only on the subpixel outer
              // edge (diagnostic max distance 0.9964 local px). Compare exact
              // interior pixels, excluding a bounded 1.5-local-pixel AA edge.
              if (rotation !== 0 && outerEdgeDistance < 1.5) continue;
              const visible = endEdge
                ? coordinate > boundary
                : coordinate < boundary;
              const i = (y * width + x) * 4;
              if (!same(actual, visible ? full : empty, i)) {
                mismatches++;
                const localX = dx * cos + dy * sin,
                  localY = -dx * sin + dy * cos;
                mismatchDetails.push({
                  point: [x, y],
                  local: [localX, localY],
                  actual: Array.from(actual.slice(i, i + 4)),
                  expected: Array.from(
                    (visible ? full : empty).slice(i, i + 4)
                  ),
                  outerEdgeDistance: Math.min(
                    Math.abs(Math.abs(localX) - (width * 0.75) / 2),
                    Math.abs(Math.abs(localY) - (height * 0.75) / 2)
                  ),
                  maskEdgeDistance: Math.abs(coordinate - boundary),
                });
              }
              checked++;
              hash =
                (Math.imul(hash, 31) +
                  actual[i] +
                  actual[i + 1] * 3 +
                  actual[i + 2] * 5) >>>
                0;
            }
          const marker =
            (Math.floor(height * 0.9) * width + Math.floor(width * 0.9)) * 4;
          return {
            progress,
            mismatches,
            mismatchDetails,
            checked,
            hash,
            sibling: Array.from(actual.slice(marker, marker + 4)),
          };
        });
        return { photoPixels, rows };
      }, testCase);
      observations.push({ ...testCase, ...result });
      expect(errors).toEqual([]);
      expect(result.photoPixels).toBeGreaterThan(100000);
      for (const row of result.rows) {
        expect(row.mismatches).toBe(0);
        expect(row.checked).toBeGreaterThan(95000);
        expect(row.sibling).toEqual([238, 119, 0, 255]);
      }
      expect(result.rows[1]).toEqual(result.rows[3]); // Reverse seek is deterministic.
    } finally {
      await page.close();
    }
  },
  90000
);

it("omitted direction preserves existing nonzero reveal behavior", async () => {
  const { page } = await open(spec());
  try {
    const unchanged = await page.evaluate(() => {
      const runtime = window as Runtime,
        ctx = runtime.__canvas.getContext("2d")!;
      const pixels = (time: number) => {
        runtime.renderFrame(time);
        return ctx.getImageData(0, 0, 1280, 720).data;
      };
      const partial = pixels(1),
        full = pixels(2);
      return partial.every((v, i) => v === full[i]);
    });
    expect(unchanged).toBe(true);
    observations.push({ omittedDirectionUnchanged: unchanged });
  } finally {
    await page.close();
  }
}, 30000);

async function canvasHash(page: Page, preview: boolean) {
  return page.evaluate(isPreview => {
    const w = (
      isPreview ? document.querySelector("iframe")!.contentWindow! : window
    ) as Runtime;
    const pixels = w.__canvas
      .getContext("2d")!
      .getImageData(0, 0, 1280, 720).data;
    let hash = 0;
    for (let i = 0; i < pixels.length; i++)
      hash = (Math.imul(hash, 31) + pixels[i]) >>> 0;
    return hash;
  }, preview);
}

it("React preview seek matches the formal export studio pixels", async () => {
  const value = spec("right", "cover"),
    exported = await open(value),
    preview = await open(value, true);
  try {
    await exported.page.evaluate(() => (window as Runtime).renderFrame(1));
    const expected = await canvasHash(exported.page, false);
    await preview.page.$eval('input[type="range"]', element => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(element, "1");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await preview.page.waitForFunction(
      () =>
        (document.querySelector('input[type="range"]') as HTMLInputElement)
          .value === "1"
    );
    await preview.page.evaluate(
      () =>
        new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    const actual = await canvasHash(preview.page, true);
    observations.push({ exportStudioHash: expected, reactPreviewHash: actual });
    expect(preview.errors).toEqual([]);
    expect(exported.errors).toEqual([]);
    expect(actual).toBe(expected);
  } finally {
    await exported.page.close();
    await preview.page.close();
  }
}, 30000);

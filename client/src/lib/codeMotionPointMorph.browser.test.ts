import puppeteer from "puppeteer";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  codeMotionPlanSceneSchema,
  resolveCodeMotionCompositionImages,
} from "../../../shared/codeMotionComposition";
import { artMotionSpecSchema } from "../../../shared/artMotion";

type RenderWindow = Window & {
  COMPOSITION_SPEC?: unknown;
  __ready?: boolean;
  __bootFailed?: string;
  renderFrame: (t: number) => void;
  __canvas: HTMLCanvasElement;
};
it("real canvas projects morph/orbit and reverse-seeks to exact pixels without external assets", async () => {
  const scene = codeMotionPlanSceneSchema.parse({
    id: "cloud",
    duration: 3,
    camera: { z: 4, orbitY: 0, keyframes: [{ at: 2, orbitY: 65, orbitX: 15 }] },
    elements: [
      {
        id: "cloud",
        type: "pointMorph",
        from: "sphere",
        to: "torus",
        count: 240,
        seed: 41,
        spread: 0.4,
        size: 0.005,
        transform: { fill: "#ffcc88" },
        keyframes: [
          { at: 0, morph: 0 },
          { at: 2, morph: 1 },
        ],
      },
    ],
  });
  const spec = artMotionSpecSchema.parse({
    version: 1,
    mode: "animation",
    grammar: "y5_kinetic_type",
    width: 1280,
    height: 720,
    duration: 3,
    fps: 30,
    background: "#112233",
    cues: [],
    composition: resolveCodeMotionCompositionImages([scene], []),
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    const requests: string[] = [];
    page.on("request", r => requests.push(r.url()));
    await page.setContent('<canvas id="c"></canvas>');
    await page.evaluate(value => {
      (window as RenderWindow).COMPOSITION_SPEC = value;
    }, spec);
    await page.addScriptTag({
      content: readFileSync(
        "client/public/art-motion/engine/composition.js",
        "utf8"
      ),
    });
    await page.waitForFunction("window.__ready || window.__bootFailed");
    expect(
      await page.evaluate(() => (window as RenderWindow).__bootFailed)
    ).toBeUndefined();
    const result = await page.evaluate(() => {
      const w = window as RenderWindow,
        c = w.__canvas.getContext("2d")!;
      return [0, 1, 2, 0.5, 1, 0].map(t => {
        w.renderFrame(t);
        const data = c.getImageData(0, 0, 1280, 720).data;
        let hash = 0,
          colored = 0;
        for (let i = 0; i < data.length; i += 4) {
          hash =
            (Math.imul(hash, 31) +
              data[i] +
              3 * data[i + 1] +
              5 * data[i + 2]) >>>
            0;
          if (data[i] !== 17 || data[i + 1] !== 34 || data[i + 2] !== 51)
            colored++;
        }
        return { t, hash, colored };
      });
    });
    expect(requests).toEqual([]);
    for (const f of result) expect(f.colored).toBeGreaterThan(2000);
    expect(result[0]).toEqual(result[5]);
    expect(result[1]).toEqual(result[4]);
    expect(new Set(result.slice(0, 4).map(f => f.hash)).size).toBe(4);
    if (process.env.INK_POINT_MORPH_BROWSER_EVIDENCE) {
      const file = process.env.INK_POINT_MORPH_BROWSER_EVIDENCE;
      mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
      writeFileSync(file, JSON.stringify({ requests, result }, null, 2));
    }
  } finally {
    await browser.close();
  }
}, 90000);

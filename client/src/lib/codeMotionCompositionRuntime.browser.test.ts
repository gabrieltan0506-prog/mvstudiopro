/** 开发用内存Canvas断言：不导出图片/影片，不调用模型，不替代线上媒体验收。 */
import { beforeAll, afterAll, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { codeMotionCompositionSchema } from "../../../shared/codeMotionComposition";
let browser: Browser, server: Server, origin: string;
beforeAll(async () => {
  const root = path.resolve("client/public/art-motion/engine");
  server = createServer(async (req, res) => {
    try {
      if (req.url === "/owned.png") {
        res.setHeader("content-type", "image/png");
        res.end(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
            "base64"
          )
        );
        return;
      }
      const file = path.resolve(
        root,
        decodeURIComponent(
          new URL(req.url || "/", "http://localhost").pathname
        ).slice(1)
      );
      if (!file.startsWith(root + path.sep)) throw new Error("invalid");
      res.setHeader(
        "content-type",
        (
          {
            ".js": "application/javascript",
            ".html": "text/html",
            ".woff2": "font/woff2",
            ".json": "application/json",
          } as Record<string, string>
        )[path.extname(file)] || "application/octet-stream"
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>(r => server?.close(() => r()));
});
const graph = () =>
  codeMotionCompositionSchema.parse({
    version: 1,
    scenes: [
      {
        id: "first",
        duration: 2,
        elements: [
          {
            id: "thread",
            type: "path",
            points: [
              [-0.35, 0],
              [0, -0.15],
              [0.35, 0],
            ],
            transform: { stroke: "#ffffff" },
            keyframes: [
              { at: 0, reveal: 0 },
              { at: 1, reveal: 1 },
              { at: 2, y: 0.7 },
            ],
          },
          {
            id: "cube",
            type: "mesh",
            geometry: "box",
            transform: { x: 0.5, y: 0.4, fill: "#00aaee" },
            keyframes: [
              { at: 0, rotationY: 0 },
              { at: 2, rotationY: 110, rotationX: 25 },
            ],
          },
          {
            id: "word",
            type: "text",
            text: "逐镜编排",
            fontSize: 0.08,
            transform: { y: 0.8, fill: "#ffffff" },
            keyframes: [
              { at: 0, opacity: 0 },
              { at: 0.5, opacity: 1 },
            ],
          },
          {
            id: "dust",
            type: "particles",
            seed: 17,
            count: 20,
            transform: { fill: "#ff4444" },
          },
        ],
      },
      {
        id: "second",
        duration: 2,
        transition: { type: "fade", duration: 0.3 },
        camera: {
          keyframes: [
            { at: 0, zoom: 1 },
            { at: 2, zoom: 1.3 },
          ],
        },
        elements: [
          {
            id: "thread",
            type: "path",
            points: [
              [-0.35, 0],
              [0, -0.15],
              [0.35, 0],
            ],
            continuity: "carry",
            keyframes: [{ at: 2, rotation: 45 }],
          },
          {
            id: "cube",
            type: "mesh",
            geometry: "box",
            continuity: "carry",
            keyframes: [{ at: 2, rotationY: 240 }],
          },
        ],
      },
    ],
  });
async function open(spec: any) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on(
    "request",
    r => void (r.url().startsWith(origin + "/") ? r.continue() : r.abort())
  );
  await page.evaluateOnNewDocument(s => {
    (window as any).__ART_SPEC = s;
  }, spec);
  await page.goto(origin + "/studio.html");
  await page.waitForFunction("window.__productReady || window.__bootFailed", {
    timeout: 25000,
  });
  return { page, errors };
}
const spec = () => ({
  version: 1,
  mode: "animation",
  grammar: "y5_kinetic_type",
  duration: 4,
  width: 1280,
  height: 720,
  fps: 30,
  alpha: false,
  background: "#001122",
  cues: [],
  data: {},
  composition: graph(),
});
it("真实Canvas中2D/三维对象形成非背景像素，倒序seek像素一致", async () => {
  const { page, errors } = await open(spec());
  try {
    const result = await page.evaluate(() => {
      const w = window as any;
      if (w.__bootFailed) return { failed: w.__bootFailed };
      const sample = (t: number) => {
        w.renderFrame(t);
        const p = w.__canvas
          .getContext("2d")
          .getImageData(0, 0, 1280, 720).data;
        let h = 0,
          changed = 0;
        for (let i = 0; i < p.length; i += 4) {
          h =
            (Math.imul(h, 31) +
              p[i] +
              p[i + 1] * 3 +
              p[i + 2] * 5 +
              p[i + 3]) >>>
            0;
          if (p[i] !== 0 || p[i + 1] !== 17 || p[i + 2] !== 34) changed++;
        }
        return { h, changed };
      };
      return {
        samples: [1, 3, 0.2, 1].map(sample),
        ready: w.__productReady,
        total: w.__total,
      };
    });
    expect(result.failed).toBeUndefined();
    expect(errors).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.total).toBe(4);
    expect(result.samples![0]).toEqual(result.samples![3]);
    expect(result.samples![0].changed).toBeGreaterThan(1000);
    expect(new Set(result.samples!.map(s => s.h)).size).toBe(3);
  } finally {
    await page.close();
  }
}, 40000);
it("图片缺少归属映射时显式失败且不读取gs地址", async () => {
  const s = spec();
  s.composition = codeMotionCompositionSchema.parse({
    version: 1,
    scenes: [
      {
        id: "photo",
        duration: 4,
        elements: [
          {
            id: "photo",
            type: "image",
            imageUri: "gs://test-bucket/owned/photo.png",
          },
        ],
      },
    ],
  });
  const { page } = await open(s);
  try {
    expect(await page.evaluate(() => (window as any).__bootFailed)).toContain(
      "缺少已核验素材映射"
    );
  } finally {
    await page.close();
  }
}, 40000);

it("已核验图片映射加载完成后进入画布，显式秒窗按结束边界隐藏", async () => {
  const s = {
    ...spec(),
    cues: [
      {
        at: 0,
        kind: "image",
        imageUri: "gs://test-bucket/owned/photo.png",
        image: "/owned.png",
      },
    ],
  };
  s.composition = codeMotionCompositionSchema.parse({
    version: 1,
    scenes: [
      {
        id: "photo",
        duration: 4,
        elements: [
          {
            id: "photo",
            type: "image",
            imageUri: "gs://test-bucket/owned/photo.png",
            start: 0,
            end: 1,
          },
        ],
      },
    ],
  });
  const { page, errors } = await open(s);
  try {
    const result = await page.evaluate(() => {
      const w = window as any;
      if (w.__bootFailed) return { failed: w.__bootFailed };
      const at = (t: number) => {
        w.renderFrame(t);
        return Array.from(
          w.__canvas.getContext("2d").getImageData(640, 360, 1, 1).data
        );
      };
      return { before: at(0.5), ended: at(1), backward: at(0.5) };
    });
    expect(result.failed).toBeUndefined();
    expect(errors).toEqual([]);
    expect(result.before).toEqual([255, 0, 0, 255]);
    expect(result.ended).toEqual([0, 17, 34, 255]);
    expect(result.backward).toEqual(result.before);
  } finally {
    await page.close();
  }
}, 40000);
it("跨镜carry继承上一镜终点且不回跳旧起点", async () => {
  const s = spec();
  s.composition = codeMotionCompositionSchema.parse({
    version: 1,
    scenes: [
      {
        id: "one",
        duration: 2,
        elements: [
          {
            id: "mark",
            type: "shape",
            shape: "rect",
            width: 0.1,
            height: 0.1,
            transform: { x: 0.25, fill: "#ff0000", stroke: "#ff0000" },
            keyframes: [{ at: 2, x: 0.75 }],
          },
        ],
      },
      {
        id: "two",
        duration: 2,
        elements: [
          {
            id: "mark",
            type: "shape",
            shape: "rect",
            width: 0.1,
            height: 0.1,
            continuity: "carry",
          },
        ],
      },
    ],
  });
  const { page } = await open(s);
  try {
    const pixels = await page.evaluate(() => {
      const w = window as any;
      w.renderFrame(2);
      const c = w.__canvas.getContext("2d");
      return {
        carried: Array.from(c.getImageData(960, 360, 1, 1).data),
        reset: Array.from(c.getImageData(320, 360, 1, 1).data),
      };
    });
    expect(pixels.carried).toEqual([255, 0, 0, 255]);
    expect(pixels.reset).toEqual([0, 17, 34, 255]);
  } finally {
    await page.close();
  }
}, 40000);
it("未识别元素类型明确失败", async () => {
  const s = spec();
  (s.composition.scenes[0].elements[0] as any).type = "script";
  const { page } = await open(s);
  try {
    expect(await page.evaluate(() => (window as any).__bootFailed)).toContain(
      "不支持的逐镜元素类型"
    );
  } finally {
    await page.close();
  }
}, 40000);

it.each(["box", "tetrahedron", "octahedron"] as const)(
  "%s 三维几何本身产生非空像素且相机移动改变透视",
  async geometry => {
    const s = spec();
    s.composition = codeMotionCompositionSchema.parse({
      version: 1,
      scenes: [
        {
          id: "space",
          duration: 4,
          camera: {
            keyframes: [
              { at: 0, rotationY: 0 },
              { at: 4, rotationY: 15 },
            ],
          },
          elements: [
            {
              id: "solid",
              type: "mesh",
              geometry,
              transform: { fill: "#66aaff", stroke: "#ffffff" },
              width: 0.3,
              height: 0.3,
              depth: 0.6,
            },
          ],
        },
      ],
    });
    const { page, errors } = await open(s);
    try {
      const result = await page.evaluate(() => {
        const w = window as any;
        const sample = (t: number) => {
          w.renderFrame(t);
          const p = w.__canvas
            .getContext("2d")
            .getImageData(0, 0, 1280, 720).data;
          let changed = 0,
            h = 0;
          for (let i = 0; i < p.length; i += 4) {
            if (p[i] !== 0 || p[i + 1] !== 17 || p[i + 2] !== 34) changed++;
            h = (Math.imul(h, 31) + p[i] + p[i + 1] * 3 + p[i + 2] * 5) >>> 0;
          }
          return { changed, h };
        };
        return { start: sample(0), later: sample(1.5), return: sample(0) };
      });
      expect(errors).toEqual([]);
      expect(result.start.changed).toBeGreaterThan(1000);
      expect(result.later.h).not.toBe(result.start.h);
      expect(result.return).toEqual(result.start);
    } finally {
      await page.close();
    }
  },
  40000
);
it("进入转场不延长片长且四种转场均可倒序重放", async () => {
  const s = { ...spec(), duration: 10 };
  s.composition = codeMotionCompositionSchema.parse({
    version: 1,
    scenes: ["cut", "fade", "slideLeft", "wipe", "zoom"].map((type, i) => ({
      id: `s${i}`,
      duration: 2,
      background: i % 2 ? "#ff0000" : "#0000ff",
      transition: { type, duration: type === "cut" ? 0 : 1 },
      elements: [
        {
          id: `dot${i}`,
          type: "shape",
          shape: "ellipse",
          width: 0.03,
          height: 0.03,
          transform: { fill: "#ffffff", stroke: "#ffffff" },
        },
      ],
    })),
  });
  const { page, errors } = await open(s);
  try {
    const result = await page.evaluate(() => {
      const w = window as any;
      const sample = (t: number) => {
        w.renderFrame(t);
        const p = w.__canvas.getContext("2d").getImageData(100, 100, 1, 1).data;
        return Array.from(p);
      };
      const first = [2.5, 4.5, 6.5, 8.5].map(sample);
      return {
        total: w.__total,
        first,
        back: [8.5, 6.5, 4.5, 2.5].map(sample).reverse(),
      };
    });
    expect(errors).toEqual([]);
    expect(result.total).toBe(10);
    expect(result.first).toEqual(result.back);
    expect(result.first.every(p => p[3] === 255)).toBe(true);
    expect(result.first[0][0]).toBeGreaterThan(100);
    expect(result.first[0][2]).toBeGreaterThan(100);
  } finally {
    await page.close();
  }
}, 40000);

it("粒子carry跨镜延续运动时钟，与未切镜同秒像素一致", async () => {
  const particle = {
    id: "dust",
    type: "particles",
    count: 30,
    seed: 83,
    motion: "orbit",
    speed: 0.17,
    transform: { fill: "#ffcc44" },
  };
  const one = {
    ...spec(),
    composition: codeMotionCompositionSchema.parse({
      version: 1,
      scenes: [{ id: "one", duration: 4, elements: [particle] }],
    }),
  };
  const split = {
    ...spec(),
    composition: codeMotionCompositionSchema.parse({
      version: 1,
      scenes: [
        { id: "one", duration: 2, elements: [particle] },
        {
          id: "two",
          duration: 2,
          elements: [{ ...particle, continuity: "carry" }],
        },
      ],
    }),
  };
  const a = await open(one),
    b = await open(split);
  try {
    const signature = async (page: import("puppeteer").Page) =>
      page.evaluate(() => {
        const w = window as any;
        w.renderFrame(2.75);
        const p = w.__canvas
          .getContext("2d")
          .getImageData(0, 0, 1280, 720).data;
        let h = 0;
        for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + p[i]) >>> 0;
        return h;
      });
    expect(await signature(a.page)).toBe(await signature(b.page));
  } finally {
    await a.page.close();
    await b.page.close();
  }
}, 40000);

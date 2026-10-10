import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Editor,{makeCodeMotionScene}from'./client/src/components/code-motion/CodeMotionSceneEditor';
import{codeMotionPlanSceneSchema}from'./shared/codeMotionComposition';
const prior=codeMotionPlanSceneSchema.parse({id:'prior',duration:4,elements:[{id:'priorMesh',type:'mesh',geometry:'box'},{id:'priorShape',type:'shape',shape:'rect'},{id:'priorDust',type:'particles'}]});
const first=codeMotionPlanSceneSchema.parse({id:'current',duration:4,elements:[{id:'m',type:'mesh',geometry:'box'},{id:'s',type:'shape',shape:'ellipse'},{id:'p',type:'particles'}]});
window.fixture={writes:[],scene:first,short:makeCodeMotionScene('short',.5,'短镜头','10000000-0000-4000-8000-000000000001')};
function App(){const[scene,setScene]=useState(first);window.fixture.inject=v=>{window.fixture.scene=v;setScene(v)};return <Editor scene={scene} previousScene={prior} images={[]} onChange={v=>{window.fixture.scene=v;window.fixture.valid=codeMotionPlanSceneSchema.safeParse(v).success;window.fixture.writes.push(v);setScene(v)}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: { "@shared": path.resolve("shared") },
      define: { "process.env.NODE_ENV": '"development"' },
    })
  ).outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
async function open() {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r =>
    r.isNavigationRequest()
      ? void r.respond({
          status: 200,
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
      : void r.abort()
  );
  await page.goto("http://localhost:41961/");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("details");
  await page.evaluate(() =>
    document.querySelectorAll("details").forEach(e => (e.open = true))
  );
  return { page, errors };
}
async function number(page: Page, label: string, value: string) {
  await page.evaluate(
    ({ label, value }) => {
      const el = document.querySelector(
        `[aria-label="${label}"]`
      ) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { label, value }
  );
}
it("几何、图形、粒子参数及秒窗层级写回真实场景schema", async () => {
  const { page, errors } = await open();
  try {
    await page.select('[aria-label="元素1几何形状"]', "octahedron");
    await page.select('[aria-label="元素2图形形状"]', "triangle");
    await page.select('[aria-label="元素3粒子运动"]', "burst");
    await number(page, "元素3粒子数量", "123");
    await number(page, "元素1开始出现", "0.5");
    await number(page, "元素1结束出现", "3.5");
    await number(page, "元素1画面层级", "7");
    await number(page, "元素1depth", "0.8");
    const f = await page.evaluate(() => (window as any).fixture);
    expect(f.valid).toBe(true);
    expect(f.scene.elements[0]).toMatchObject({
      geometry: "octahedron",
      start: 0.5,
      end: 3.5,
      layer: 7,
      depth: 0.8,
    });
    expect(f.scene.elements[1].shape).toBe("triangle");
    expect(f.scene.elements[2]).toMatchObject({ motion: "burst", count: 123 });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30000);
it("贯穿选择绑定真实前驱而不展示内部ID", async () => {
  const { page } = await open();
  try {
    await page.select('[aria-label="元素1与上一镜衔接"]', "priorMesh");
    const f = await page.evaluate(() => (window as any).fixture);
    expect(f.scene.elements[0]).toMatchObject({
      id: "priorMesh",
      continuity: "carry",
    });
    expect(f.valid).toBe(true);
    expect(
      await page.$eval('[aria-label="元素1与上一镜衔接"]', e => e.textContent)
    ).not.toContain("priorMesh");
  } finally {
    await page.close();
  }
}, 30000);
it("非法参数与带中间态的添加均提示并保留原稿，不抛页面异常", async () => {
  const { page, errors } = await open();
  try {
    await number(page, "元素3粒子数量", "301");
    await page.waitForSelector('[role="alert"]');
    expect(
      await page.evaluate(() => (window as any).fixture.scene.elements[2].count)
    ).toBe(60);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.inject({
        ...f.scene,
        elements: [
          ...f.scene.elements,
          {
            id: "unfinished",
            type: "text",
            text: "",
            start: 0,
            transform: {},
            keyframes: [],
            continuity: "reset",
            blend: "normal",
            layer: 0,
            fontSize: 0.08,
            font: "sans",
            weight: "bold",
            align: "center",
            maxWidth: 0.9,
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        ],
      });
    });
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        b => b.textContent?.trim() === "添加空间几何"
      );
      button!.click();
    });
    const f = await page.evaluate(() => (window as any).fixture);
    expect(f.scene.elements).toHaveLength(4);
    expect(f.scene.elements[3].text).toBe("");
    expect(f.writes).toHaveLength(0);
    expect(await page.$eval('[role="alert"]', e => e.textContent)).toContain(
      "原稿已保留"
    );
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30000);
it("半秒默认镜头动作节点严格递增且全部在镜内", async () => {
  const { page } = await open();
  try {
    const s = await page.evaluate(() => (window as any).fixture.short);
    expect(s.duration).toBe(0.5);
    for (const e of s.elements)
      expect(
        e.keyframes.every(
          (k: any, i: number) =>
            k.at <= 0.5 && (!i || k.at > e.keyframes[i - 1].at)
        )
      ).toBe(true);
  } finally {
    await page.close();
  }
}, 30000);

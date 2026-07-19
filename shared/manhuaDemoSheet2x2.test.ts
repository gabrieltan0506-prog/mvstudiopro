import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ManhuaDemoAsset } from "./manhuaScenePropDemoCatalog";
import {
  buildDemoSheet2x2Prompt,
  chunkDemoAssetsFor2x2,
  cropImage2x2ToFiles,
} from "./manhuaDemoSheet2x2";

function fake(id: string, kind: "scene" | "prop" = "scene"): ManhuaDemoAsset {
  return {
    id,
    kind,
    lane: "xianxia",
    nameZh: id,
    promptZh: "测试空镜，竖屏，禁止水印。",
    weight: "high",
  };
}

describe("manhuaDemoSheet2x2", () => {
  it("chunks scenes/props into groups of 4 with remainder singles", () => {
    const batch = [
      fake("s1"),
      fake("s2"),
      fake("s3"),
      fake("s4"),
      fake("s5"),
      fake("p1", "prop"),
      fake("p2", "prop"),
      fake("p3", "prop"),
      fake("p4", "prop"),
      fake("p5", "prop"),
    ];
    const { sheets, singles } = chunkDemoAssetsFor2x2(batch);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.map((a) => a.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(sheets[1]!.map((a) => a.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(singles.map((a) => a.id).sort()).toEqual(["p5", "s5"]);
  });

  it("builds 2x2 prompt with four slot labels", () => {
    const prompt = buildDemoSheet2x2Prompt([fake("a"), fake("b"), fake("c"), fake("d")]);
    expect(prompt).toContain("2×2");
    expect(prompt).toContain("左上");
    expect(prompt).toContain("右下");
    expect(prompt).toMatch(/禁止可读文字|禁止.*水印/);
  });

  it("crops a synthetic 2x2 sheet into four jpgs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-2x2-"));
    const sheet = path.join(dir, "sheet.png");
    const py = `
from PIL import Image, ImageDraw
im = Image.new("RGB", (200, 400), (0,0,0))
d = ImageDraw.Draw(im)
d.rectangle([0,0,99,199], fill=(255,0,0))
d.rectangle([100,0,199,199], fill=(0,255,0))
d.rectangle([0,200,99,399], fill=(0,0,255))
d.rectangle([100,200,199,399], fill=(255,255,0))
im.save(${JSON.stringify(sheet)})
`;
    expect(spawnSync("python3", ["-c", py], { encoding: "utf8" }).status).toBe(0);
    const outs: [string, string, string, string] = [
      path.join(dir, "tl.jpg"),
      path.join(dir, "tr.jpg"),
      path.join(dir, "bl.jpg"),
      path.join(dir, "br.jpg"),
    ];
    cropImage2x2ToFiles(sheet, outs);
    for (const p of outs) expect(fs.statSync(p).size).toBeGreaterThan(200);
  });
});

import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { extractPptxText } from "./documentExtract";

function buildMinimalPptx(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-fix-"));
  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>知识卡片测试标题</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>要点一：疏朗留白</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  const slidePath = path.join(dir, "ppt", "slides");
  fs.mkdirSync(slidePath, { recursive: true });
  fs.writeFileSync(path.join(slidePath, "slide1.xml"), slideXml);
  const zipPath = path.join(dir, "sample.pptx");
  execFileSync("zip", ["-r", zipPath, "ppt"], { cwd: dir });
  const buf = fs.readFileSync(zipPath);
  fs.rmSync(dir, { recursive: true, force: true });
  return buf;
}

describe("extractPptxText", () => {
  it("extracts a:t text from slides", async () => {
    const text = await extractPptxText(buildMinimalPptx());
    expect(text).toContain("知识卡片测试标题");
    expect(text).toContain("疏朗留白");
  });
});

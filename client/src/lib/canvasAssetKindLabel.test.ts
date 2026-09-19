import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { inferCanvasAssetKind, inferCanvasAssetKindFromFileName } from "./canvasUpload";
import { isCanvasVisionImageAsset } from "./canvasTypes";

it("真实上传标签将WAV识别为音频，不改变图片/视频/文档标签", () => {
 const source = readFileSync(new URL("../components/canvas/FreeformCanvas.tsx", import.meta.url), "utf8");
 const tree = ts.createSourceFile("canvas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
 let fn = "";
 const visit = (node: ts.Node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "assetKindLabel") fn = node.getText(tree);
  ts.forEachChild(node, visit);
 };
 visit(tree); expect(fn).not.toBe("");
 const label = runInNewContext(ts.transpileModule(`${fn}; assetKindLabel;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText) as (kind: string) => string;
 const fileName = "dialogue-bgm-premix-v5-家丁句-29.7s.wav";
 expect(inferCanvasAssetKind({ name: fileName, type: "audio/wav" } as File)).toBe("audio");
 expect(label(inferCanvasAssetKindFromFileName(fileName)!)).toBe("音频");
 expect(label("video")).toBe("视频"); expect(label("document")).toBe("文档"); expect(label("image")).toBe("图片");
 expect(isCanvasVisionImageAsset({ id: "test", fileName, kind: "audio", url: "https://test.invalid/master.wav", previewUrl: "" })).toBe(false);
});

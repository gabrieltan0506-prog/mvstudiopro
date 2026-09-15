import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManhuaAssetImage } from "@/components/ManhuaAssetImage";
import { resolveAssetImagePreviewUrl } from "./manhuaAssetImageSource";

const source = ts.createSourceFile(
  "ManhuaScriptWorkbench.tsx",
  readFileSync(
    new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function nodes(predicate: (node: ts.Node) => boolean) {
  const result: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
function execute(text: string, deps: Record<string, unknown>) {
  const js = ts.transpileModule(`const result = (${text});`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  return new Function("React", ...Object.keys(deps), `${js}\nreturn result;`)(
    React,
    ...Object.values(deps)
  );
}
describe("真实工作台放大与裁剪的资产身份", () => {
  it("两个人物/未分类入口都传真实资产ID，不冒充可编辑节点ID", () => {
    const calls = nodes(
      node =>
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "setSheetPreview" &&
        Boolean(node.arguments[0]?.getText(source).includes("url: ref.url"))
    ) as ts.CallExpression[];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const result = execute(call.arguments[0].getText(source), {
        ref: {
          id: "asset-b",
          url: "https://expired.example/b",
          labelZh: "同名",
        },
      });
      expect(result).toEqual({
        id: "",
        assetRefId: "asset-b",
        url: "https://expired.example/b",
        labelZh: "同名",
      });
    }
  });
  it("真实放大与裁剪JSX随同ID新地址渲染，不串同名图也不改预览快照", () => {
    const images = nodes(
      node =>
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(source) === "ManhuaAssetImage" &&
        node.getText(source).includes("resolveAssetImagePreviewUrl")
    );
    expect(images).toHaveLength(2);
    const snapshot = {
      id: "",
      assetRefId: "asset-b",
      url: "https://expired.example/b",
      labelZh: "同名",
    };
    const crop = {
      id: "asset-b",
      url: snapshot.url,
      labelZh: snapshot.labelZh,
    };
    for (const node of images) {
      const render = (url: string) =>
        renderToStaticMarkup(
          execute(node.getText(source), {
            ManhuaAssetImage,
            resolveAssetImagePreviewUrl,
            sheetPreview: snapshot,
            cropTarget: crop,
            customAssetRefs: [
              { id: "asset-a", url: "https://different.example/a" },
              { id: "asset-b", url },
            ],
          })
        );
      expect(render("https://fresh.example/b")).toContain(
        'src="https://fresh.example/b"'
      );
      expect(render("https://newer.example/b")).toContain(
        'src="https://newer.example/b"'
      );
      expect(snapshot.url).toBe("https://expired.example/b");
      expect(crop.url).toBe("https://expired.example/b");
    }
  });
});

describe("提示词审阅与引用菜单复用同图恢复", () => {
  for (const file of ["ManhuaPromptAssetChips", "ManhuaPromptMentionEditor"]) {
    it(`${file} 把资产缩略图交给恢复组件且保留原始引用`, () => {
      const input = ts.createSourceFile(file + ".tsx", readFileSync(
        new URL(`../components/${file}.tsx`, import.meta.url), "utf8"
      ), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const images: ts.JsxSelfClosingElement[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node) && node.attributes.properties.some(
          attr => ts.isJsxAttribute(attr) && attr.name.getText(input) === "src" &&
            attr.initializer?.getText(input) === "{thumb}"
        )) images.push(node);
        ts.forEachChild(node, visit);
      }
      visit(input);
      expect(images).toHaveLength(1);
      const thumb = "https://storage.googleapis.com/test-bucket/actor.png?expired=1";
      const element = execute(images[0].getText(input), { ManhuaAssetImage, thumb });
      expect(element.type).toBe(ManhuaAssetImage);
      expect(element.props.src).toBe(thumb);
      expect(renderToStaticMarkup(element)).toContain('src="' + thumb + '"');
    });
  }
});

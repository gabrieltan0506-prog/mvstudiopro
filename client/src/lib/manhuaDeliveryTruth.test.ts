import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ManhuaClipDock from "../components/canvas/ManhuaClipDock";
import ManhuaDeliveryEditSection from "../components/ManhuaDeliveryEditSection";
import { formatCineVocabMultilingualTable } from "@shared/manhuaCineVocabBank";
import {
  collectManhuaClipDockItems,
  exportManhuaProjectZip,
} from "./manhuaProjectExport";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  defaultManhuaDeliveryPackage,
  formatManhuaDeliveryPackageMarkdown,
  normalizeManhuaDeliveryPackage,
} from "@shared/manhuaDeliveryPackage";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("交付要求不冒充媒体验收", () => {
  it.each([false, true])(
    "勾选额外要求=%s，两个真实面板仍不宣称产物就绪",
    requested => {
      const pkg = defaultManhuaDeliveryPackage({ seriesTitle: "墨菁传" });
      pkg.dubbing.needDubbing = requested;
      pkg.dubbing.needMeStem = requested;
      pkg.subtitle.needSdh = requested;
      const views = [
        React.createElement(ManhuaClipDock, {
          blocks: [],
          selectedIds: new Set<string>(),
          onSelectedIdsChange: vi.fn(),
          deliveryPackage: pkg,
        }),
        React.createElement(ManhuaDeliveryEditSection, {
          deliveryPackage: pkg,
          onChange: vi.fn(),
        }),
      ];
      for (const view of views) {
        const html = renderToStaticMarkup(view);
        expect(html).toContain("交付要求");
        expect(html).toContain("不代表成品已验收");
        expect(html).not.toMatch(/交付包.*?项已就绪|7\/7|验收通过/);
      }
      expect(renderToStaticMarkup(views[0]!)).toContain(
        "下载交付说明（Markdown）"
      );
    }
  );

  it("导出的实际文档声明文件边界，保留用户要求与未勾选质检项", () => {
    const pkg = defaultManhuaDeliveryPackage({ seriesTitle: "墨菁传" });
    pkg.color.lookIntentZh = "黑奇灰黑头部与咖啡渐黑躯干";
    const md = formatManhuaDeliveryPackageMarkdown(pkg);
    expect(md).toContain("# 交付说明 · 墨菁传");
    expect(md).toContain("不包含视频、字幕文件或音频分轨");
    expect(md).toContain(pkg.color.lookIntentZh);
    expect(md).toContain("- [ ] 音频");
    expect(md).not.toContain("- [x]");
  });

  it("实际下载处理器输出非空说明文档，不请求模型或冒称媒体包", async () => {
    const source = readFileSync(
      new URL("../components/canvas/ManhuaClipDock.tsx", import.meta.url),
      "utf8"
    );
    const tree = ts.createSourceFile(
      "dock.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let callback = "";
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(tree) === "handleDownloadDeliveryNotes"
      )
        callback = node.initializer?.getText(tree) || "";
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(callback).not.toBe("");
    const code = ts.transpileModule(`(${callback})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const anchor = { href: "", download: "", click: vi.fn() };
    const createObjectURL = vi.fn((_blob: Blob) => "blob:test-delivery-notes");
    const revokeObjectURL = vi.fn();
    runInNewContext(code, {
      deliveryPkg: defaultManhuaDeliveryPackage({ seriesTitle: "墨菁传" }),
      seriesTitle: "墨菁传",
      topic: "",
      cineVocabIds: ["sz_cu"],
      formatManhuaDeliveryPackageMarkdown,
      formatCineVocabMultilingualTable,
      Blob,
      URL: { createObjectURL, revokeObjectURL },
      document: { createElement: () => anchor },
    })();
    expect(anchor.download).toBe("交付说明-墨菁传.md");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith(anchor.href);
    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob;
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(await blob.text()).toContain("不包含视频、字幕文件或音频分轨");
    expect(await blob.text()).toContain("特写");
  });

  it("实际工程 ZIP 区分要求文档与媒体，不把说明计作成功视频", async () => {
    const deliveryPackageMarkdown = formatManhuaDeliveryPackageMarkdown(
      defaultManhuaDeliveryPackage()
    );
    await expect(
      exportManhuaProjectZip({
        items: [],
        selectedIds: [],
        includeLibraryRefs: false,
        deliveryPackageMarkdown,
      })
    ).rejects.toThrow("请先勾选至少一个已有产物");
    const story = {
      ...defaultCanvasBlock("text", 0, 0),
      id: "story-e01",
      episodeIndex: 1,
      outputText: "黑奇守护阿菁",
      status: "done" as const,
    };
    const result = await exportManhuaProjectZip({
      items: collectManhuaClipDockItems([story]),
      selectedIds: [story.id],
      includeLibraryRefs: false,
      deliveryPackageMarkdown,
    });
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(result.okCount).toBe(1);
    expect(result.manifest.selected).toHaveLength(1);
    expect(result.manifest.selected[0]?.stage).toBe("story");
    expect(await zip.file("交付包.md")!.async("string")).toContain(
      "# 交付说明"
    );
    expect(await zip.file("README.md")!.async("string")).toContain(
      "不是验收回执"
    );
    expect(
      Object.keys(zip.files).filter(name => /\.(mp4|srt|wav|mp3)$/.test(name))
    ).toEqual([]);
  });

  it("真实云恢复分支遇到旧稿缺配置时复位，不沿用上一剧要求", () => {
    const source = readFileSync(
      new URL("../pages/OmniCanvas.tsx", import.meta.url),
      "utf8"
    );
    const tree = ts.createSourceFile(
      "OmniCanvas.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let statement = "";
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(tree) === "applyCloudDraftToUi" &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const callback = node.initializer.arguments[0];
        if (
          callback &&
          ts.isArrowFunction(callback) &&
          ts.isBlock(callback.body)
        ) {
          statement =
            callback.body.statements
              .find(s => s.getText(tree).includes("setDeliveryPackage("))
              ?.getText(tree) || "";
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(statement).not.toBe("");
    const code = ts.transpileModule(statement, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const setDeliveryPackage = vi.fn();
    runInNewContext(code, {
      session: { writerPack: { seriesTitle: "新剧" }, deliveryPackage: null },
      setDeliveryPackage,
      normalizeManhuaDeliveryPackage,
    });
    expect(setDeliveryPackage).toHaveBeenCalledOnce();
    expect(setDeliveryPackage.mock.calls[0]?.[0]).toMatchObject({
      seriesTitle: "新剧",
      dubbing: { needDubbing: false },
    });
  });
});

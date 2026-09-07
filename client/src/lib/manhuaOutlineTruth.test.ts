import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildManhuaAssetsGapItems,
  buildManhuaAssetsGapZh,
} from "./manhuaPhaseGapText";
import {
  buildManhuaAssetLockRegistry,
  isBindableAssetPath,
} from "@shared/manhuaAssetLockRegistry";
import { manhuaClipQualityAllowsAssemble } from "@shared/manhuaClipQuality";

// 执行生产文件的真实 useMemo 回调与 JSX 条件；仅注入外层状态，不复制判定逻辑。
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

function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error("找不到真实工作台表达式");
  return found;
}

function execute(
  expression: string,
  dependencies: Record<string, unknown>
): any {
  const code = ts.transpileModule(`const result = (${expression});`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  return new Function(
    "React",
    ...Object.keys(dependencies),
    `${code}\nreturn result;`
  )(React, ...Object.values(dependencies));
}

function jsxStarting(prefix: string, state: Record<string, unknown>) {
  const node = findNode(
    node =>
      ts.isJsxExpression(node) &&
      Boolean(node.expression?.getText(source).startsWith(prefix))
  ) as ts.JsxExpression;
  return execute(node.expression!.getText(source), state);
}

function phases(outlineConfirmed: boolean, outlineComplete: boolean) {
  const declaration = findNode(
    node =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "workflowPhases"
  ) as ts.VariableDeclaration;
  const callback = (declaration.initializer as ts.CallExpression).arguments[0]!;
  return execute(callback.getText(source), {
    outlineConfirmed,
    outlineComplete,
    stageStrip: [],
    episodeClips: [],
    segments: [],
    assetsComplete: false,
    assetGate: { ready: false, missing: [], issues: [] },
    characterIds: [],
    stylePack: null,
    assetScriptStaleHintZh: "",
    episodeStillCount: 0,
    episodeKeyarts: [],
    shots: [],
    roughClips: [],
    finalVideoUrl: "",
    dockSelectedCount: 0,
    activePhase: "outline",
    buildManhuaAssetsGapItems,
    buildManhuaAssetsGapZh,
    manhuaClipQualityAllowsAssemble,
    clipOutputUrl: () => "",
  })();
}

describe("工作台确认事实与编导能力分离", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "确认=%s、解锁=%s：真实阶段状态不误报，未确认按钮仍可触发",
    (outlineConfirmed, directorUnlocked) => {
      const outlineComplete = directorUnlocked || outlineConfirmed;
      const outline = phases(outlineConfirmed, outlineComplete).find(
        (phase: { id: string }) => phase.id === "outline"
      );
      expect(outline).toMatchObject({
        complete: outlineConfirmed,
        gapZh: outlineConfirmed ? "" : "请先确认剧本大纲",
      });
      const onConfirmOutline = vi.fn();
      const button = jsxStarting(
        "!outlineConfirmed && writerPackReady && onConfirmOutline",
        {
          outlineConfirmed,
          outlineComplete,
          writerPackReady: true,
          onConfirmOutline,
        }
      );
      const markup = renderToStaticMarkup(button);
      if (!outlineConfirmed) {
        expect(markup).toContain('data-manhua-action="confirm-outline"');
        expect(markup).not.toContain("disabled");
        button.props.onClick();
        expect(onConfirmOutline).toHaveBeenCalledOnce();
      } else expect(markup).toBe("");
      const warning = renderToStaticMarkup(
        jsxStarting("outlineComplete && !outlineConfirmed", {
          outlineComplete,
          outlineConfirmed,
        })
      );
      expect(warning.includes("当前剧本尚未确认")).toBe(
        directorUnlocked && !outlineConfirmed
      );
    }
  );

  it("无可确认剧本不渲染确认按钮，已解锁仍保留进入资产能力", () => {
    const confirm = vi.fn();
    expect(
      renderToStaticMarkup(
        jsxStarting(
          "!outlineConfirmed && writerPackReady && onConfirmOutline",
          {
            outlineConfirmed: false,
            outlineComplete: true,
            writerPackReady: false,
            onConfirmOutline: confirm,
          }
        )
      )
    ).toBe("");
    const phase = vi.fn();
    const expression = findNode(
      node =>
        ts.isJsxExpression(node) &&
        Boolean(
          node.expression?.getText(source).startsWith("outlineComplete ?")
        ) &&
        node.getText(source).includes('data-manhua-action="goto-assets"')
    ) as ts.JsxExpression;
    const button = execute(expression.expression!.getText(source), {
      outlineComplete: true,
      selectPhase: phase,
    });
    expect(renderToStaticMarkup(button)).toContain("进入资产设定");
    button.props.onClick();
    expect(phase).toHaveBeenCalledWith("assets");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("六张人物参考真实registry只有人物槽，摘要不声称全部资产齐备", () => {
    const registry = buildManhuaAssetLockRegistry({
      customRefs: Array.from({ length: 6 }, (_, index) => ({
        id: `test-character-${index}`,
        role: "character" as const,
        url: `https://test.invalid/character-${index}.png`,
        labelZh: `人物参考${index + 1}`,
      })),
    });
    expect(registry.byRole.character).toHaveLength(6);
    expect(registry.byRole.scene).toHaveLength(0);
    expect(registry.byRole.prop).toHaveLength(0);
    const expression = findNode(
      node =>
        ts.isJsxExpression(node) &&
        Boolean(node.expression?.getText(source).startsWith("compactUi")) &&
        node.getText(source).includes("已有引用均已挂图")
    ) as ts.JsxExpression;
    const markup = renderToStaticMarkup(
      execute(expression.expression!.getText(source), {
        compactUi: true,
        assetLockRegistry: registry,
        isBindableAssetPath,
      })
    );
    expect(markup).toContain("已挂图 6");
    expect(markup).toContain("已有引用均已挂图");
    expect(markup).not.toContain("全部就位");
    expect(
      phases(false, true).find((phase: { id: string }) => phase.id === "assets")
        .complete
    ).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  setManhuaSegmentLookBinding,
  upsertManhuaCharacterLookSet,
} from "@shared/manhuaCharacterLookSets";

const source = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8"
);
const tree = ts.createSourceFile(
  "workbench.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

// 渲染并执行实际 JSX 的控件事件；不启动浏览器、不请求任何图片或生产服务。
function control(marker: string, scope: Record<string, unknown>) {
  let jsx = "";
  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(tree) === "select" &&
      node.openingElement.getText(tree).includes(marker)
    )
      jsx = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!jsx) throw new Error(`真实控件不存在：${marker}`);
  const code = ts.transpileModule(`(${jsx})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return runInNewContext(code, { React, ...scope }) as React.ReactElement<{
    onChange: (event: { target: { value: string } }) => void;
    disabled?: boolean;
  }>;
}

describe("造型控件的真实事件及渲染", () => {
  it("角色候选挂为造型时不改角色 ID，不把人物图误存为服装特写", () => {
    const onChange = vi.fn();
    const element = control("参考图", {
      ch: { id: "heiqi", labelZh: "黑奇" },
      idx: 2,
      ls: {
        id: "heiqi-during",
        characterId: "heiqi",
        index: 2,
        labelZh: "变身过程",
      },
      lookRefs: [
        { id: "during-image", role: "character", labelZh: "变身过程" },
      ],
      resolvedLookSets: [
        {
          id: "heiqi-before",
          characterId: "heiqi",
          index: 1,
          labelZh: "变身前",
        },
      ],
      onCharacterLookSetsChange: onChange,
      upsertManhuaCharacterLookSet,
    });
    expect(renderToStaticMarkup(element)).toContain("黑奇造型2参考图");
    element.props.onChange({ target: { value: "during-image" } });
    expect(onChange.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "heiqi-before", characterId: "heiqi" }),
        expect.objectContaining({
          id: "heiqi-during",
          characterId: "heiqi",
          lookRefId: "during-image",
          wardrobeRefId: undefined,
        }),
      ])
    );
  });

  it("本段选择只改当前集段，缺参考选项禁用，运行中禁用控件", () => {
    const changed = vi.fn();
    const bindings = {
      "e1:s1": { heiqi: "before" },
      "e2:s1": { heiqi: "before" },
    };
    const scope = {
      character: { labelZh: "黑奇" },
      characterId: "heiqi",
      selected: "",
      factoryBusy: false,
      sets: [
        { id: "after", labelZh: "变身后", lookRefId: "after-image" },
        { id: "missing", labelZh: "缺图" },
      ],
      selectableRefs: [{ id: "after-image" }],
      segmentLookBindings: bindings,
      focusEpisode: 1,
      activeSegNo: 2,
      onSegmentLookBindingsChange: changed,
      setManhuaSegmentLookBinding,
    };
    const element = control("本段造型", scope);
    expect(renderToStaticMarkup(element)).toMatch(
      /value="missing" disabled=""/
    );
    element.props.onChange({ target: { value: "after" } });
    expect(changed.mock.calls[0]?.[0]).toEqual({
      ...bindings,
      "e1:s2": { heiqi: "after" },
    });
    expect(
      control("本段造型", { ...scope, factoryBusy: true }).props.disabled
    ).toBe(true);
  });

  it("本机保存入口包含造型及段绑定，不依赖云同步登录", () => {
    const host = readFileSync(
      new URL("../pages/OmniCanvas.tsx", import.meta.url),
      "utf8"
    );
    const localSave =
      host.split("saveManhuaWriterSessionToStorage({")[1]?.split("});")[0] ||
      "";
    expect(localSave).toContain("characterLookSets,");
    expect(localSave).toContain("segmentLookBindings,");
    expect(source).toContain("lookRefs: customAssetRefs");
    expect(source).toContain(
      "listManhuaLookReferenceCandidates(customAssetRefs, ch.id)"
    );
  });
});

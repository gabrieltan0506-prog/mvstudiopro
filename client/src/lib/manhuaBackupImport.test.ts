import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { collectManhuaBackupImageSources } from "./manhuaBackupImageSources";
import { prepareManhuaBackupRestore } from "./manhuaBackupRestorePreflight";

// 提取真实页面回调，只注入 ZIP、存储和 UI 边界，不复制导入业务逻辑。
function importCallback(deps: Record<string, unknown>) {
  const source = ts.createSourceFile(
    "OmniCanvas.tsx",
    readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callbackText = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "importBackupFile" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callbackText = node.initializer.arguments[0]!.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callbackText) throw new Error("找不到真实备份导入回调");
  callbackText = callbackText.replace(
    /import\("jszip"\)/g,
    'loadModule("jszip")'
  );
  const compiled = ts.transpileModule(`const callback = ${callbackText};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...Object.keys(deps), `${compiled}\nreturn callback;`)(
    ...Object.values(deps)
  ) as (file: { name: string; text?: () => Promise<string> }) => Promise<void>;
}

type ImageRecord = { sourceUrl: string; blob: Blob; mime: string };
const draft = {
  writerSession: {},
  canvas: { blocks: [{ id: "restored-block" }], edges: [] },
  clientUpdatedAt: "2026-09-07T12:00:00Z",
};
const manifest = [
  {
    file: "images/one.png",
    sourceUrl: "https://test.example/one.png",
    mime: "image/png",
  },
  {
    file: "images/two.png",
    sourceUrl: "https://test.example/two.png",
    mime: "image/png",
  },
];

function setup(
  options: {
    confirm?: boolean;
    manifest?: unknown;
    missingImage?: boolean;
    emptyImage?: boolean;
    storeFail?: boolean;
    invalidImage?: boolean;
    draft?: unknown;
  } = {}
) {
  const events: string[] = [];
  const files: Record<string, string | Blob> = {
    "snapshot.json": JSON.stringify(options.draft ?? draft),
    "assets-manifest.json": JSON.stringify(options.manifest ?? manifest),
    "images/one.png": new Blob(["test-image-one"], { type: "image/png" }),
    "images/two.png": new Blob(options.emptyImage ? [] : ["test-image-two"], {
      type: "image/png",
    }),
  };
  if (options.missingImage) delete files["images/two.png"];
  const zip = {
    file: (name: string) =>
      files[name] === undefined
        ? null
        : {
            async: vi.fn(async () => {
              events.push(`read:${name}`);
              return files[name];
            }),
          },
  };
  const confirm = vi.fn(() => {
    events.push("confirm");
    return options.confirm ?? true;
  });
  const store = vi.fn(async (records: ImageRecord[]) => {
    events.push("store");
    if (options.storeFail) throw new Error("测试媒体库事务失败");
    return records.length;
  });
  const oldStore = vi.fn(async () => {
    events.push("old-store");
  });
  const apply = vi.fn(() => {
    events.push("apply");
  });
  const toast = { success: vi.fn(), error: vi.fn() };
  const run = importCallback({
    loadModule: vi.fn(async () => ({
      default: { loadAsync: vi.fn(async () => zip) },
    })),
    crypto: webcrypto,
    Blob,
    window: { confirm },
    importLocalMediaRecords: store,
    collectManhuaBackupImageSources,
    prepareManhuaBackupRestore,
    assertManhuaBackupImage: vi.fn(async () => {
      if (options.invalidImage) throw new Error("备份图片无法解码");
    }),
    assetImageGcsUri: () => undefined,
    putLocalMediaRecord: oldStore,
    countDraftPayloadStats: () => ({ nodes: 1, images: 2 }),
    latestDraftSnapshotRef: { current: null },
    buildLocalCloudDraftSnapshot: (value: unknown) => value,
    applyCloudDraftToUi: apply,
    toast,
  });
  return { run, events, confirm, store, oldStore, apply, toast };
}

describe("真实备份导入确认与原子存储边界", () => {
  it("取消导入后媒体库和工作区均零写入", async () => {
    const state = setup({ confirm: false });
    await state.run({ name: "test-backup.zip" });
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.oldStore).not.toHaveBeenCalled();
    expect(state.store).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.toast.success).not.toHaveBeenCalled();
  });

  it.each([
    ["坏清单", { manifest: {} }],
    ["缺少后续图片", { missingImage: true }],
    ["后续图片为空", { emptyImage: true }],
    ["图片解码失败", { invalidImage: true }],
    ["缺少编剧会话", { draft: { canvas: { blocks: [] } } }],
    ["会话为数组", { draft: { ...draft, writerSession: [] } }],
    ["空节点", { draft: { ...draft, canvas: { blocks: [null] } } }],
    ["错误连线", { draft: { ...draft, canvas: { blocks: [], edges: {} } } }],
    [
      "错误历史图列表",
      {
        draft: {
          ...draft,
          canvas: { blocks: [{ id: "x", outputUrls: "wrong-type" }] },
        },
      },
    ],
    [
      "错误人物设定表",
      {
        draft: {
          ...draft,
          writerSession: {
            projectBible: { assetCanon: { characters: [null] } },
          },
        },
      },
    ],
    [
      "错误道具列表",
      {
        draft: {
          ...draft,
          writerSession: { projectBible: { cast: { propIds: "wrong-type" } } },
        },
      },
    ],
  ] as const)("%s 在确认前拒绝，不能局部写入", async (_label, options) => {
    const state = setup(options);
    await state.run({ name: "test-backup.zip" });
    expect(state.oldStore).not.toHaveBeenCalled();
    expect(state.store).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.toast.error).toHaveBeenCalledOnce();
  });

  it("全部图片解析后确认，一次存储真实字节，再回填一次工作区", async () => {
    const state = setup();
    await state.run({ name: "test-backup.zip" });
    expect(state.oldStore).not.toHaveBeenCalled();
    expect(state.store).toHaveBeenCalledOnce();
    const records = state.store.mock.calls[0]![0];
    expect(records.map(({ sourceUrl, mime }) => ({ sourceUrl, mime }))).toEqual(
      manifest.map(({ sourceUrl, mime }) => ({ sourceUrl, mime }))
    );
    expect(
      await Promise.all(records.map(record => record.blob.text()))
    ).toEqual(["test-image-one", "test-image-two"]);
    expect(state.events).toEqual([
      "read:snapshot.json",
      "read:assets-manifest.json",
      "read:images/one.png",
      "read:images/two.png",
      "confirm",
      "store",
      "apply",
    ]);
    expect(state.apply).toHaveBeenCalledOnce();
    expect(state.apply).toHaveBeenCalledWith(draft);
    expect(state.toast.success).toHaveBeenCalledOnce();
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it("媒体库事务失败不回填 UI，不报导入成功", async () => {
    const state = setup({ storeFail: true });
    await state.run({ name: "test-backup.zip" });
    expect(state.store).toHaveBeenCalledOnce();
    expect(state.oldStore).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.toast.success).not.toHaveBeenCalled();
    expect(state.toast.error).toHaveBeenCalledWith("测试媒体库事务失败");
  });

  it.each([false, true])("旧 JSON 备份确认=%s，不触碰媒体库", async confirm => {
    const state = setup({ confirm });
    await state.run({
      name: "legacy.json",
      text: async () => JSON.stringify(draft),
    });
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.oldStore).not.toHaveBeenCalled();
    expect(state.store).not.toHaveBeenCalled();
    expect(state.apply).toHaveBeenCalledTimes(confirm ? 1 : 0);
    if (confirm) expect(state.apply).toHaveBeenCalledWith(draft);
    expect(state.toast.error).not.toHaveBeenCalled();
  });
});

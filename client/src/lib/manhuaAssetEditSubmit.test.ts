import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
import { buildManhuaAssetImageEditPrompt } from "@shared/manhuaAssetImageEdit";
import { normalizeManhuaCustomAssetRefs } from "@shared/manhuaCustomAssetRefs";
import {
  assetImageGcsUri,
  prepareAssetImageEdit,
} from "./manhuaAssetImageSource";
import { resolveCanvasMaterialUrl } from "./omniCanvasApi";

vi.mock("./omniCanvasApi", () => ({ resolveCanvasMaterialUrl: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const source = ts.createSourceFile(
  "OmniCanvas.tsx",
  readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function callback(name: string, deps: Record<string, unknown>) {
  let text = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      text = node.initializer.arguments[0]!.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!text) throw new Error(`找不到真实回调：${name}`);
  const compiled = ts.transpileModule(`const callback = ${text};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...Object.keys(deps), `${compiled}\nreturn callback;`)(
    ...Object.values(deps)
  );
}
function setup(failure = false) {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 474;
      naturalHeight = 265;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => (failure ? this.onerror?.() : this.onload?.()));
      }
    }
  );
  vi.mocked(resolveCanvasMaterialUrl).mockResolvedValue(
    "https://fresh.example/original.jpg"
  );
  const original = {
    id: "original",
    url: "https://expired.example/original.jpg",
    gcsUri: "gs://test-bucket/uploads/u1/original.jpg",
    role: "character",
    labelZh: "墨屠",
    source: "upload",
  };
  let refs: any[] = [original];
  const queue = vi.fn(async () => ({ jobId: "edit-test-job" }));
  const poll = vi.fn(async () => ({
    status: "succeeded",
    output: {
      imageUrl:
        "https://storage.googleapis.com/test-bucket/generated/edit/new.png?test=1",
    },
  }));
  const busy = vi.fn();
  const deps = {
    assetStandardizeBusyId: null,
    customAssetRefs: refs,
    user: { id: 1 },
    buildManhuaAssetImageEditPrompt,
    buildCanvasGptImage2JobInput,
    prepareAssetImageEdit,
    assetImageGcsUri,
    manhuaAssetStandardizeCredits: () => 3,
    window: { confirm: () => true },
    setAssetStandardizeBusyId: busy,
    createJobSameOrigin: queue,
    pollJobUntilTerminal: poll,
    normalizeManhuaCustomAssetRefs,
    makeManhuaCustomAssetId: () => "new-ref",
    setCustomAssetRefs: (update: (prev: any[]) => any[]) => {
      refs = update(refs);
    },
    toast: { success: vi.fn(), error: vi.fn() },
  };
  return { deps, original, queue, poll, busy, getRefs: () => refs };
}

describe("真实资产按钮到队列与新图回写", () => {
  it("真实编辑回调取消或失败返回 false，成功追加才返回 true", async () => {
    const cancelled = setup();
    cancelled.deps.window.confirm = () => false;
    expect(
      await callback("editCustomAsset", cancelled.deps)("original", "保留黑翼")
    ).toBe(false);
    expect(cancelled.queue).not.toHaveBeenCalled();
    const failed = setup(true);
    expect(
      await callback("editCustomAsset", failed.deps)("original", "保留黑翼")
    ).toBe(false);
    expect(failed.queue).not.toHaveBeenCalled();
    const succeeded = setup();
    expect(
      await callback("editCustomAsset", succeeded.deps)("original", "保留黑翼")
    ).toBe(true);
    expect(succeeded.getRefs()).toHaveLength(2);
  });
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 消费续签原图；普通编辑横版，标准化人物仍竖版",
    async name => {
      const state = setup();
      await callback(name, state.deps)(
        "original",
        name === "standardizeCustomAsset" ? "medium" : "保留黑翼，补全四肢"
      );
      expect(state.queue).toHaveBeenCalledOnce();
      const sent = state.queue.mock.calls[0] as unknown as [
        { input: { params: Record<string, unknown> } },
      ];
      expect(sent[0].input.params).toMatchObject({
        aspectRatio: name === "standardizeCustomAsset" ? "9:16" : "16:9",
        referenceImageUrls: ["https://fresh.example/original.jpg"],
        assetRefId: "original",
        assetStandardizeQuality: "medium",
      });
      expect(state.poll).toHaveBeenCalledWith(
        "edit-test-job",
        expect.any(Object)
      );
      expect(state.getRefs()).toHaveLength(2);
      expect(state.getRefs()[0].url).toBe(state.original.url);
      expect(state.getRefs()[1]).toMatchObject({
        id: "new-ref",
        gcsUri: "gs://test-bucket/generated/edit/new.png",
        source: "generated",
        primaryBindings: [],
      });
      expect(state.getRefs()[1].sourceWidth).toBeUndefined();
      expect(state.busy).toHaveBeenLastCalledWith(null);
    }
  );
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 原图读取失败零提交、旧图不变",
    async name => {
      const state = setup(true);
      await callback(name, state.deps)(
        "original",
        name === "standardizeCustomAsset" ? "medium" : "保留黑翼"
      );
      expect(state.queue).not.toHaveBeenCalled();
      expect(state.poll).not.toHaveBeenCalled();
      expect(state.getRefs()).toEqual([state.original]);
      expect(state.deps.toast.error).toHaveBeenCalledOnce();
      expect(state.busy).toHaveBeenLastCalledWith(null);
    }
  );
});

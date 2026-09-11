import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
import { buildManhuaAssetImageEditPrompt } from "@shared/manhuaAssetImageEdit";
import { manhuaAssetStandardizeCredits } from "@shared/manhuaAssetStandardize";
import { normalizeManhuaCustomAssetRefs } from "@shared/manhuaCustomAssetRefs";
import {
  assetImageGcsUri,
  prepareAssetImageEdit,
} from "./manhuaAssetImageSource";
import { resolveCanvasMaterialUrl } from "./omniCanvasApi";
import { readOpenAiImageVariantPref } from "./openaiImageVariantPref";
import { OPENAI_IMAGE_VARIANT_STORAGE_KEY } from "@shared/openaiImageVariant";

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
/**
 * 真实回调里出现、但 deps 没提供的标识符 = 注入过期。
 * 必须在执行前显式报错：回调内部 try/catch 会把 ReferenceError 吞成一句 toast，
 * 于是「建单一次都没发生」被误读成护栏生效（0911 就是这样红了十四条还没人看出原因）。
 */
function assertNoMissingDeps(name: string, source: string, deps: Record<string, unknown>) {
  const provided = new Set([...Object.keys(deps), "callback"]);
  const globals = new Set([
    "String", "Number", "Boolean", "Object", "Array", "JSON", "Math", "Date", "Promise",
    "Error", "Set", "Map", "console", "undefined", "null", "true", "false", "async", "await",
  ]);
  const missing = new Set<string>();
  const sf = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declared = new Set<string>();
  const collectDeclared = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    ts.forEachChild(node, collectDeclared);
  };
  collectDeclared(sf);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const id = node.expression.text;
      if (!provided.has(id) && !globals.has(id) && !declared.has(id)) missing.add(id);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (missing.size > 0) {
    throw new Error(
      `真实回调 ${name} 用到了未注入的依赖：${Array.from(missing).join("、")}。`
      + "请把它们加进 deps（用真实实现），否则回调会在 try/catch 里静默失败，测试变成空跑。",
    );
  }
}

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
  assertNoMissingDeps(name, text, deps);
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
    readOpenAiImageVariantPref,
    assetStandardizeBusyId: null,
    assetActionLocked: { current: false },
    confirmAssetAction: vi.fn(
      async (_options: {
        title: string;
        description: string;
        details: string;
      }) => true
    ),
    customAssetRefs: refs,
    user: { id: 1 },
    buildManhuaAssetImageEditPrompt,
    buildCanvasGptImage2JobInput,
    prepareAssetImageEdit,
    assetImageGcsUri,
    manhuaAssetStandardizeCredits,
    readOpenAiImageVariantPref,
    window: {
      confirm: () => {
        throw new Error("禁止原生费用确认");
      },
    },
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
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 消费三档实际偏好，双档选择仍只提交一张且不重复建单",
    async name => {
      for (const mode of ["flare", "sunburst", "both"] as const) {
        const read = vi.fn((key: string) => key === OPENAI_IMAGE_VARIANT_STORAGE_KEY ? mode : null);
        vi.stubGlobal("localStorage", { getItem: read });
        const state = setup();
        await callback(name, state.deps)("original", name === "standardizeCustomAsset" ? "medium" : "保留黑翼");
        expect(read).toHaveBeenCalledWith(OPENAI_IMAGE_VARIANT_STORAGE_KEY);
        expect(state.queue).toHaveBeenCalledOnce();
        expect((state.queue.mock.calls[0] as any)[0].input.params.openaiImageVariant).toBe(mode === "both" ? "flare" : mode);
        expect(state.poll).toHaveBeenCalledOnce();
        expect(state.getRefs()).toHaveLength(2);
        expect(state.getRefs()[0]).toEqual(normalizeManhuaCustomAssetRefs([state.original])[0]);
      }
    }
  );
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 建单失败、任务失败和空产物不追加旧图，不自动重试",
    async name => {
      for (const failure of ["enqueue", "poll", "failed", "empty", "invalid"]) {
        const state = setup();
        if (failure === "enqueue")
          state.queue.mockRejectedValueOnce(new Error("测试建单失败"));
        if (failure === "poll")
          state.poll.mockRejectedValueOnce(
            new Error("测试轮询超时，任务状态未定")
          );
        if (failure === "failed")
          state.poll.mockResolvedValueOnce({
            status: "failed",
            output: { imageUrl: "" },
          });
        if (failure === "empty")
          state.poll.mockResolvedValueOnce({
            status: "succeeded",
            output: { imageUrl: "" },
          });
        if (failure === "invalid")
          state.poll.mockResolvedValueOnce({
            status: "succeeded",
            output: { imageUrl: "http://invalid.example/image.png" },
          });
        await callback(name, state.deps)("original", "medium");
        expect(state.queue).toHaveBeenCalledOnce();
        expect(state.poll).toHaveBeenCalledTimes(failure === "enqueue" ? 0 : 1);
        expect(state.getRefs()).toEqual([state.original]);
        expect(state.deps.assetActionLocked.current).toBe(false);
        expect(state.busy).toHaveBeenLastCalledWith(null);
        expect(state.deps.toast.success).not.toHaveBeenCalled();
        expect(state.deps.toast.error).toHaveBeenCalledOnce();
      }
    }
  );
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 确认等待期零读取零建单，跨入口同帧重入被阻止，取消后可再次操作",
    async name => {
      const state = setup();
      let decide!: (accepted: boolean) => void;
      state.deps.confirmAssetAction.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            decide = resolve;
          })
      );
      const run = callback(name, state.deps);
      const argument =
        name === "standardizeCustomAsset" ? "high" : "补齐第四尾";
      const pending = run("original", argument);
      expect(state.deps.assetActionLocked.current).toBe(true);
      expect(state.deps.confirmAssetAction).toHaveBeenCalledOnce();
      expect(resolveCanvasMaterialUrl).not.toHaveBeenCalled();
      expect(state.queue).not.toHaveBeenCalled();
      expect(state.poll).not.toHaveBeenCalled();
      for (const other of [
        "editCustomAsset",
        "detextCustomAsset",
        "standardizeCustomAsset",
      ]) {
        await callback(other, state.deps)("original", "medium");
      }
      expect(state.deps.confirmAssetAction).toHaveBeenCalledOnce();
      decide(false);
      await pending;
      expect(state.deps.assetActionLocked.current).toBe(false);
      expect(state.queue).not.toHaveBeenCalled();
      expect(state.getRefs()).toEqual([state.original]);
      await run("original", argument);
      expect(state.queue).toHaveBeenCalledOnce();
      expect(state.getRefs()).toHaveLength(2);
    }
  );
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 确认后任务未结束也不能经另一入口建第二单",
    async name => {
      const state = setup();
      let finish!: (result: Awaited<ReturnType<typeof state.poll>>) => void;
      state.poll.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      );
      const pending = callback(name, state.deps)("original", "medium");
      await vi.waitFor(() => expect(state.poll).toHaveBeenCalledOnce());
      await callback("editCustomAsset", state.deps)("original", "第二个修改");
      expect(state.queue).toHaveBeenCalledOnce();
      expect(state.deps.confirmAssetAction).toHaveBeenCalledOnce();
      finish({
        status: "succeeded",
        output: {
          imageUrl:
            "https://storage.googleapis.com/test-bucket/generated/edit/new.png",
        },
      });
      await pending;
      expect(state.deps.assetActionLocked.current).toBe(false);
      expect(state.getRefs()).toHaveLength(2);
    }
  );
  it("高质确认仍为 5 分且请求 high；编辑预览包含当前中文，不修改实际 prompt", async () => {
    const state = setup();
    await callback("standardizeCustomAsset", state.deps)("original", "high");
    expect(state.deps.confirmAssetAction.mock.calls[0]?.[0]).toMatchObject({
      title: "确认资产标准化费用",
      details: "参考图：墨屠",
    });
    expect(
      state.deps.confirmAssetAction.mock.calls[0]?.[0].description
    ).toContain("高质：5 积分/张");
    expect(
      (state.queue.mock.calls[0] as any)[0].input.params.assetStandardizeQuality
    ).toBe("high");
    const edited = setup();
    const text = "保留黑翼。\n补齐四条完整尾巴。";
    await callback("editCustomAsset", edited.deps)("original", text);
    expect(edited.deps.confirmAssetAction.mock.calls[0]?.[0].details).toBe(
      `参考图：墨屠\n修改要求：${text}`
    );
    expect(
      edited.deps.confirmAssetAction.mock.calls[0]?.[0].description
    ).toContain("3 积分/张");
    expect((edited.queue.mock.calls[0] as any)[0].input.params.prompt).toBe(
      buildManhuaAssetImageEditPrompt(text)
    );
  });
  it.each(["editCustomAsset", "detextCustomAsset", "standardizeCustomAsset"])(
    "%s 确认异常仍释放同步锁，零建单且不自动重试",
    async name => {
      const state = setup();
      state.deps.confirmAssetAction.mockRejectedValueOnce(
        new Error("测试确认被关闭")
      );
      await callback(name, state.deps)("original", "medium");
      expect(state.deps.assetActionLocked.current).toBe(false);
      expect(state.queue).not.toHaveBeenCalled();
      expect(state.getRefs()).toEqual([state.original]);
      expect(state.deps.toast.error).toHaveBeenCalledOnce();
    }
  );
  it("真实编辑回调取消或失败返回 false，成功追加才返回 true", async () => {
    const cancelled = setup();
    cancelled.deps.confirmAssetAction.mockResolvedValue(false);
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

describe("测试挂架自身的护栏（0911）", () => {
  it("真实回调用到未注入的依赖时，当场报错而不是静默空跑", () => {
    const state = setup();
    const { readOpenAiImageVariantPref: _drop, ...withoutVariant } = state.deps as Record<string, unknown>;
    expect(() => callback("editCustomAsset", withoutVariant)).toThrow(/未注入的依赖：readOpenAiImageVariantPref/);
  });

  it("出图载荷带上官方档位字段（0909 双档开关），不是悄悄丢掉", async () => {
    const state = setup();
    await callback("editCustomAsset", state.deps)("original", "把衣服换成红色");
    expect(state.queue).toHaveBeenCalledOnce();
    const calls = state.queue.mock.calls as unknown as Array<Array<{ input?: { params?: Record<string, unknown> } }>>;
    const payload = calls[0]?.[0];
    expect(payload.input?.params).toMatchObject({
      openaiImageVariant: readOpenAiImageVariantPref(),
    });
  });
});

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  buildManhuaWriterSession,
  parseManhuaWriterSession,
  serializeManhuaWriterSession,
} from "@shared/manhuaWriterSession";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "@shared/manhuaCloudDraft";

// 执行生产 TSX 中的真实回调，不复制一份导入状态转换冒充验收。
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
let callback = "";
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(tree) === "importWriterRoomFromText"
  ) {
    if (node.initializer && ts.isCallExpression(node.initializer))
      callback = node.initializer.arguments[0]!.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!callback) throw new Error("未找到生产剧本导入回调");
const executable = ts.transpileModule(`(${callback})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(
  options: {
    invalid?: boolean;
    newSeries?: boolean;
    allowBackup?: boolean;
  } = {}
) {
  const refs = [
    {
      id: "heiqi-before",
      url: "https://example.com/heiqi.png",
      role: "character",
      labelZh: "黑奇变身前",
    },
  ];
  const pack = {
    seriesTitle: "墨菁传",
    logline: "黑奇守护阿菁",
    charactersMd: "黑奇与阿菁",
    propsMd: "药筐",
    locationsMd: "坊市",
    episodes: [
      {
        index: 1,
        title: "驮兽开口",
        body: "黑奇金鳞自蹄踝显现",
        endHook: "曹三水中倒影",
      },
    ],
    rawMarkdown: "# 墨菁传\n## 第1集 驮兽开口",
    episodeCount: 1,
  };
  const state: Record<string, unknown> = {
    writerPack: pack,
    writerConfirmed: true,
    directorUnlocked: true,
    assetsSkipped: true,
    workflowPhase: "final",
    projectBible: { old: true },
    customAssetRefs: refs,
  };
  const setters = Object.fromEntries(
    Array.from(callback.matchAll(/\b(set[A-Z]\w*)\(/g)).map(m => [
      m[1]!,
      vi.fn((value: unknown) => {
        const key = m[1]!.slice(3);
        state[key[0]!.toLowerCase() + key.slice(1)] = value;
      }),
    ])
  );
  const context = {
    ...setters,
    factoryTopic: "墨菁传",
    writerEpisodeCount: 1,
    writerPack: pack,
    projectBible: null,
    writerLayoutProfile: {},
    blocks: [],
    edges: [],
    customAssetRefs: refs,
    selectedCharacterIds: [],
    factoryArtStyleId: "",
    factorySceneId: "",
    directorBoardMainByEpisode: {},
    directorBoardBySegment: {},
    directorBoardMotionOverlayBySegment: {},
    abortRef: { current: null },
    materializedBoardIdsRef: { current: new Set() },
    toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
    pushDebug: vi.fn(),
    importManhuaWriterPackFromText: vi.fn(() =>
      options.invalid
        ? { ok: false, error: "缺少分集正文" }
        : { ok: true, pack, via: "text" }
    ),
    inspectManhuaSeriesSwitchRisk: () => ({
      needsBackup: Boolean(options.newSeries),
    }),
    classifyManhuaScriptImportTransition: () =>
      options.newSeries ? "new_series" : "same_series",
    evaluateWriterPackAssetAndDensity: () => ({ canon: {} }),
    markManhuaCustomAssetRefsForCanonChanges: () => ({
      refs,
      changedAnchorIds: [],
      markedRefCount: 0,
    }),
    confirmManhuaSeriesSwitchWithBackup: vi.fn(
      async () => options.allowBackup !== false
    ),
    downloadManhuaSeriesSwitchBackup: vi.fn(),
    stripManhuaFactoryCanvasArtifacts: () => ({
      blocks: [],
      edges: [],
      removedCount: 0,
      archivedCount: 0,
    }),
    stripManhuaSeriesAssetsForNewProject: () => ({
      blocks: [],
      edges: [],
      removedCount: 0,
    }),
    resolveManhuaDirectorStrategyContract: () => null,
    markManhuaDirectorBoardOverlaysForReview: (value: unknown) => value,
    saveCanvasState: vi.fn(),
    saveManhuaDirectorBoardMainByEpisode: vi.fn(),
    saveManhuaDirectorBoardBySegment: vi.fn(),
    saveManhuaDirectorBoardOverlayBySegment: vi.fn(),
  };
  return {
    state,
    refs,
    setters,
    context,
    run: runInNewContext(executable, context) as (
      raw: string
    ) => Promise<boolean>,
  };
}

describe("真实剧本导入回调的确认状态", () => {
  it("没有旧工厂节点时，同剧改稿也撤销旧解锁和跳过状态，保留已选图片", async () => {
    const h = harness();
    expect(await h.run("新正文")).toBe(true);
    expect(h.state).toMatchObject({
      writerConfirmed: false,
      directorUnlocked: false,
      assetsSkipped: false,
      workflowPhase: "outline",
      projectBible: null,
    });
    expect(h.state.customAssetRefs).toBe(h.refs);
    const restored = parseManhuaWriterSession(
      serializeManhuaWriterSession(buildManhuaWriterSession(h.state))
    );
    expect(restored).toMatchObject({
      writerConfirmed: false,
      directorUnlocked: false,
      assetsSkipped: false,
      workflowPhase: "outline",
    });
    expect(restored?.writerPack?.episodes[0]?.body).toBe("黑奇金鳞自蹄踝显现");
    expect(restored?.customAssetRefs[0]?.id).toBe("heiqi-before");
    const cloud = parseManhuaCloudDraftPayload(
      JSON.stringify(
        buildManhuaCloudDraftPayload({
          writerSession: h.state,
          blocks: [],
          edges: [],
        })
      )
    );
    expect(cloud?.writerSession).toMatchObject({
      writerConfirmed: false,
      directorUnlocked: false,
      assetsSkipped: false,
      workflowPhase: "outline",
    });
    expect(cloud?.writerSession.customAssetRefs[0]?.id).toBe("heiqi-before");
  });

  it("换剧在备份允许后才复位，不继承旧剧跳过状态", async () => {
    const h = harness({ newSeries: true, allowBackup: true });
    expect(await h.run("新剧正文")).toBe(true);
    expect(
      h.context.confirmManhuaSeriesSwitchWithBackup
    ).toHaveBeenCalledOnce();
    expect(h.state).toMatchObject({
      writerConfirmed: false,
      directorUnlocked: false,
      assetsSkipped: false,
      workflowPhase: "outline",
      customAssetRefs: [],
    });
  });

  it("相邻扩写成功路径同步撤销资产跳过和旧阶段", () => {
    const success = source
      .split(
        "// 只有新稿真实返回后才切换状态；失败路径必须继续保留旧剧本、资产与导演板。"
      )[1]
      ?.split("setCustomAssetRefs")[0];
    expect(success).toContain("setAssetsSkipped(false)");
    expect(success).toContain('setWorkflowPhase("outline")');
  });

  it.each(["empty", "invalid", "cancel"])(
    "%s 不改变旧确认、进度、图片或正文",
    async mode => {
      const h = harness({
        invalid: mode === "invalid",
        newSeries: mode === "cancel",
        allowBackup: false,
      });
      const before = { ...h.state };
      expect(await h.run(mode === "empty" ? "" : "新正文")).toBe(false);
      expect(h.state).toEqual(before);
      for (const setter of Object.values(h.setters))
        expect(setter).not.toHaveBeenCalled();
    }
  );

  it("导入后仍需用户重新确认，不主动调用确认或付费扩写", () => {
    expect(callback).not.toMatch(
      /confirmWriterToDirector\(|confirmWriterSeriesSpawn\(|expandWriterRoom\(|\.mutate(?:Async)?\(/
    );
    expect(source).toContain(
      "importWriterFromTextRef.current = importWriterRoomFromText"
    );
    expect(source).toContain("await importWriterRoomFromText(text)");
  });
});

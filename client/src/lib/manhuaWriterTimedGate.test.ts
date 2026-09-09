import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as studio from "./canvasDramaStudio";
import * as writer from "@shared/manhuaWriterRoom";
import * as assetCanon from "@shared/manhuaWriterAssetCanon";
import * as bible from "@shared/manhuaProjectBible";
import * as layout from "@shared/manhuaSeedanceLayout";
import { shouldAttachManhuaPreviouslyOn } from "@shared/manhuaEpisodeRecap";
import { consumableManhuaCustomAssetRefsForCanon } from "@shared/manhuaAssetScriptSync";
import {
  buildLocalCloudDraftSnapshot,
  cloudDraftBlocksToCanvas,
  serializeCloudDraftForUpload,
} from "./manhuaCloudDraftSync";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";
import { readManhuaTimedStoryboard } from "@shared/manhuaTimedStoryboard";
import { evaluateWriterPackAssetAndDensity } from "@shared/manhuaWriterAssetCanon";
import {
  composeWriterPackFactoryContext,
  importManhuaWriterPackFromText,
  writerPackLooksReady,
} from "@shared/manhuaWriterRoom";
import {
  groupShotsIntoSegments,
  parseWorkbenchShotsFromText,
} from "@shared/manhuaScriptWorkbench";
import {
  buildManhuaWriterSession,
  parseManhuaWriterSession,
  serializeManhuaWriterSession,
} from "@shared/manhuaWriterSession";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "@shared/manhuaCloudDraft";
import {
  resolveShotsForEpisodeKeyarts,
  spawnManhuaDramaStudio,
  expandManhuaShotKeyartsAfterReverse,
  ensureManhuaFragmentClips,
  queuedManhuaClipBlocks,
} from "./canvasDramaStudio";

const header =
  "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |\n|---|---|---|---|---|---|";
const body = [
  header,
  ...Array.from(
    { length: 29 },
    (_, i) =>
      `| ${i + 1} | ${i * 5}-${(i + 1) * 5} | 近景·跟拍 | ${i % 2 ? "坊市" : "药摊"}前，阿菁第${i + 1}次握紧竹筐，黑奇缓缓向右走去，抬眼看向摊主。 | 阿菁：「第${i + 1}株药草不能卖，这是救我娘的药。」 | 脚步声 |`
  ),
].join("\n");
const assets =
  "## 人物表\n- 阿菁｜灰衣少女｜救母\n- 黑奇｜灰皮瘸腿驮兽｜守护阿菁\n## 道具表\n- 竹筐｜装草药｜破旧竹编\n## 场景表\n- 坊市｜晨雾｜幌子街道\n- 药摊｜熙攘｜草药与竹筐";
function pack(withAssets = true) {
  const result = importManhuaWriterPackFromText(
    `# 墨菁传\n${withAssets ? assets : ""}\n## 第1集：驮兽开口\n${body}\n## 第2集：府宴风波\n${body}`
  );
  if (!result.ok) throw new Error(result.error);
  return result.pack;
}

function readConfirmCallback(name: string) {
  const source = readFileSync(
    new URL("../pages/OmniCanvas.tsx", import.meta.url),
    "utf8"
  );
  const tree = ts.createSourceFile(
    "view.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callback = node.initializer.arguments[0]!.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!callback) throw new Error(`未找到真实确认回调：${name}`);
  return callback;
}

function confirmHarness(name: string, allowBatch = true) {
  const callback = readConfirmCallback(name);
  const original = pack();
  const old = spawnManhuaDramaStudio({
    topic: "旧稿",
    episodeIndex: 1,
    videoModel: "seedance-2.0-mini",
  });
  const previous = old.blocks.find(b => b.id.startsWith("clip-"))!;
  const blocks = old.blocks.map(b =>
    b.id === previous.id
      ? {
          ...b,
          outputUrl: "https://test.example/paid-before.mp4",
          outputUrls: ["https://test.example/paid-before.mp4"],
          status: "done" as const,
        }
      : b
  );
  const state: Record<string, unknown> = {
    blocks,
    edges: old.edges,
    writerPack: original,
  };
  const setters = Object.fromEntries(
    Array.from(callback.matchAll(/\b(set[A-Z]\w*)\(/g)).map(m => [
      m[1],
      vi.fn((value: unknown) => {
        const key = m[1].slice(3);
        state[key[0].toLowerCase() + key.slice(1)] = value;
      }),
    ])
  );
  const saved = vi.fn();
  const context = {
    ...studio,
    ...writer,
    ...assetCanon,
    ...bible,
    ...layout,
    ...setters,
    shouldAttachManhuaPreviouslyOn,
    consumableManhuaCustomAssetRefsForCanon,
    writerPack: original,
    writerFocusEpisode: 1,
    writerVideoModel: "seedance-2.0-mini",
    writerLayoutProfile: layout.resolveManhuaSeedanceLayoutProfile(
      "seedance-2.0-mini",
      "short"
    ),
    factoryTopic: "墨菁传",
    factoryArtStyleId: "",
    factoryGenreId: "",
    factorySceneId: "",
    factoryReverseMode: "shots",
    factoryCineVocabLocale: "zh",
    recommendedScene: undefined,
    blocks,
    edges: old.edges,
    customAssetRefs: [],
    directorStrategyContract: null,
    femaleLeadManual: false,
    maleLeadManual: false,
    ancientManual: false,
    artStyleManual: false,
    sceneManual: false,
    propManual: false,
    wardrobeManual: false,
    selectedCraftShotIds: [],
    selectedPathRecipeIds: [],
    selectedNarrativeLightingIds: [],
    selectedMaleHairstyleIds: [],
    selectedMaleMicroIds: [],
    selectedPromoLayoutIds: [],
    selectedActionRecipeIds: [],
    selectedCineVocabIds: [],
    // 测试不选公共角色库，真实资产仍由上面的编剧表解析器产生。
    resolveHardCastForSpawn: () => ({
      lane: "ancient",
      characterIds: [],
      ancientArchetypeIds: [],
      propIds: [],
      wardrobePropContinuityIds: [],
    }),
    saveCanvasState: saved,
    remapDockSelectionAfterSpawn: vi.fn(),
    pushDebug: vi.fn(),
    window: { confirm: vi.fn(() => allowBatch), setTimeout: vi.fn() },
    toast: { error: vi.fn(), success: vi.fn() },
  };
  const run = runInNewContext(
    ts.transpileModule(`(${callback})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context
  );
  return { run, state, saved, original, previousId: previous.id, context };
}

describe("原稿导入至确认门禁", () => {
  it.each(["confirmWriterToDirector", "confirmWriterSeriesSpawn"])(
    "真实%s成功确认使用当前资产与完整原稿，保留旧付费片并经云恢复",
    name => {
      const h = confirmHarness(name);
      h.run();
      expect(h.context.toast.error).not.toHaveBeenCalled();
      expect(h.state.writerConfirmed).toBe(true);
      expect(h.state.directorUnlocked).toBe(true);
      const project = h.state.projectBible as bible.ManhuaProjectBible;
      expect(project.assetCanon?.characters.map(c => c.nameZh)).toEqual([
        "阿菁",
        "黑奇",
      ]);
      expect(h.saved).toHaveBeenCalledOnce();
      const next = h.state.blocks as CanvasBlock[];
      expect(next.find(b => b.id === h.previousId)).toMatchObject({
        outputUrl: "https://test.example/paid-before.mp4",
        archivedFromPreviousScript: true,
      });
      const session = buildManhuaWriterSession({
        writerPack: h.original,
        writerConfirmed: true,
        projectBible: project,
      });
      const snapshot = buildLocalCloudDraftSnapshot({
        writerSession: session,
        blocks: next,
        edges: h.state.edges as CanvasEdge[],
      });
      const parsed = parseManhuaCloudDraftPayload(
        serializeCloudDraftForUpload(snapshot)!
      )!;
      const restored = cloudDraftBlocksToCanvas(parsed.canvas.blocks);
      const count = name === "confirmWriterSeriesSpawn" ? 2 : 1;
      for (let ep = 1; ep <= count; ep++) {
        const shots = resolveShotsForEpisodeKeyarts(restored, ep);
        expect(shots).toHaveLength(29);
        expect(shots.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(
          145
        );
        expect(shots.at(-1)?.dialogueZh).toContain("第29株药草不能卖");
      }
      expect(parsed.writerSession?.writerPack).toEqual(h.original);
      expect(restored.find(b => b.id === h.previousId)?.outputUrl).toBe(
        "https://test.example/paid-before.mp4"
      );
      expect(
        next
          .filter(b => !b.archivedFromPreviousScript)
          .every(b => !b.outputUrl && !b.videoTaskId)
      ).toBe(true);
    }
  );

  it("批量确认取消后不铺板、不保存、不解锁", () => {
    const h = confirmHarness("confirmWriterSeriesSpawn", false);
    h.run();
    expect(h.context.window.confirm).toHaveBeenCalledOnce();
    expect(h.saved).not.toHaveBeenCalled();
    expect(h.state.writerConfirmed).toBeUndefined();
    expect(h.state.directorUnlocked).toBeUndefined();
  });
  it("确认不能读取分镜区块外的秒位表而让工作台使用另一份旧表", () => {
    const original = pack();
    original.episodes[0].body = `## 分镜表\n| 1 | 近景 | 旧动作甲 |\n| 2 | 全景 | 旧动作乙 |\n## 附录\n${body}`;
    const gate = evaluateWriterPackAssetAndDensity(original);
    expect(gate.ok).toBe(false);
    expect(gate.errors.join("\n")).toContain("分镜区块之外");
  });

  it("分镜区块外续写的第30镜不能通过门禁后在工作台丢失", () => {
    const original = pack();
    original.episodes[0].body = `## 分镜表\n${body}\n## 附录\n${header}\n| 30 | 145-150 | 远景 | 黑奇在巷口回头 | 无 | 风声 |`;
    const gate = evaluateWriterPackAssetAndDensity(original);
    expect(gate.ok).toBe(false);
    expect(gate.errors.join("\n")).toContain("分镜区块之外");
  });

  it("长动作末尾进入实际静帧与成片编译，尾部修改能改变源修订", () => {
    const original = pack();
    const prefix = "阿菁扶住娘的手，黑奇守在药摊前，坊市人群绕开轮椅。".repeat(
      14
    );
    const tail = "黑奇用独角托起铜闸，阿菁将最后一盏灯递给娘。";
    const compile = (ending: string) => {
      const input = {
        ...original,
        episodes: original.episodes.map(ep => ({
          ...ep,
          body: ep.body.replace(
            /(\| 1 \|[^\n]*?跟拍 \|)[^|]+/,
            `$1 ${prefix}${ending} `
          ),
        })),
      };
      const gate = evaluateWriterPackAssetAndDensity(input);
      expect(gate.errors).toEqual([]);
      const spawned = spawnManhuaDramaStudio({
        topic: "墨菁传",
        episodeIndex: 1,
        writerContext: composeWriterPackFactoryContext(input, 1),
        assetCanon: gate.canon,
        videoModel: "seedance-2.0-mini",
      });
      const shots = resolveShotsForEpisodeKeyarts(spawned.blocks, 1);
      expect(shots[0].actionZh).toBe(prefix + ending);
      const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
      const expanded = expandManhuaShotKeyartsAfterReverse(
        spawned.blocks,
        spawned.edges,
        reverse.id,
        { videoModel: "seedance-2.0-mini" }
      );
      const compiled = ensureManhuaFragmentClips(
        expanded.blocks,
        expanded.edges,
        1,
        { videoModel: "seedance-2.0-mini" }
      );
      const clips = queuedManhuaClipBlocks(
        compiled.blocks,
        1,
        "seedance-2.0-mini"
      );
      expect(clips[0].prompt).toContain(ending.replace(/。$/, ""));
      const keyart = compiled.blocks.find(b => b.id === clips[0].parentId)!;
      expect(keyart.prompt).toContain(ending);
      return clips[0].manhuaAutoSegment;
    };
    expect(compile(tail)).not.toEqual(
      compile("黑奇收起独角，阿菁把灯交给老妇人。")
    );
  });

  it("转义竖线仍属于原单元格，不把后列当成对白", () => {
    const raw = `${header}\n| 1 | 0-5 | 近景 | 门牌写着甲\\|乙，阿菁停步 | 阿菁：「走左\\|右？」 | 脚步 |\n| 2 | 5-10 | 全景 | 黑奇转身 | 无 | 风声 |`;
    const parsed = readManhuaTimedStoryboard(raw);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      actionZh: "门牌写着甲|乙，阿菁停步",
      dialogueZh: "阿菁：「走左|右？」",
    });
    expect(parseWorkbenchShotsFromText(raw)[0].dialogueZh).toContain("走左|右");
  });

  it.each([
    ["漏写行首竖线", body.replace("| 29 |", "29 |"), "行首"],
    ["多出单元格", body.replace("第29次握紧竹筐", "第29次|握紧竹筐"), "列数"],
  ])("%s 不能丢末镜或错列后通过", (_label, raw, expected) => {
    const original = pack();
    original.episodes[0].body = raw;
    expect(
      evaluateWriterPackAssetAndDensity(original).errors.join("\n")
    ).toContain(expected);
  });

  it("秒位表混有另一份段表时不放行，避免下游优先选错真源", () => {
    const original = pack();
    original.episodes[0].body += "\n#### 段01\n- 场景：旧场景\n";
    expect(
      evaluateWriterPackAssetAndDensity(original).errors.join("\n")
    ).toContain("同时含秒位分镜表与段表");
  });
  it("两集原表经导入、确认、本机及云恢复进入实际工厂解析，不改成段表", () => {
    const original = pack();
    const gate = evaluateWriterPackAssetAndDensity(original);
    expect(gate.errors).toEqual([]);
    const session = buildManhuaWriterSession({
      writerPack: original,
      writerConfirmed: false,
    });
    const restored = parseManhuaWriterSession(
      serializeManhuaWriterSession(session)
    )!;
    const cloud = parseManhuaCloudDraftPayload(
      buildManhuaCloudDraftPayload({
        writerSession: restored,
        blocks: [],
        edges: [],
      })
    )!;
    expect(cloud.writerSession?.writerPack).toEqual(original);
    for (const episode of original.episodes) {
      const context = composeWriterPackFactoryContext(original, episode.index);
      const spawned = spawnManhuaDramaStudio({
        topic: "墨菁传",
        episodeIndex: episode.index,
        writerContext: context,
        assetCanon: gate.canon,
        videoModel: "seedance-2.0-mini",
      });
      const shots = resolveShotsForEpisodeKeyarts(
        spawned.blocks,
        episode.index
      );
      expect(shots).toHaveLength(29);
      expect(shots.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(145);
      expect(shots.at(-1)?.dialogueZh).toContain("第29株药草不能卖");
      const segments = groupShotsIntoSegments(shots, {
        videoModel: "seedance-2.0-mini",
      });
      expect(segments).toHaveLength(10);
      expect(
        segments.flatMap(segment => segment.shots).map(shot => shot.index)
      ).toEqual(shots.map(shot => shot.index));
      expect(
        spawned.blocks.every(block => !block.outputUrl && !block.videoTaskId)
      ).toBe(true);
    }
  });

  it.each([
    ["倒退秒位", body.replace("140-145", "145-140"), "秒位无效"],
    ["重叠秒位", body.replace("140-145", "139-145"), "重叠"],
    ["重复镜号", body.replace("| 29 |", "| 28 |"), "镜号"],
    ["坏镜号", body.replace("| 29 |", "| 错误 |"), "镜号"],
    [
      "末镜缺动作",
      body.replace(/(\| 29 \|[^\n]*?跟拍 \|)[^|]+/, "$1 "),
      "缺画面动作",
    ],
    ["缺表头", body.replace("景别·运镜", "未知列"), "缺镜号"],
  ])("%s 不能被前28镜或旧布局放行", (_label, raw, expected) => {
    const original = pack();
    original.episodes[1].body = raw;
    const gate = evaluateWriterPackAssetAndDensity(original);
    expect(gate.ok).toBe(false);
    expect(gate.errors.join("\n")).toContain(expected);
    expect(gate.errors.join("\n")).toContain("第2集");
  });

  it("空表、单行与无表正文不能当完整原稿；无对白和字幕不会冒充口播", () => {
    expect(readManhuaTimedStoryboard(header).errors).toContain(
      "秒位分镜表至少需要两行真实镜头"
    );
    expect(
      readManhuaTimedStoryboard(
        `${header}\n| 1 | 0-5 | 全景 | 晨雾 | 无 | 风声 |`
      ).errors
    ).toHaveLength(1);
    const silent = `${header}\n| 1 | 0-5 | 全景 | 晨雾 | 字幕：坊市 | 风声 |\n| 2 | 5-10 | 近景 | 黑奇走过 | —— | 脚步 |`;
    expect(readManhuaTimedStoryboard(silent).errors).toEqual([]);
    expect(
      parseWorkbenchShotsFromText(silent).every(shot => !shot.dialogueZh)
    ).toBe(true);
    expect(
      evaluateWriterPackAssetAndDensity({
        ...pack(),
        episodes: [{ index: 1, body: "只有一段故事", endHook: "门外脚步" }],
      }).ok
    ).toBe(false);
    expect(
      evaluateWriterPackAssetAndDensity({
        ...pack(),
        segmentCountMode: "layout",
      }).errors.join("\n")
    ).toContain("可拍表未过关");
  });

  it.each(["confirmWriterToDirector", "confirmWriterSeriesSpawn"])(
    "真实%s回调不再误报缺段，但缺资产仍拒绝且不写状态",
    name => {
      const source = readFileSync(
        new URL("../pages/OmniCanvas.tsx", import.meta.url),
        "utf8"
      );
      const tree = ts.createSourceFile(
        "view.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      let callback = "";
      const visit = (node: ts.Node) => {
        if (
          ts.isVariableDeclaration(node) &&
          node.name.getText(tree) === name &&
          node.initializer &&
          ts.isCallExpression(node.initializer)
        )
          callback = node.initializer.arguments[0]!.getText(tree);
        ts.forEachChild(node, visit);
      };
      visit(tree);
      expect(callback).not.toBe("");
      const blockers = vi.fn();
      const tablesEmpty = vi.fn();
      const confirmed = vi.fn();
      const action = runInNewContext(
        ts.transpileModule(`(${callback})`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
          writerPack: pack(false),
          writerPackLooksReady,
          writerVideoModel: "seedance-2.0-mini",
          hasManhuaSeedanceLayoutChoice: () => true,
          writerLayoutProfile: {},
          evaluateWriterPackAssetAndDensity,
          setWriterConfirmBlockers: blockers,
          setWriterConfirmAssetTablesEmpty: tablesEmpty,
          setWriterConfirmed: confirmed,
          setImmersiveWorkspaceView: vi.fn(),
          toast: { error: vi.fn() },
          pushDebug: vi.fn(),
          window: { setTimeout: vi.fn() },
        }
      );
      action();
      // 0909：门槛按剧本实际实体计——空表只报「人物表为空」并给提取出路；场景/道具没列就不要求
      expect(blockers.mock.calls[0][0]).toEqual([
        "人物表为空：至少需要 1 名在本集出场的角色。点「从剧本提取资产表」可按对白说话人／场景行自动补表，再确认",
      ]);
      expect(tablesEmpty).toHaveBeenCalledWith(true);
      expect(confirmed).not.toHaveBeenCalled();
    }
  );
});

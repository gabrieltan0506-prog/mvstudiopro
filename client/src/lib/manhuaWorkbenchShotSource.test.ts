import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as studio from "./canvasDramaStudio";
import * as workbench from "@shared/manhuaScriptWorkbench";
import * as plan from "@shared/manhuaEpisodeSegmentPlan";
import * as layout from "@shared/manhuaSeedanceLayout";
import * as dialogues from "@shared/manhuaShotDialoguePersist";
import { buildWorkbenchShotsFromSegmentPlan } from "@shared/manhuaStoryDistill";
import { isManhuaKeyartPixelLocked } from "@shared/manhuaAssetLockRegistry";
import { isManhuaKeyartLookCurrent } from "@shared/manhuaKeyartLookState";
import { manhuaShotKeyartState } from "./manhuaShotKeyartState";

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
function memo(name: string) {
  let callback = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(tree) === "useMemo"
    )
      callback = node.initializer.arguments[0]?.getText(tree) || "";
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback) throw new Error(`未找到生产派生状态：${name}`);
  return ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function initializer(name: string) {
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer)
      expression = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!expression) throw new Error(`未找到生产状态：${name}`);
  return ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function currentShotKeyartGate() {
  const names = new Set([
    "keyartOutputUrl",
    "isManhuaWorkbenchKeyartCurrent",
    "manhuaShotKeyartInputOf",
    "summarizeManhuaCurrentShotKeyarts",
  ]);
  const declarations: string[] = [];
  for (const node of tree.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) {
      declarations.push(node.getText(tree).replace(/^export\s+/, ""));
    }
  }
  expect(declarations).toHaveLength(names.size);
  const js = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(`${js}\nsummarizeManhuaCurrentShotKeyarts`, {
    resolveKeyartShotIndex: workbench.resolveKeyartShotIndex,
    isManhuaKeyartPixelLocked,
    isManhuaKeyartLookCurrent,
    manhuaShotKeyartState,
  }) as (shots: Array<{ index: number }>, keyarts: Array<Record<string, unknown>>) => {
    target: number;
    present: number;
    ready: number;
    countReady: boolean;
    pixelLocked: boolean;
  };
}

const shotRows = (count: number) => Array.from({ length: count }, (_, i) => ({ index: i + 1 }));
const lockedFrame = (index: number) => ({
  id: `keyart-e01-s${String(index).padStart(2, "0")}-fixture`,
  prompt: `镜${index}`,
  outputUrl: `https://example.invalid/frame-${index}.png`,
  imageMode: "edit",
  refImageUrl: "https://example.invalid/scene.png",
});

function episode(
  count: number,
  videoModel: NonNullable<
    Parameters<typeof studio.spawnManhuaDramaStudio>[0]
  >["videoModel"] = "seedance-2.0-mini"
) {
  const table = [
    "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
    "|---|---|---|---|---|---|",
    ...Array.from(
      { length: count },
      (_, i) =>
        `| ${i + 1} | ${i * 5}-${(i + 1) * 5} | 缓推${i + 1} | 原稿动作${i + 1} | 黑奇：「原稿对白${i + 1}」 | 风声 |`
    ),
  ].join("\n");
  const spawned = studio.spawnManhuaDramaStudio({
    topic: "墨菁传",
    episodeIndex: 1,
    videoModel,
  });
  const blocks = spawned.blocks.map(block =>
    block.id.startsWith("reverse-")
      ? { ...block, outputText: table, status: "done" as const }
      : block
  );
  const reverse = blocks.find(b => b.id.startsWith("reverse-"));
  const beats = blocks.find(b => b.id.startsWith("beats-"));
  const story = blocks.find(b => b.id.startsWith("story-"));
  const scope = {
    ...studio,
    ...workbench,
    ...plan,
    ...layout,
    ...dialogues,
    buildWorkbenchShotsFromSegmentPlan,
    blocks,
    focusEpisode: 1,
    beats,
    reverse,
    story,
    videoModel,
    episodeVideoModel: videoModel,
    episodeClips: [],
    legacyClip: undefined,
  };
  const shots = runInNewContext(
    memo("shots"),
    scope
  )() as workbench.ManhuaWorkbenchShot[];
  return { blocks, table, shots, scope };
}

describe("工作台展示与真实编排使用同源分镜", () => {
  it("墨菁传已确认首集18镜保留有声镜对白和无声镜", () => {
    const confirmed = readFileSync(
      new URL("./fixtures/mojing-episode1-confirmed-shot-table.md", import.meta.url),
      "utf8",
    );
    const shots = workbench.parseWorkbenchShotsFromText(confirmed);
    expect(shots).toHaveLength(18);
    expect(shots[0].dialogueZh).toContain("娘：「阿菁……慢点，我喘不上来。」");
    expect(shots[1].dialogueZh || "").toBe("");
    expect(shots[7].dialogueZh).toContain("墨屠：「打她之前，问过我吗？」");
    expect(shots[14].dialogueZh).toContain("娘：「阿菁，那馬是怎麼回事呀？」");
    expect(shots[16].dialogueZh).toContain("墨屠：「三天太短。取吧。」");
  });

  it("只有story原稿时保留真实逐镜，不让其他阶段模板覆盖", () => {
    const h = episode(18);
    const blocks = h.blocks.map(block => ({
      ...block,
      outputText: block.id.startsWith("story-") ? h.table : undefined,
    }));
    const expected = workbench.parseWorkbenchShotsFromText(h.table);
    expect(studio.resolveShotsForEpisodeKeyarts(blocks, 1)).toEqual(expected);
    expect(runInNewContext(memo("shots"), { ...h.scope, blocks })()).toEqual(
      expected
    );
  });

  it.each([
    ["story", 5],
    ["beats", 5],
    ["reverse", 5],
    ["story", 6],
    ["beats", 6],
    ["reverse", 6],
  ] as const)(
    "%s中的旧%s段计划按真实段表编译，保留三静帧角色与台词",
    (stage, count) => {
      const h = episode(18);
      const fixture = plan.buildManhuaEpisodeSegmentPlanFixtureMarkdown();
      const text = count === 5 ? fixture.split("#### 段06")[0] : fixture;
      const expected = buildWorkbenchShotsFromSegmentPlan(
        plan.parseManhuaEpisodeSegmentPlanFromMarkdown(text)
      );
      const blocks = h.blocks.map(block => ({
        ...block,
        outputText: block.id.startsWith(`${stage}-`) ? text : undefined,
      }));
      const actual = studio.resolveShotsForEpisodeKeyarts(blocks, 1);
      expect(actual).toHaveLength(count * 3);
      expect(actual).toEqual(expected);
      expect(runInNewContext(memo("shots"), { ...h.scope, blocks })()).toEqual(
        expected
      );
      // 首镜可以是无对白建立镜；完整台词以段表为准，静帧只带本镜发话。
      expect(plan.extractManhuaSegmentDialogueQuotes(
        plan.parseManhuaEpisodeSegmentPlanFromMarkdown(text).segments[0].dialogueZh,
      )).toContain("苏照雪：「把玉珏交出来——第1次。」");
      expect(actual.some((shot) => Boolean(shot.dialogueZh))).toBe(true);
    }
  );
  it("beats只有待运行模板时，实际工作台派生值使用reverse成稿而非默认骨架", () => {
    const h = episode(18);
    expect(h.shots).toEqual(workbench.parseWorkbenchShotsFromText(h.table));
    const reverse = h.blocks.find(b => b.id.startsWith("reverse-"))!;
    const expanded = studio.expandManhuaShotKeyartsAfterReverse(
      h.blocks,
      [],
      reverse.id,
      { videoModel: "seedance-2.0-mini" }
    );
    const compiled = studio.ensureManhuaFragmentClips(
      expanded.blocks,
      expanded.edges,
      1,
      { videoModel: "seedance-2.0-mini" }
    );
    expect(
      studio.queuedManhuaClipBlocks(compiled.blocks, 1, "seedance-2.0-mini")
    ).toHaveLength(6);
    const prompts = studio
      .queuedManhuaClipBlocks(compiled.blocks, 1, "seedance-2.0-mini")
      .map(b => b.prompt)
      .join("\n");
    for (const shot of h.shots) expect(prompts).toContain(shot.actionZh);
    expect(JSON.stringify(h.shots)).not.toContain("落实本镜人物站位与动作");
  });

  it("非钉段长稿的UI不再独自强制默认六段，与生产分组保持同值", () => {
    const h = episode(30, "seedance-2.0");
    const uiSegments = runInNewContext(memo("segments"), {
      ...h.scope,
      shots: h.shots,
    })();
    const actual = workbench.groupShotsIntoSegments(h.shots, {
      videoModel: "seedance-2.0",
      segmentCount: workbench.pinnedManhuaSegmentCount("seedance-2.0"),
    });
    expect(uiSegments).toEqual(actual);
    expect(uiSegments).toHaveLength(10);
  });
});

describe("工作台逐镜静帧出片门禁", () => {
  const gate = currentShotKeyartGate();

  it("18镜只铺两张锁图仍显示2/18，出片门与阶段条都不放行", () => {
    const result = gate(shotRows(18), [lockedFrame(1), lockedFrame(2)]);
    expect(result).toMatchObject({ target: 18, present: 2, ready: 2, countReady: false, pixelLocked: true });
    const stages = runInNewContext(memo("stageStrip"), {
      blocks: [], focusEpisode: 1, episodeKeyarts: [lockedFrame(1), lockedFrame(2)],
      episodeClips: [], activeKeyart: undefined, activeClip: undefined, legacyClip: undefined,
      currentStillTarget: result.target, currentStillPresent: result.present,
      stillsReadyEnough: result.countReady && result.pixelLocked,
      MANHUA_FACTORY_STAGE_LABEL_ZH: studio.MANHUA_FACTORY_STAGE_LABEL_ZH,
      blockByStage: () => undefined, manhuaClipQualityAllowsAssemble: () => false,
      clipOutputUrl: () => undefined,
    })() as Array<{ stage: string; has: boolean; label: string }>;
    expect(stages.find((stage) => stage.stage === "keyart")).toMatchObject({ has: false });
    expect(stages.find((stage) => stage.stage === "keyart")?.label).toContain("2/18");
  });

  it("旧稿真实13镜配13张现行锁图可通过，不按段数补虚数", () => {
    expect(gate(shotRows(13), shotRows(13).map((shot) => lockedFrame(shot.index))))
      .toMatchObject({ target: 13, present: 13, ready: 13, countReady: true, pixelLocked: true });
  });

  it("缺一镜不能拿同镜重复图或旧稿孤儿图凑数", () => {
    const frames = shotRows(17).map((shot) => lockedFrame(shot.index));
    frames.push({ ...lockedFrame(17), id: "keyart-e01-s17-extra" });
    frames.push(lockedFrame(19));
    expect(gate(shotRows(18), frames)).toMatchObject({ target: 18, present: 17, ready: 17, countReady: false });
  });

  it("有图但没垫图锁或来源过期不能算当前镜就绪", () => {
    const stale = { ...lockedFrame(2), manhuaKeyartSourceState: { required: "new", generatedFor: "old", generatedUrl: lockedFrame(2).outputUrl } };
    const result = gate(shotRows(3), [lockedFrame(1), stale, { ...lockedFrame(3), imageMode: "generate" }]);
    expect(result).toMatchObject({ target: 3, present: 3, ready: 1, countReady: true, pixelLocked: false });
  });

  it("没有当前原稿镜头时不因遗留图放行", () => {
    expect(gate([], [lockedFrame(1)])).toMatchObject({ target: 0, present: 0, ready: 0, countReady: false });
  });

  it("占位分镜即使配齐旧锁图也不得视为可出片", () => {
    const result = gate(shotRows(3), shotRows(3).map((shot) => lockedFrame(shot.index)));
    expect(result).toMatchObject({ countReady: true, pixelLocked: true });
    const readyExpression = initializer("stillsReadyEnough");
    const ready = (shotSourceIsFallback: boolean) => runInNewContext(readyExpression, {
      shotSourceIsFallback,
      stillsCountReady: result.countReady,
      keyartsPixelLocked: result.pixelLocked,
      staleLookStillCount: 0,
    });
    expect(ready(true)).toBe(false);
    expect(ready(false)).toBe(true);
  });
});

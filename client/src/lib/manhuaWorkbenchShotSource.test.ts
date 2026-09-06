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
      expect(actual[0].dialogueZh).toBe("把玉珏交出来——第1次。");
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

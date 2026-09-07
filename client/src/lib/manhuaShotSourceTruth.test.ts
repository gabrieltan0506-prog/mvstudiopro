import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as studio from "./canvasDramaStudio";
import {
  defaultWorkbenchShots,
  parseWorkbenchShotsFromText,
} from "@shared/manhuaScriptWorkbench";
import {
  buildManhuaEpisodeSegmentPlanFixtureMarkdown,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "@shared/manhuaEpisodeSegmentPlan";
import { buildWorkbenchShotsFromSegmentPlan } from "@shared/manhuaStoryDistill";
import { upsertShotAngleSection } from "@shared/manhuaShotAnglePersist";
import { MANHUA_CAMERA_ANGLE_BANK } from "@shared/manhuaCameraAngleBank";
import {
  MANHUA_DIALOGUE_SILENCE_TOKEN,
  upsertShotDialogueSection,
} from "@shared/manhuaShotDialoguePersist";

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

// 执行生产中的派生回调和真实 JSX，避免重写一份来源判断后自证。
function productionMemo(
  name: string,
  blocks: Parameters<typeof studio.resolveShotsForEpisodeKeyarts>[0],
  focusEpisode: number
) {
  let callback = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(tree) === "useMemo"
    ) {
      callback = node.initializer.arguments[0]?.getText(tree) || "";
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback) throw new Error(`缺少真实派生状态：${name}`);
  const code = ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(code, { ...studio, blocks, focusEpisode })();
}

function sourceLabel(isFallback: boolean) {
  const declaration = tree.statements.find(
    node =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "ManhuaShotSourceLabel"
  );
  if (!declaration) throw new Error("缺少真实来源标签组件");
  const code = ts.transpileModule(
    `(${declaration.getText(tree).replace(/^export\s+/, "")})`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
      },
    }
  ).outputText;
  const component = runInNewContext(code, { React }) as React.FC<{
    isFallback: boolean;
  }>;
  return renderToStaticMarkup(React.createElement(component, { isFallback }));
}

function table(label = "原稿", count = 3) {
  return [
    "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
    "|---|---|---|---|---|---|",
    ...Array.from(
      { length: count },
      (_, i) =>
        `| ${i + 1} | ${i * 5}-${(i + 1) * 5} | 缓推${i + 1} | ${label}动作${i + 1} | 黑奇：「${label}对白${i + 1}」 | 风声 |`
    ),
  ].join("\n");
}

function episode(
  stage: "beats" | "reverse" | "story",
  text: string,
  index = 1
) {
  return studio
    .spawnManhuaDramaStudio({
      topic: "来源测试",
      episodeIndex: index,
      videoModel: "seedance-2.0-mini",
    })
    .blocks.map(block => ({
      ...block,
      prompt: "",
      outputText: block.id.startsWith(`${stage}-`) ? text : undefined,
    }));
}

function assertSameSource(
  blocks: Parameters<typeof studio.resolveShotsForEpisodeKeyarts>[0],
  focusEpisode: number,
  isFallback: boolean
) {
  const before = structuredClone(blocks);
  const result = studio.resolveShotsForEpisodeKeyartsResult(
    blocks,
    focusEpisode
  );
  expect(result.isFallback).toBe(isFallback);
  expect(result.shots).toEqual(
    studio.resolveShotsForEpisodeKeyarts(blocks, focusEpisode)
  );
  expect(productionMemo("shots", blocks, focusEpisode)).toEqual(result.shots);
  expect(productionMemo("shotSourceIsFallback", blocks, focusEpisode)).toBe(
    isFallback
  );
  expect(blocks).toEqual(before);
  const html = sourceLabel(result.isFallback);
  expect(html).toContain(
    `data-manhua-shot-source="${isFallback ? "fallback" : "parsed"}"`
  );
  expect(html).toContain(isFallback ? "占位规划·未解析原稿" : "画布分镜规划");
  expect(html).not.toContain(
    isFallback ? "画布分镜规划" : "占位规划·未解析原稿"
  );
  return result.shots;
}

describe("来源事实从真实选源到工作台标签保持一致", () => {
  it("没有节点时保留十八镜占位，不冒充原稿", () => {
    expect(assertSameSource([], 1, true)).toEqual(defaultWorkbenchShots());
  });

  it.each(["", " \n ", "1. 阿菁牵住墨屠", "1. A\n2. B"])(
    "空稿、单行或伪两编号仍标占位：%s",
    raw => {
      const shots = assertSameSource(episode("reverse", raw), 1, true);
      expect(shots).toEqual(defaultWorkbenchShots(raw.trim().slice(0, 180)));
      expect(shots).toHaveLength(18);
    }
  );

  it.each(["beats", "reverse", "story"] as const)(
    "%s 正常逐镜保留原稿字段和真实秒位",
    stage => {
      const raw = table();
      const shots = assertSameSource(episode(stage, raw), 1, false);
      expect(shots).toEqual(parseWorkbenchShotsFromText(raw));
      expect(shots).toHaveLength(3);
      expect(shots[2]).toMatchObject({
        index: 3,
        durationSec: 5,
        actionZh: "原稿动作3",
        dialogueZh: "黑奇：「原稿对白3」",
      });
    }
  );

  it.each(["beats", "reverse", "story"] as const)(
    "%s 旧段表先编译，不误判十八镜占位",
    stage => {
      const raw = buildManhuaEpisodeSegmentPlanFixtureMarkdown();
      const shots = assertSameSource(episode(stage, raw), 1, false);
      expect(shots).toEqual(
        buildWorkbenchShotsFromSegmentPlan(
          parseManhuaEpisodeSegmentPlanFromMarkdown(raw)
        )
      );
      expect(shots).toHaveLength(18);
      expect(shots[0]?.dialogueZh).toBe("把玉珏交出来——第1次。");
    }
  );

  it("跨集只读当前集，缺失集不能借用别集成稿", () => {
    const blocks = [
      ...episode("reverse", table("第一集"), 1),
      ...episode("beats", "", 2),
    ];
    expect(assertSameSource(blocks, 1, false)[0]?.actionZh).toBe("第一集动作1");
    expect(assertSameSource(blocks, 2, true)).toEqual(defaultWorkbenchShots());
    expect(assertSameSource(blocks, 3, true)).toEqual(defaultWorkbenchShots());
  });

  it.each(["reverse", "story"] as const)(
    "beats 模板不能盖过 %s 已返回成稿",
    stage => {
      const blocks = episode(stage, table("真实")).map(block =>
        block.id.startsWith("beats-")
          ? { ...block, prompt: table("模板") }
          : block
      );
      const shots = assertSameSource(blocks, 1, false);
      expect(shots).toEqual(parseWorkbenchShotsFromText(table("真实")));
      expect(JSON.stringify(shots)).not.toContain("模板动作");
    }
  );

  it("多份成稿保持 beats、reverse、story 原有优先级，不依赖数组顺序", () => {
    const blocks = episode("beats", table("节拍"))
      .map(block =>
        block.id.startsWith("reverse-")
          ? { ...block, outputText: table("反推") }
          : block.id.startsWith("story-")
            ? { ...block, outputText: table("故事") }
            : block
      )
      .reverse();
    expect(assertSameSource(blocks, 1, false)).toEqual(
      parseWorkbenchShotsFromText(table("节拍"))
    );
    const withoutBeats = blocks.filter(block => !block.id.startsWith("beats-"));
    expect(assertSameSource(withoutBeats, 1, false)).toEqual(
      parseWorkbenchShotsFromText(table("反推"))
    );
  });

  it("机位、对白覆盖和明确静音元数据不因来源包装丢失", () => {
    const angle = MANHUA_CAMERA_ANGLE_BANK[0]!.id;
    const reverseText = upsertShotAngleSection(
      upsertShotDialogueSection(table(), { 1: "反推覆盖对白" }),
      { 1: angle }
    );
    const beatsText = upsertShotDialogueSection(table(), {
      1: "节拍最新对白",
      2: MANHUA_DIALOGUE_SILENCE_TOKEN,
    });
    const blocks = episode("reverse", reverseText).map(block =>
      block.id.startsWith("beats-")
        ? { ...block, outputText: beatsText }
        : block
    );
    const shots = assertSameSource(blocks, 1, false);
    expect(shots).toHaveLength(3);
    expect(shots[0]).toMatchObject({
      actionZh: "原稿动作1",
      cameraAngleId: angle,
      dialogueZh: "节拍最新对白",
      dialogueSuppressed: false,
    });
    expect(shots[1]).toMatchObject({
      actionZh: "原稿动作2",
      dialogueZh: undefined,
      dialogueSuppressed: true,
    });
    expect(shots[2]).toEqual(parseWorkbenchShotsFromText(table())[2]);
  });

  it("默认模板能解析到行时只称画布规划，不声称用户原稿已解析", () => {
    const blocks = studio.spawnManhuaDramaStudio({
      topic: "来源测试",
      episodeIndex: 1,
      videoModel: "seedance-2.0-mini",
    }).blocks;
    const shots = assertSameSource(blocks, 1, false);
    expect(shots).toHaveLength(6);
    expect(sourceLabel(false)).not.toContain("原稿");
  });

  it("仅对白覆盖表不抢占真实成稿，覆盖对白后仍保留原镜数与动作", () => {
    const beatsText = upsertShotDialogueSection("当前集编辑", {
      1: "节拍最新对白",
      2: MANHUA_DIALOGUE_SILENCE_TOKEN,
    });
    const blocks = episode("reverse", table()).map(block =>
      block.id.startsWith("beats-")
        ? { ...block, outputText: beatsText }
        : block
    );
    const shots = assertSameSource(blocks, 1, false);
    expect(shots).toHaveLength(3);
    expect(shots[0]).toMatchObject({
      dialogueZh: "节拍最新对白",
      dialogueSuppressed: false,
    });
    expect(shots[1]).toMatchObject({
      dialogueZh: undefined,
      dialogueSuppressed: true,
    });
    expect(shots[0]?.actionZh).toBe("原稿动作1");
  });

  it("四个真实标签入口均消费同一个来源派生值", () => {
    const props: string[] = [];
    function visit(node: ts.Node) {
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(tree) === "ManhuaShotSourceLabel"
      )
        props.push(node.attributes.getText(tree));
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(props).toHaveLength(4);
    expect(
      props.every(value => value === "isFallback={shotSourceIsFallback}")
    ).toBe(true);
  });
});

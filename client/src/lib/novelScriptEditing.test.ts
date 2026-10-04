import { it, expect } from "vitest";
import {
  editedNovelScript,
  editedNovelRun,
  scriptFieldKey,
} from "./novelScriptEditing";
import type { NovelRun } from "./novelWorkspace";
import { novelWorkspaceStateSchema } from "@shared/novelWorkspaceState";
import { emptyNovelWorkspace } from "./novelWorkspace";
it("persists incomplete edits separately, protects receipts/scene IDs and validates before adoption", () => {
  const script = {
    title: "原稿",
    episodes: [
      {
        index: 1,
        title: "第一集",
        opening: "开场",
        payoff: "兑现",
        hook: "钩子",
        scenes: [
          {
            key: "E1-S1",
            场景: "书库",
            人物: "沈昀",
            妆容: "官服",
            灯光: "烛光",
            氛围: "紧张",
            对白: "原对白",
          },
        ],
      },
    ],
  };
  const run = {
    input: { stage: "script" },
    result: { text: JSON.stringify(script), resultSha256: "original" },
  } as NovelRun;
  const original = JSON.stringify(run),
    key = scriptFieldKey(1, "E1-S1", "对白");
  const edits = { [key]: "修改后的对白" };
  expect(editedNovelRun(run, edits).result.text).toContain("修改后的对白");
  expect(editedNovelRun(run, edits).result.resultSha256).toBe("");
  expect(JSON.stringify(run)).toBe(original);
  expect(editedNovelScript(run, { [key]: "" }).episodes[0].scenes[0].对白).toBe(
    ""
  );
  expect(() => editedNovelRun(run, { [key]: "" })).toThrow();
  const stored = novelWorkspaceStateSchema.parse({
    ...emptyNovelWorkspace(),
    scriptEdits: { request: edits },
  });
  expect(stored.scriptEdits?.request).toEqual(edits);
  expect(
    editedNovelScript(run, { __proto__: "bad", '[1,"index"]': "88" })
      .episodes[0].index
  ).toBe(1);
});

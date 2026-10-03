import { expect, it } from "vitest";
import { filterManhuaShots } from "./manhuaShotSearch";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";

const shots: ManhuaWorkbenchShot[] = [
  { index: 2, durationSec: 3, cameraZh: "近景", actionZh: "阿菁扶住墨屠", dialogueZh: "别怕" },
  { index: 12, durationSec: 4, cameraZh: "远景", actionZh: "医馆门前", additionalDialogueCues: [{ dialogueZh: "三天太短", speakerNameZh: "墨屠" }] },
  { index: 21, durationSec: 2, cameraZh: "低角度", actionZh: "阿菁走进医馆" },
];

it("镜号精确查找，过滤后仍保留原列表位置且不改动源数据", () => {
  const before = JSON.stringify(shots);
  expect(filterManhuaShots(shots, "第０１２鏡").map(row => [row.shot.index, row.originalIndex])).toEqual([[12, 1]]);
  expect(filterManhuaShots(shots, "2").map(row => row.shot.index)).toEqual([2]);
  expect(JSON.stringify(shots)).toBe(before);
});

it("检索追加对白、人物与多关键词，空查询恢复原顺序", () => {
  expect(filterManhuaShots(shots, "墨屠 三天").map(row => row.originalIndex)).toEqual([1]);
  expect(filterManhuaShots(shots, "阿菁 医馆").map(row => row.originalIndex)).toEqual([2]);
  expect(filterManhuaShots(shots, "不存在")).toEqual([]);
  expect(filterManhuaShots(shots, "  ").map(row => row.originalIndex)).toEqual([0, 1, 2]);
});

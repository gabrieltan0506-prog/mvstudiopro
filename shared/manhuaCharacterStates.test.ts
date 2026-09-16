import { describe, expect, it } from "vitest";
import {
  buildManhuaStateDerivePromptZh,
  evaluateManhuaStateContinuity,
  formatManhuaCastStateNoteZh,
  makeManhuaCharacterStateId,
  parseManhuaCastZhWithStates,
  parseManhuaCharacterStates,
  resolveManhuaCastStates,
  resolveManhuaStateExcludedRefIds,
} from "./manhuaCharacterStates";

const states = parseManhuaCharacterStates(["常态：棕色瘸腿马", "护阿菁", "状态：肩伤=肩头炸开血口，毛发结血痂；虚弱=眼罩下眼眯成缝、腿打颤；完全体：浅色兽身金角黑翼"]);
const anchors = [
  { id: "wa_char_mt", nameZh: "墨屠", statesZh: states },
  { id: "wa_char_aj", nameZh: "阿菁", statesZh: [] },
];

describe("角色状态变体", () => {
  it("人物表「状态：」解析：= 或 ： 都行，常态不算，id 稳定", () => {
    expect(states.map((s) => s.nameZh)).toEqual(["肩伤", "虚弱", "完全体"]);
    expect(states[0]!.deltaZh).toBe("肩头炸开血口，毛发结血痂");
    expect(states[2]!.deltaZh).toBe("浅色兽身金角黑翼");
    expect(states[0]!.id).toBe(makeManhuaCharacterStateId("肩伤"));
    expect(parseManhuaCharacterStates(["状态：常态=没伤"])).toEqual([]);
  });

  it("可拍表「角色：」括注即状态；无括注为常态；去重", () => {
    expect(parseManhuaCastZhWithStates("墨屠（肩伤）；阿菁；曹三(狂怒)、墨屠（肩伤）")).toEqual([
      { nameZh: "墨屠", stateZh: "肩伤" },
      { nameZh: "阿菁", stateZh: null },
      { nameZh: "曹三", stateZh: "狂怒" },
    ]);
  });

  it("对齐人物表：定义过的状态有 id，没定义的标 undefinedState，名字对不上 anchorId 为空", () => {
    const rows = resolveManhuaCastStates("墨屠（肩伤）；阿菁；娘（咳血）；先生", anchors);
    expect(rows[0]).toMatchObject({ anchorId: "wa_char_mt", stateId: states[0]!.id, undefinedState: false, deltaZh: "肩头炸开血口，毛发结血痂" });
    expect(rows[1]).toMatchObject({ anchorId: "wa_char_aj", stateId: null, stateZh: null });
    expect(rows[2]).toMatchObject({ anchorId: null, undefinedState: true });
    expect(formatManhuaCastStateNoteZh("墨屠（肩伤）；阿菁", anchors)).toBe("墨屠（肩伤）：肩头炸开血口，毛发结血痂");
    expect(formatManhuaCastStateNoteZh("阿菁", anchors)).toBe("");
  });

  it("派生提示只加差异、其余不动，明说不美化不修复", () => {
    const p = buildManhuaStateDerivePromptZh({ nameZh: "墨屠", stateZh: "肩伤", deltaZh: "肩头炸开血口" });
    expect(p).toContain("只加「肩伤」状态：肩头炸开血口");
    expect(p).toContain("不美化、不修复");
  });

  it("连续性门禁：受伤后回常态无恢复描述告警；写了恢复不告警；未定义状态告警；不在人物表告警", () => {
    const segs = [
      { index: 1, castZh: "墨屠（肩伤）；阿菁", performanceZh: "肩头血口" },
      { index: 2, castZh: "墨屠；阿菁", performanceZh: "低头蹭手背" },
      { index: 3, castZh: "墨屠；阿菁", performanceZh: "先生给它包扎，伤口不再渗血" },
      { index: 4, castZh: "墨屠；阿菁", performanceZh: "走路" },
      { index: 5, castZh: "墨屠（狂化）；先生", performanceZh: "x" },
    ];
    const issues = evaluateManhuaStateContinuity(segs, anchors);
    expect(issues.map((i) => [i.segmentIndex, i.code])).toEqual([
      [2, "regress_to_base"],
      [5, "undefined_state"],
      [5, "no_anchor"],
    ]);
    expect(issues[0]!.messageZh).toContain("上一段还是「肩伤」");
  });
});

it("段级状态排除常态与其它状态，缺当前状态明确拒绝", () => {
  const a = [{ id: "a", nameZh: "墨屠", statesZh: [{ id: "hurt", nameZh: "肩伤", deltaZh: "出血" }] }];
  const refs = [{ id: "base", primaryBindings: [{ anchorId: "a", duty: "identity" }] }, { id: "injured", primaryBindings: [{ anchorId: "a", duty: "identity", stateId: "hurt" }] }];
  expect(Array.from(resolveManhuaStateExcludedRefIds("墨屠（肩伤）", a, refs))).toEqual(["base"]);
  expect(Array.from(resolveManhuaStateExcludedRefIds("墨屠", a, refs))).toEqual(["injured"]);
  expect(() => resolveManhuaStateExcludedRefIds("墨屠（肩伤）", a, refs.slice(0, 1))).toThrow("缺少当前参考图");
});

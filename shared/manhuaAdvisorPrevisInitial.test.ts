import { describe, it, expect } from "vitest";
import { createAdvisorPrevisStudio, selectPrevisCharacterSlots } from "./manhuaAdvisorPrevisInitial";
import { makeAdvisorPrevisTarget } from "./manhuaAdvisorPrevisEdit";
const characters = [{ id: "jing", label: "阿菁" }, { id: "mo", label: "墨屠", shape: "horse" as const }, { id: "unrelated", label: "曹三" }];
describe("真实本段人物基线", () => {
  it("只绑定本段人物并保留四足身份，顾问目标不包含媒体或模型地址", () => {
    const studio = createAdvisorPrevisStudio({ durationSec: 24, characters, shots: [{ index: 1, durationSec: 24, actionZh: "阿菁伸手拦住墨屠。" }] });
    expect(studio.spec.actors.map(a => [a.assetRef, a.nameZh, a.shape])).toEqual([["jing", "阿菁", "human"], ["mo", "墨屠", "horse"]]);
    const target = makeAdvisorPrevisTarget("clip-1", studio);
    expect(target.specJson).not.toContain("assetRef");
    expect(studio.history).toEqual([]);
  });
  it("不识别人物时失败，不使用默认角色冒充", () => {
    expect(() => createAdvisorPrevisStudio({ durationSec: 10, characters, shots: [{ index: 1, durationSec: 10, actionZh: "空镜" }] })).toThrow("未能识别");
  });
  it("明确名单中部分人物缺少资产时停止，不能只生成已绑定的半数演员", () => {
    expect(() => createAdvisorPrevisStudio({ durationSec: 10, castZh: "阿菁、娘", characters, shots: [{ index: 1, durationSec: 10, actionZh: "阿菁扶娘。" }] })).toThrow("娘");
  });
  it("超过容量不静默丢人", () => {
    const cast = Array.from({ length: 7 }, (_, i) => ({ id: `c-${i}`, label: `人物${i}` }));
    expect(() => createAdvisorPrevisStudio({ durationSec: 10, characters: cast, shots: [{ index: 1, durationSec: 10, actionZh: cast.map(c => c.label).join("、") }] })).toThrow("超过白模容量");
  });
});

it("明确出场名单优先，不把姑娘误识别为娘", () => {
  const studio = createAdvisorPrevisStudio({ durationSec: 10, castZh: "阿菁", characters: [...characters, { id: "mother", label: "娘" }], shots: [{ index: 1, durationSec: 10, actionZh: "姑娘站在树下。" }] });
  expect(studio.spec.actors.map(a => a.nameZh)).toEqual(["阿菁"]);
});
it("明确名单中的单字称呼也保留，不遗漏娘", () => {
  const studio = createAdvisorPrevisStudio({ durationSec: 10, castZh: "阿菁、娘", characters: [...characters, { id: "mother", label: "娘" }], shots: [{ index: 1, durationSec: 10, actionZh: "阿菁扶起娘。" }] });
  expect(studio.spec.actors.map(a => a.nameZh)).toEqual(["阿菁", "娘"]);
});

it("同一确认人物的脸部图和全身图只建立一名白模演员，未知身份不合并",()=>{
 const refs=[{id:"face",seedLibraryId:"zhou",duty:"identity" as const},{id:"body",seedLibraryId:"zhou",duty:"look" as const},{id:"shen",seedLibraryId:"shen"}];
 const slots=selectPrevisCharacterSlots(refs);
 expect(slots.map(s=>s.id)).toEqual(["body","shen"]);
 const studio=createAdvisorPrevisStudio({durationSec:3,castZh:"周慎、沈昀",shots:[],characters:slots.map(s=>({id:s.id,label:s.seedLibraryId==="zhou"?"周慎":"沈昀"}))});
 expect(studio.spec.actors).toHaveLength(2);
 expect(selectPrevisCharacterSlots([{id:"u1"},{id:"u2"}])).toHaveLength(2);
 expect(selectPrevisCharacterSlots([...refs,{id:"another-look",seedLibraryId:"zhou",duty:"look"}]).filter(s=>s.seedLibraryId==="zhou")).toHaveLength(2);
});

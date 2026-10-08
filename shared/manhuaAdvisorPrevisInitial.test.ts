import { describe, it, expect } from "vitest";
import { createAdvisorPrevisStudio, selectPrevisCharacterSlots } from "./manhuaAdvisorPrevisInitial";
import { manhuaPrevisSpecSchema } from "./manhuaPrevis";
import { sanitizeManhuaCloudDraftBlock } from "./manhuaCloudDraft";
import { applyAdvisorPrevisPatch, makeAdvisorPrevisTarget } from "./manhuaAdvisorPrevisEdit";
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
    const cast = Array.from({ length: 59 }, (_, i) => ({ id: `c-${i}`, label: `人物${i}` }));
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


describe("明确一次性配角无需新增资产", () => {
  const transientCharacterNames = ["打手甲", "打手乙"];
  const input = { durationSec: 10, castZh: "阿菁、打手甲、打手乙", characters,
    shots: [{ index: 1, durationSec: 10, actionZh: "打手甲从左侧接近阿菁，打手乙守在右侧。" }], transientCharacterNames };
  it("主角保持资产，两名打手各自独立基础演员，不借用曹三", () => {
    const studio = createAdvisorPrevisStudio(input);
    expect(studio.spec.actors.map(a => [a.nameZh, a.assetRef])).toEqual([["阿菁", "jing"], ["打手甲", undefined], ["打手乙", undefined]]);
    expect(new Set(studio.spec.actors.map(a => a.id)).size).toBe(3);
    expect(studio.spec.actors.slice(1).every(a => !a.riggedModel && a.shape === "human")).toBe(true);
    expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(true);
    const reversed = createAdvisorPrevisStudio({ ...input, transientCharacterNames: [...transientCharacterNames].reverse() });
    for (const name of transientCharacterNames) expect(reversed.spec.actors.find(a => a.nameZh === name)?.id).toBe(studio.spec.actors.find(a => a.nameZh === name)?.id);
  });
  it("独立站位和动作经顾问修改、云草稿恢复保持，无资产回退", () => {
    const studio = createAdvisorPrevisStudio(input);
    const [jia, yi] = studio.spec.actors.slice(1);
    studio.spec = applyAdvisorPrevisPatch(studio.spec, { kind: "previs_edit_v1", summaryZh: "两名打手分别移动和观察", unsupportedZh: [], actors: [
      { id: jia.id, start: [-2, 1], end: [-1, 1], actions: [{ kind: "walk", startSec: 0, endSec: 8 }] },
      { id: yi.id, start: [2, 1], end: [2, 1], actions: [{ kind: "turn", startSec: 1, endSec: 3, facingDeg: -90 }] },
    ] });
    const restored = sanitizeManhuaCloudDraftBlock({ id: "clip-1", kind: "video", previsStudio: studio } as never)!.previsStudio!;
    expect(restored.spec.actors).toEqual(studio.spec.actors);
    expect(restored.spec.actors[1].start).toEqual([-2, 1]);
    expect(restored.spec.actors[2].actions[0].kind).toBe("turn");
    expect(restored.spec.actors[0].assetRef).toBe("jing");
    expect(restored.spec.actors.slice(1).every(a => !a.assetRef)).toBe(true);
  });
  it("未明确启用打手或主角缺资产仍拒绝，不能任意名称降级", () => {
    expect(() => createAdvisorPrevisStudio({ ...input, transientCharacterNames: undefined })).toThrow("打手甲");
    expect(() => createAdvisorPrevisStudio({ ...input, castZh: "阿菁、娘、打手甲" })).toThrow("娘");
    expect(() => createAdvisorPrevisStudio({ ...input, transientCharacterNames: ["娘"] })).toThrow("临时配角范围不符");
  });
  it("明确名单未出场的临时演员不插入，现有准确绑定优先", () => {
    expect(createAdvisorPrevisStudio({ ...input, castZh: "阿菁" }).spec.actors.map(a => a.nameZh)).toEqual(["阿菁"]);
    const studio = createAdvisorPrevisStudio({ ...input, characters: [...characters, { id: "existing-jia", label: "打手甲" }] });
    expect(studio.spec.actors.find(a => a.nameZh === "打手甲")?.assetRef).toBe("existing-jia");
    expect(studio.spec.actors.filter(a => a.nameZh === "打手甲")).toHaveLength(1);
  });
  it("临时与资产演员合计超限时拒绝，不截断", () => {
    const bound = Array.from({ length: 57 }, (_, i) => ({ id: `person-${i}`, label: `主角${i}` }));
    expect(() => createAdvisorPrevisStudio({ ...input, characters: bound, castZh: [...bound.map(c => c.label), ...transientCharacterNames].join("、") })).toThrow("超过白模容量");
  });
});

it("七人完整保留，超过六人不会截断；只按人数与片长预算拦截", () => {
 const characters=Array.from({length:5},(_,i)=>({id:`c-${i}`,label:`人物${i}`}));
 const input={durationSec:16,characters,shots:[],castZh:[...characters.map(c=>c.label),"打手甲","打手乙"].join("、"),transientCharacterNames:["打手甲","打手乙"]};
 const studio=createAdvisorPrevisStudio(input);
 expect(studio.spec.actors).toHaveLength(7);
 expect(new Set(studio.spec.actors.map(a=>a.id)).size).toBe(7);
 expect(studio.spec.actors.every(a=>a.start.every(v=>Math.abs(v)<=12))).toBe(true);
 expect(()=>createAdvisorPrevisStudio({...input,durationSec:17})).toThrow("超出单次白模渲染能力");
});

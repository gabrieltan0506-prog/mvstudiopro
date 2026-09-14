import { describe, expect, it } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisSpecSchema,
  formatPrevisMotionGuide,
} from "./manhuaPrevis";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import {
  defaultCanvasBlock,
  normalizeCanvasBlock,
} from "../client/src/lib/canvasTypes";
import { compilePrevisScriptDraft } from "./manhuaPrevisScript";
function fixture() {
  const studio = createManhuaPrevisStudio(4);
  const actor = studio.spec.actors[0];
  Object.assign(actor, {
    nameZh: "甲",
    assetRef: "person-a",
    weapon: "practice_sword",
    start: [-0.7, 0],
    end: [-0.7, 0],
    facingDeg: 0,
    actions: [],
  });
  studio.spec.actors.push({
    ...structuredClone(actor),
    id: "actor-2",
    nameZh: "乙",
    assetRef: "person-b",
    start: [0.7, 0],
    end: [0.7, 0],
    facingDeg: 180,
  });
  studio.spec.interactions = [
    {
      id: "sword-1",
      kind: "sword_guard",
      actorId: actor.id,
      targetActorId: "actor-2",
      startSec: 0.5,
      contactSec: 2,
      endSec: 3.5,
    },
  ];
  return studio;
}
describe("持剑格挡从编辑到持久化和参考", () => {
  it("生产schema保留武器和独立剑刃事件", () => {
    const studio = fixture();
    expect(manhuaPrevisSpecSchema.parse(studio.spec)).toEqual(studio.spec);
    const guide = formatPrevisMotionGuide(studio.spec);
    expect(guide).toContain("2秒双方右手持剑，剑刃交叉格挡");
    expect(guide).not.toContain("双手接触格挡");
  });
  it.each(["missing", "horse", "unarmed-event", "solo-action"])(
    "不把不支持的%s配置当作可生产",
    mode => {
      const { spec } = fixture();
      if (mode === "missing") delete spec.actors[0].weapon;
      if (mode === "horse") spec.actors[0].shape = "horse";
      if (mode === "unarmed-event") spec.interactions![0].kind = "strike_guard";
      if (mode === "solo-action")
        spec.actors[0].actions = [{ kind: "strike", startSec: 0, endSec: 0.5 }];
      expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    }
  );
  it("草稿、旧版本及待处理快照通过实际云序列化往返保留", () => {
    const studio = fixture();
    studio.specHistory = [
      {
        spec: structuredClone(studio.spec),
        createdAt: "2026-09-13",
        reasonZh: "改前",
      },
    ];
    const block = normalizeCanvasBlock({
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-sword",
      previsStudio: studio,
    });
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [block],
      edges: [],
    });
    const restored = parseManhuaCloudDraftPayload(JSON.stringify(payload));
    expect(restored?.canvas.blocks[0].previsStudio).toEqual(
      JSON.parse(JSON.stringify(studio))
    );
  });
  it("剧本重新编译不会悄悄把持剑改成空手拳击", () => {
    const studio = fixture();
    const draft = compilePrevisScriptDraft({
      shots: [
        { index: 1, durationSec: 4, actionZh: "甲向乙出拳，乙抬手格挡。" },
      ],
      characters: [
        { id: "person-a", label: "甲" },
        { id: "person-b", label: "乙" },
      ],
      currentSpec: studio.spec,
    });
    expect(draft.errors.length).toBeGreaterThan(0);
  });
});

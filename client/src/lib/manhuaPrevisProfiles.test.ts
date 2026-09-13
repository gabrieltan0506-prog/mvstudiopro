import { describe, expect, it } from "vitest";
import { collectPreparedRigProfiles } from "./manhuaPrevisProfiles";
import { defaultCanvasBlock } from "./canvasTypes";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
const characters = [
  { id: "hero", label: "女主", model: { taskId: "m3d_current" } },
];
function fixture() {
  const studio = createManhuaPrevisStudio();
  studio.spec.actors[0].assetRef = "hero";
  studio.spec.actors[0].riggedModel = {
    sourceJobId: "m3d_current",
    forwardAxis: "+Y",
    targetHeight: 1.7,
    boneMap: { head: "Head" },
    performance: {
      controller: {
        eyeBones: { left: "EyeL", right: "EyeR" },
        expressions: {
          calm: { Calm: 1 },
          tense: { Tense: 1 },
          surprised: { Surprise: 1 },
        },
      },
      cues: [
        {
          startSec: 0,
          endSec: 2,
          gazeTarget: [0, 1, 1],
          headYawDeg: 0,
          headPitchDeg: 0,
          breathAmplitude: 0.01,
          breathHz: 0.2,
          expression: "calm",
          intensity: 1,
        },
      ],
    },
  };
  return { ...defaultCanvasBlock("video", 0, 0), previsStudio: studio };
}
describe("项目角色准备配置", () => {
  it("只按当前资产和模型收集配置，不复制其他段表演", () => {
    const source = fixture();
    const profiles = collectPreparedRigProfiles([source], characters);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].riggedModel).toMatchObject({
      forwardAxis: "+Y",
      targetHeight: 1.7,
      boneMap: { head: "Head" },
      controller: { eyeBones: { left: "EyeL", right: "EyeR" } },
    });
    expect(profiles[0].riggedModel).not.toHaveProperty("performance");
    expect(profiles[0].riggedModel).not.toHaveProperty("cues");
    expect(
      source.previsStudio.spec.actors[0].riggedModel?.performance?.cues
    ).toHaveLength(1);
  });
  it("排除归档、不同资产与已换模型，历史重复只保留一次", () => {
    const source = fixture();
    source.previsStudio.specHistory = [
      {
        spec: structuredClone(source.previsStudio.spec),
        createdAt: "today",
        reasonZh: "已保存",
      },
    ];
    expect(collectPreparedRigProfiles([source], characters)).toHaveLength(1);
    expect(
      collectPreparedRigProfiles(
        [{ ...source, archivedFromPreviousScript: true }],
        characters
      )
    ).toEqual([]);
    expect(
      collectPreparedRigProfiles(
        [source],
        [{ ...characters[0], model: { taskId: "m3d_new" } }]
      )
    ).toEqual([]);
    expect(
      collectPreparedRigProfiles(
        [source],
        [{ ...characters[0], id: "another" }]
      )
    ).toEqual([]);
  });
});

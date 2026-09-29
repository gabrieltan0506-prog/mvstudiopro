import { describe, expect, it } from "vitest";
import { stageCameraRigs, type ManhuaStageCharacter } from "../components/canvas/ManhuaWorldStagePreview";

const actor = (id: string, x: number, y: number): ManhuaStageCharacter => ({
  id, labelZh: id, glbUrl: `https://example.test/${id}.glb`, stagePoint: [x, y],
});

describe("3D 场景初始机位", () => {
  it("背负者与乘员重叠时，过肩及单人机位都离开人物中心", () => {
    const actors = [actor("马", 0, 0), actor("娘", 0, 0), actor("阿菁", 0, -1.6)];
    const rigs = stageCameraRigs(actors, "娘");
    for (const kind of ["ots", "single"] as const) {
      for (const person of actors) {
        expect(Math.hypot(rigs[kind].position[0] - person.stagePoint[0], rigs[kind].position[1] - person.stagePoint[1])).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it("选择不同肩后人物会改变机位并改拍另一名人物", () => {
    const actors = [actor("阿菁", 0, 0), actor("曹三", 0, 3), actor("娘", 4, 0)];
    const fromCao = stageCameraRigs(actors, "曹三").ots;
    const fromAjing = stageCameraRigs(actors, "阿菁").ots;
    expect(fromCao.position).not.toEqual(fromAjing.position);
    expect(fromCao.target.slice(0, 2)).toEqual([0, 0]);
    expect(fromAjing.target.slice(0, 2)).toEqual([0, 3]);
  });
});

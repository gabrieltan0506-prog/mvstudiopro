import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { movePrevisLayoutEndpoint, previsLayoutActorFacingDeg, previsLayoutActorPosition, previsLayoutCamera, projectPrevisPoint } from "./manhuaPrevisLayout";
describe("白模布局与生产规格", () => {
  it("修改端点同时更新运动轨迹，不改另一端或原配置", () => {
    const spec = createManhuaPrevisStudio(2).spec;
    const a = spec.actors[0];
    a.motionRoute = [{ timeSec: 0, position: a.start, facingDeg: 0 }, {timeSec: 47/24, position: a.end, facingDeg: 0}];
    const updated = movePrevisLayoutEndpoint(spec, a.id, "end", [5.16, -15]);
    expect(updated.actors[0].end).toEqual([5.2,-12]);
    expect(updated.actors[0].motionRoute?.[1].position).toEqual([5.2,-12]);
    expect(updated.actors[0].start).toEqual(a.start);
    expect(a.end).not.toEqual([5.2,-12]);
    expect(previsLayoutActorPosition(updated.actors[0], 47/24)).toEqual([5.2,-12,0]);
  });
  it("空机位草稿不崩溃，不虚构默认机位",()=>{ const spec=createManhuaPrevisStudio(2).spec;spec.cameras=[];expect(previsLayoutCamera(spec,0)).toBeNull(); });
  it("相机首尾帧与环绕半径正确，画后点不投影", () => {
    const spec = createManhuaPrevisStudio(2).spec;
    spec.cameras = [{startSec:0,endSec:2,position:[0,-8,3],target:[0,0,1],orbitDeg:90,lens:35}];
    expect(previsLayoutCamera(spec, 0)!.position).toEqual([0,-8,3]);
    const last = previsLayoutCamera(spec,47/24)!;
    expect(last.position[0]).toBeCloseTo(8);
    expect(last.position[1]).toBeCloseTo(0);
    expect(projectPrevisPoint([0,0,1],last,480,270)).toMatchObject({x:240,y:135});
    expect(projectPrevisPoint([20,0,7],last,480,270)).toBeNull();
  });
  it("焦距推拉与环绕升降按渲染脚本同一平滑进度：首帧起点、末帧终点、途中同一 smoothstep", () => {
    const spec = createManhuaPrevisStudio(2).spec;
    spec.cameras = [{startSec:0,endSec:2,position:[0,-8,3],target:[0,0,1],orbitDeg:90,orbitRise:-1.5,lens:24,endLens:60}];
    expect(previsLayoutCamera(spec, 0)).toMatchObject({ lensMm: 24, position: [0,-8,3] });
    const last = previsLayoutCamera(spec, 47/24)!;
    expect(last.lensMm).toBe(60);
    expect(last.position[2]).toBeCloseTo(1.5);
    // 取第 24 帧，按 render-manhua-previs.py camera_progress 手算
    const u = (24 - 1) / 47, s = u * u * (3 - 2 * u);
    expect(previsLayoutCamera(spec, 23/24)!.lensMm).toBeCloseTo(24 + 36 * s);
  });
  it("朝向插值与渲染脚本同源：轨迹节点恰好 180° 正向转，转身动作恰好 180° 走 -180", () => {
    const spec = createManhuaPrevisStudio(2).spec;
    const turner = { ...spec.actors[0], facingDeg: 0, actions: [{ kind: "turn" as const, startSec: 0, endSec: 2, facingDeg: 180 }] };
    expect(previsLayoutActorFacingDeg(turner, 1)).toBeCloseTo(-90);
    expect(previsLayoutActorFacingDeg(turner, 2)).toBe(180);
    const router = { ...spec.actors[0], actions: [], motionRoute: [{ timeSec: 0, position: [0, 0] as [number, number], facingDeg: 0 }, { timeSec: 2, position: [1, 0] as [number, number], facingDeg: 180 }] };
    expect(previsLayoutActorFacingDeg(router, 1)).toBeCloseTo(90);
  });
});

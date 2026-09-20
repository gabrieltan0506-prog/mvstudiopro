import { expect, it } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, manhuaPrevisStudioSchema, formatPrevisMotionGuide } from "./manhuaPrevis";
import { previsCamerasFromActionRecipe } from "./manhuaPrevisCameraRecipe";

it("运动相机经过生产与草稿保存后不丢终点，采用指引读取相同轨迹", () => {
  const studio = createManhuaPrevisStudio(2);
  studio.spec.cameras[0].endPosition = [2, -6, 3];
  const saved = manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(studio)));
  const parsed = manhuaPrevisSpecSchema.parse(saved.spec);
  expect(parsed.cameras[0].endPosition).toEqual([2, -6, 3]);
  expect(formatPrevisMotionGuide(parsed)).toContain("连续移动到（2，-6，3）");
});

it("相机起终点安全但中途穿过注视目标时拒绝", () => {
  const spec = createManhuaPrevisStudio(2).spec;
  spec.cameras[0] = { startSec: 0, endSec: 2, position: [-2, 0, 1], endPosition: [2, 0, 1], target: [0, 0, 1], lens: 35 };
  expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
});

it("环绕配置保存到生产，并拒绝同时叠加直线终点", () => {
  const studio = createManhuaPrevisStudio(2);
  studio.spec.cameras[0].orbitDeg = 90;
  expect(manhuaPrevisSpecSchema.parse(manhuaPrevisStudioSchema.parse(studio).spec).cameras[0].orbitDeg).toBe(90);
  studio.spec.cameras[0].endPosition = [2, -6, 3];
  expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(false);
});

it("既有穿越机配方产生可提交的俯冲侧掠拉升路径，其他配方不被改写", () => {
  const spec = createManhuaPrevisStudio(6).spec;
  const cameras = previsCamerasFromActionRecipe("action_fpv_stadium", 6, spec.actors)!;
  expect(cameras).toHaveLength(3);
  expect(cameras[0].endPosition).toEqual(cameras[1].position);
  expect(cameras[1].endPosition).toEqual(cameras[2].position);
  expect(cameras[0].position[2]).toBeGreaterThan(cameras[0].endPosition![2]);
  expect(cameras[2].endPosition![2]).toBeGreaterThan(cameras[2].position[2]);
  expect(manhuaPrevisSpecSchema.safeParse({ ...spec, cameras }).success).toBe(true);
  expect(previsCamerasFromActionRecipe("action_fight_panorama_track", 6, spec.actors)).toBeNull();
});

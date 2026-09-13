import { expect, it } from "vitest";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { createRigForm, newRigCue } from "./manhuaPrevisRigForm";
import {
  actorPositionAt,
  creatorGazeChoices,
  applyGazeChoice,
  selectedGazeChoice,
  usePreparedRig,
  configuredController,
} from "./manhuaPrevisCreator";
import type { PreparedRigProfile } from "./manhuaPrevisProfiles";
const profile: PreparedRigProfile = {
  assetRef: "hero",
  sourceJobId: "m3d_test",
  label: "主角",
  originLabel: "已保存",
  riggedModel: {
    sourceJobId: "m3d_test",
    forwardAxis: "+Y",
    targetHeight: 1.7,
  },
};
const controller = {
  eyeBones: { left: "LeftEye", right: "RightEye" },
  expressions: {
    calm: { Calm: 1 },
    tense: { Tense: 1 },
    surprised: { Surprise: 1 },
  },
};
it("移动人物不伪装成跟踪，固定目标精确转入既有坐标", () => {
  const spec = createManhuaPrevisStudio(10).spec;
  const actor = spec.actors[0];
  const target = {
    ...actor,
    id: "target",
    nameZh: "对手",
    start: [0, 0] as [number, number],
    end: [4, 0] as [number, number],
    moveStartSec: 0,
    moveEndSec: 4,
  };
  spec.actors.push(target);
  expect(actorPositionAt(target, 2)).toEqual([2, 0]);
  const cue = newRigCue(0, 3);
  const choices = creatorGazeChoices(spec, actor.id, cue);
  expect(choices.find(c => c.id === "actor:target")?.point).toBeUndefined();
  expect(() => applyGazeChoice(cue, "actor:target", choices)).toThrow("移动");
  const fixed = creatorGazeChoices(spec, actor.id, newRigCue(5, 7));
  const changed = applyGazeChoice(cue, "actor:target", fixed);
  expect(changed.gazeTarget).toEqual(["4", "0", String(1.7 * 0.92)]);
  expect(selectedGazeChoice(changed, fixed)).toBe("actor:target");
  expect(cue.gazeTarget).toEqual(["", "", ""]);
});
it("跨机位不提供假跟踪，原有任意视线不丢失", () => {
  const spec = createManhuaPrevisStudio(10).spec;
  spec.cameras = [
    { ...spec.cameras[0], startSec: 0, endSec: 5 },
    { ...spec.cameras[0], startSec: 5, endSec: 10, position: [4, 5, 6] },
  ];
  const cue = {
    ...newRigCue(0, 10),
    gazeTarget: ["1", "2", "3"] as [string, string, string],
  };
  const choices = creatorGazeChoices(spec, spec.actors[0].id, cue);
  expect(choices[0].unavailableReason).toContain("不同机位");
  expect(selectedGazeChoice(cue, choices)).toBe("saved");
  expect(() => applyGazeChoice(cue, "camera", choices)).toThrow("不同机位");
  expect(cue.gazeTarget).toEqual(["1", "2", "3"]);
});
it("复用同模型身体配置保留当前段复杂表演，换模型拒绝", () => {
  const form = createRigForm(
    {
      ...profile.riggedModel,
      performance: {
        controller,
        cues: [
          {
            startSec: 2,
            endSec: 4,
            gazeTarget: [1, 2, 3],
            headYawDeg: 12,
            headPitchDeg: -3,
            breathAmplitude: 0.02,
            breathHz: 0.3,
            expression: "tense",
            intensity: 0.6,
          },
        ],
      },
    },
    "m3d_test"
  );
  const snapshot = structuredClone(form);
  const context = {
    assetRef: "hero",
    taskId: "m3d_test",
    durationSec: 10,
    actorId: "a",
  };
  const next = usePreparedRig(form, profile, context);
  expect(next.cues).toEqual(form.cues);
  expect(next.performanceEnabled).toBe(true);
  expect(next.eyes).toEqual(form.eyes);
  next.cues[0].gazeTarget[0] = "9";
  expect(form).toEqual(snapshot);
  expect(() =>
    usePreparedRig(form, profile, { ...context, taskId: "m3d_other" })
  ).toThrow("不匹配");
});
it("另一段档案只复制控制器并创建本段时段，重复表情不能标称三种能力", () => {
  const form = createRigForm(undefined, "m3d_test");
  const spec = createManhuaPrevisStudio(10).spec;
  const next = usePreparedRig(
    form,
    { ...profile, riggedModel: { ...profile.riggedModel, controller } },
    {
      assetRef: "hero",
      taskId: "m3d_test",
      durationSec: 10,
      spec,
      actorId: spec.actors[0].id,
    }
  );
  expect(next.cues).toHaveLength(1);
  expect(next.cues[0].startSec).toBe("0");
  expect(next.cues[0].endSec).toBe("10");
  expect(configuredController(next)).toEqual(controller);
  next.expressions.tense = next.expressions.calm;
  expect(configuredController(next)).toBeUndefined();
});

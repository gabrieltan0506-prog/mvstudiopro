import { describe, it, expect } from "vitest";
import { applyRigForm, createRigForm, newRigCue } from "./manhuaPrevisRigForm";

const context = {
  taskId: "m3d_real-saved-task",
  durationSec: 5,
  shape: "human" as const,
};
function basic() {
  return { ...createRigForm(undefined, context.taskId), enabled: true };
}
function facial() {
  const f = basic();
  f.performanceEnabled = true;
  f.eyes = { left: "Eye.L", right: "Eye.R" };
  f.expressions = {
    calm: '{"Relax":1}',
    tense: '{"Tense":1}',
    surprised: '{"Surprise":1}',
  };
  f.cues = [{ ...newRigCue(0, 2), gazeTarget: ["3", "1", "1.7"] }];
  return f;
}
describe("角色表单显式应用边界", () => {
  it("默认不启用不存在的资产或面部控制器", () => {
    const f = createRigForm();
    expect(f.enabled).toBe(false);
    expect(f.performanceEnabled).toBe(false);
    expect(f.eyes.left).toBe("");
    expect(applyRigForm(f, { ...context, taskId: undefined })).toBeUndefined();
  });
  it("空骨名删除，不写空map；合法基础配置可应用", () => {
    const f = basic();
    f.boneMap = { head: "  " };
    expect(applyRigForm(f, context)).toEqual({
      sourceJobId: context.taskId,
      forwardAxis: "-Y",
      targetHeight: 1.7,
    });
  });
  it("部分映射trim并保留真实值", () => {
    const f = basic();
    f.boneMap = { head: " RealHead " };
    expect(applyRigForm(f, context)?.boneMap).toEqual({ head: "RealHead" });
  });
  it("没有当前成功任务、旧版本、非人和魔化不允许应用", () => {
    expect(() =>
      applyRigForm(basic(), { ...context, taskId: undefined })
    ).toThrow("匹配版本");
    expect(() =>
      applyRigForm(basic(), { ...context, taskId: "m3d_new" })
    ).toThrow("匹配版本");
    expect(() => applyRigForm(basic(), { ...context, shape: "horse" })).toThrow(
      "普通人形"
    );
    expect(() =>
      applyRigForm(basic(), { ...context, hasCreature: true })
    ).toThrow("普通人形");
  });
  it("停用可清除过期配置，不受缺失资产阻塞", () =>
    expect(
      applyRigForm(
        { ...basic(), enabled: false },
        { ...context, taskId: undefined }
      )
    ).toBeUndefined());
  it("不完整表演留本地且不会修改已有输入", () => {
    const f = basic();
    f.performanceEnabled = true;
    const before = JSON.stringify(f);
    expect(() => applyRigForm(f, context)).toThrow("JSON");
    expect(JSON.stringify(f)).toBe(before);
  });
  it("真实三组形变可应用，复杂权重映射恢复不丢失", () => {
    const f = facial();
    f.expressions.calm = '{"Relax":0.8,"Brow":0.2}';
    const applied = applyRigForm(f, context)!;
    expect(applyRigForm(createRigForm(applied), context)).toEqual(applied);
  });
  it("空数字不是零，NaN和越界值拒绝", () => {
    const f = facial();
    f.cues[0].gazeTarget[0] = "";
    expect(() => applyRigForm(f, context)).toThrow("有限数字");
    f.cues[0].gazeTarget[0] = "NaN";
    expect(() => applyRigForm(f, context)).toThrow("有限数字");
    f.cues[0].gazeTarget[0] = "99";
    expect(() => applyRigForm(f, context)).toThrow();
  });
  it("短于半秒、超过片长、重叠时间拒绝", () => {
    const f = facial();
    f.cues[0].endSec = "0.2";
    expect(() => applyRigForm(f, context)).toThrow("0.5秒");
    f.cues[0].endSec = "6";
    expect(() => applyRigForm(f, context)).toThrow("片长");
    f.cues[0].endSec = "2";
    f.cues.push({ ...f.cues[0] });
    expect(() => applyRigForm(f, context)).toThrow("不重叠");
  });
  it("重复眼骨、重复身体映射和三组相同表情拒绝", () => {
    const f = facial();
    f.eyes.right = f.eyes.left;
    expect(() => applyRigForm(f, context)).toThrow();
    f.eyes.right = "Eye.R";
    f.boneMap = { head: "same", neck: "same" };
    expect(() => applyRigForm(f, context)).toThrow("同一根骨骼");
    f.boneMap = {};
    f.expressions.tense = f.expressions.calm;
    expect(() => applyRigForm(f, context)).toThrow("完全相同");
  });
});

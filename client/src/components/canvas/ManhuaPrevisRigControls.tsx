import { useEffect, useState } from "react";
import type { ManhuaPrevisSpec } from "@shared/manhuaPrevis";
import {
  PREVIS_BODY_BONES,
  type PrevisRiggedModel,
} from "@shared/manhuaPrevisRig";
import {
  applyRigForm,
  createRigForm,
  newRigCue,
  RIG_EXPRESSIONS,
  type RigCueForm,
} from "@/lib/manhuaPrevisRigForm";

type Props = {
  actor: ManhuaPrevisSpec["actors"][number];
  model?: { taskId: string };
  durationSec: number;
  disabled?: boolean;
  onChange: (riggedModel: PrevisRiggedModel | undefined) => void;
};
const field =
  "w-full min-w-0 rounded border border-white/20 bg-[#141a24] p-1 text-xs text-white focus:outline-cyan-300";
const button =
  "rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-50 disabled:opacity-40";
const boneLabels: Record<(typeof PREVIS_BODY_BONES)[number], string> = {
  pelvis: "骨盆",
  spine: "胸脊",
  neck: "颈",
  head: "头",
  "upper_arm-1": "右上臂",
  "forearm-1": "右前臂",
  "hand-1": "右手",
  upper_arm1: "左上臂",
  forearm1: "左前臂",
  hand1: "左手",
  "upper_leg-1": "右大腿",
  "lower_leg-1": "右小腿",
  "foot-1": "右脚",
  upper_leg1: "左大腿",
  lower_leg1: "左小腿",
  foot1: "左脚",
};
const cueFields: Array<{
  key: Exclude<keyof RigCueForm, "gazeTarget" | "expression">;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "startSec", label: "开始（秒）", min: 0, max: 30, step: 0.5 },
  { key: "endSec", label: "结束（秒）", min: 0.5, max: 30, step: 0.5 },
  { key: "headYawDeg", label: "左右转头（度）", min: -35, max: 35, step: 1 },
  { key: "headPitchDeg", label: "上下点头（度）", min: -20, max: 20, step: 1 },
  { key: "breathAmplitude", label: "呼吸幅度", min: 0, max: 0.03, step: 0.005 },
  { key: "breathHz", label: "呼吸频率（Hz）", min: 0.1, max: 0.6, step: 0.05 },
  { key: "intensity", label: "表情强度", min: 0, max: 1, step: 0.1 },
];

/** 表单草稿不直接写入预演；只有显式应用且跨字段验证通过才通知父组件。 */
export function ManhuaPrevisRigControls({
  actor,
  model,
  durationSec,
  disabled,
  onChange,
}: Props) {
  const appliedKey = JSON.stringify(actor.riggedModel ?? null);
  const [form, setForm] = useState(() =>
    createRigForm(actor.riggedModel, model?.taskId)
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setForm(createRigForm(actor.riggedModel, model?.taskId));
    setError("");
    setNotice("");
  }, [actor.id, appliedKey, model?.taskId]);
  const incompatible = actor.shape !== "human" || !!actor.creature;
  const updateCue = (index: number, patch: Partial<RigCueForm>) =>
    setForm(f => ({
      ...f,
      cues: f.cues.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  function apply() {
    if (disabled) return;
    try {
      const value = applyRigForm(form, {
        taskId: model?.taskId,
        durationSec,
        shape: actor.shape,
        hasCreature: !!actor.creature,
      });
      onChange(value);
      setError("");
      setNotice(
        value
          ? "角色配置已应用；渲染时还会核实真实骨骼、蒙皮与形变。"
          : "已停用角色替换，原3D预览保留。"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotice("");
    }
  }
  return (
    <details className="rounded border border-cyan-300/20 bg-[#101722] p-2 text-xs text-white/80">
      <summary className="cursor-pointer text-cyan-100">
        角色模型与表演 · {actor.riggedModel ? "已应用" : "未启用"}
      </summary>
      <p className="my-2 text-amber-200/80">
        仅接受真实带骨、已蒙皮的人形GLB；无骨模型会被拒绝。原3D预览保留，不生成模型、不调用付费模型。尚不保证接地，角色替换暂不兼容双人接触。
      </p>
      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-50">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={(!model || incompatible) && !form.enabled}
            onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
          />
          启用当前角色的已有带骨模型
        </label>
        <p className="break-all font-mono text-[10px] text-white/50">
          {model
            ? `当前模型任务：${model.taskId}`
            : "当前没有与角色图版本匹配的成功3D模型。"}
        </p>
        {incompatible && (
          <p className="text-amber-200">
            四足或魔化预设不能同时使用人形带骨模型。
          </p>
        )}
        {form.enabled && (
          <>
            {form.sourceJobId !== model?.taskId && (
              <div role="alert" className="space-y-1 text-amber-200">
                <p>
                  已应用模型与当前版本不一致，不能沿用旧骨名与表情；停用仍可应用。
                </p>
                {model && (
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      setForm({
                        ...createRigForm(undefined, model.taskId),
                        enabled: true,
                      })
                    }
                  >
                    改用当前模型并重新配置
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label>
                模型正面朝向
                <select
                  className={field}
                  value={form.forwardAxis}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      forwardAxis: e.target
                        .value as PrevisRiggedModel["forwardAxis"],
                    }))
                  }
                >
                  {["+X", "-X", "+Y", "-Y"].map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                目标高度（米）
                <input
                  className={field}
                  type="number"
                  min={0.5}
                  max={3}
                  step={0.01}
                  value={form.targetHeight}
                  onChange={e =>
                    setForm(f => ({ ...f, targetHeight: e.target.value }))
                  }
                />
              </label>
            </div>
            <details>
              <summary className="cursor-pointer">
                16骨映射（可选，展开人工指定）
              </summary>
              <p className="my-1 text-white/50">
                留空按规范名严格识别，不猜测缺失或歧义骨骼。填入模型里的实际骨名。
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PREVIS_BODY_BONES.map(key => (
                  <label key={key}>
                    {boneLabels[key]}
                    <input
                      className={field}
                      value={form.boneMap[key] ?? ""}
                      placeholder={key}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          boneMap: { ...f.boneMap, [key]: e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.performanceEnabled}
                onChange={e =>
                  setForm(f => ({ ...f, performanceEnabled: e.target.checked }))
                }
              />
              配置真实眼神、头颈、呼吸与表情
            </label>
            {form.performanceEnabled && (
              <div className="space-y-3 border-l-2 border-cyan-300/30 pl-2">
                <p className="text-white/50">
                  必须有左右眼骨及三组实际头部形变；这里不会自动造眼骨或表情。空白只留在编辑表单，不能应用。
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["left", "right"] as const).map(side => (
                    <label key={side}>
                      {side === "left" ? "左眼实际骨名" : "右眼实际骨名"}
                      <input
                        className={field}
                        value={form.eyes[side]}
                        onChange={e =>
                          setForm(f => ({
                            ...f,
                            eyes: { ...f.eyes, [side]: e.target.value },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                {(
                  Object.keys(RIG_EXPRESSIONS) as Array<
                    keyof typeof RIG_EXPRESSIONS
                  >
                ).map(expression => (
                  <label className="block" key={expression}>
                    {RIG_EXPRESSIONS[expression]} · 实际形变名与权重（JSON）
                    <textarea
                      className={`${field} font-mono`}
                      rows={2}
                      value={form.expressions[expression]}
                      placeholder={'{"模型中实际存在的形变名":1}'}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          expressions: {
                            ...f.expressions,
                            [expression]: e.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ))}
                <p className="text-white/50">
                  表演轨：世界坐标视线目标；按时间排序，每段至少0.5秒，不重叠、不超出
                  {durationSec}秒片长。
                </p>
                {form.cues.map((cue, index) => (
                  <fieldset
                    key={index}
                    className="space-y-2 rounded border border-white/10 p-2"
                  >
                    <legend>表演段 {index + 1}</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {cueFields.map(({ key, label, min, max, step }) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            className={field}
                            min={min}
                            max={
                              key === "startSec" || key === "endSec"
                                ? durationSec
                                : max
                            }
                            step={step}
                            value={cue[key]}
                            onChange={e =>
                              updateCue(index, { [key]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        表情
                        <select
                          className={field}
                          value={cue.expression}
                          onChange={e =>
                            updateCue(index, {
                              expression: e.target
                                .value as RigCueForm["expression"],
                            })
                          }
                        >
                          {Object.entries(RIG_EXPRESSIONS).map(
                            ([key, label]) => (
                              <option value={key} key={key}>
                                {label}
                              </option>
                            )
                          )}
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {["X", "Y", "Z"].map((axis, i) => (
                        <label key={axis}>
                          视线{axis}（米）
                          <input
                            type="number"
                            min={-30}
                            max={30}
                            step={0.1}
                            className={field}
                            value={cue.gazeTarget[i]}
                            onChange={e => {
                              const gazeTarget = [
                                ...cue.gazeTarget,
                              ] as RigCueForm["gazeTarget"];
                              gazeTarget[i] = e.target.value;
                              updateCue(index, { gazeTarget });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        setForm(f => ({
                          ...f,
                          cues: f.cues.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      删除本段
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  className={button}
                  disabled={form.cues.length >= 24}
                  onClick={() =>
                    setForm(f => ({
                      ...f,
                      cues: [
                        ...f.cues,
                        newRigCue(
                          Number(f.cues.at(-1)?.endSec) || 0,
                          Math.min(
                            durationSec,
                            (Number(f.cues.at(-1)?.endSec) || 0) + 1
                          )
                        ),
                      ],
                    }))
                  }
                >
                  添加表演段
                </button>
              </div>
            )}
          </>
        )}
        <div className="flex gap-2">
          <button type="button" className={button} onClick={apply}>
            应用角色配置
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setForm(createRigForm(actor.riggedModel, model?.taskId));
              setError("");
              setNotice("已取消编辑，保留已应用配置。");
            }}
          >
            取消编辑
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 break-words text-red-300">
          未应用：{error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-cyan-200">
          {notice}
        </p>
      )}
    </details>
  );
}

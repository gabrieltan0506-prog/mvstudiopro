import { useEffect, useState } from "react";
import type { PreparedRigProfile } from "@/lib/manhuaPrevisProfiles";
import {
  applyGazeChoice,
  configuredController,
  creatorCue,
  creatorGazeChoices,
  selectedGazeChoice,
  usePreparedRig,
} from "@/lib/manhuaPrevisCreator";
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
  spec?: ManhuaPrevisSpec;
  profiles?: PreparedRigProfile[];
  onChange: (riggedModel: PrevisRiggedModel | undefined) => void | boolean;
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
  spec,
  profiles = [],
  onChange,
}: Props) {
  const appliedKey = JSON.stringify(actor.riggedModel ?? null);
  const [form, setForm] = useState(() =>
    createRigForm(actor.riggedModel, model?.taskId)
  );
  const [mode, setMode] = useState<"create" | "prepare">("create");
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
      if (onChange(value) === false)
        throw new Error("配置未保存，请处理保存问题后再应用");
      setError("");
      setNotice(
        value
          ? "角色配置已保存到本段；可在本项目其他段复用，效果仍需预览检查。"
          : "已停用角色替换，原3D预览保留。"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotice("");
    }
  }
  const matchingProfiles = profiles.filter(
    p => p.assetRef === actor.assetRef && p.sourceJobId === model?.taskId
  );
  const controller = configuredController(form);
  const appliedCurrent = Boolean(
    actor.riggedModel && actor.riggedModel.sourceJobId === model?.taskId
  );
  const validSource = Boolean(
    model && form.sourceJobId === model.taskId && !incompatible
  );
  const appendCue = () => {
    const start = Number(form.cues.at(-1)?.endSec) || 0;
    if (durationSec - start < 0.5 || form.cues.length >= 24) return;
    setForm(f => ({
      ...f,
      cues: [
        ...f.cues,
        creatorCue(start, Math.min(durationSec, start + 1), spec, actor.id),
      ],
    }));
  };
  const applyProfile = (profile: PreparedRigProfile) => {
    try {
      setForm(
        usePreparedRig(form, profile, {
          assetRef: actor.assetRef,
          taskId: model?.taskId,
          durationSec,
          spec,
          actorId: actor.id,
        })
      );
      setError("");
      setNotice("已载入角色配置；上一段的动作与表演没有复制，请应用到本段。");
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section
      className="rounded-lg border border-cyan-300/20 bg-[#101722] p-3 text-xs text-white/80"
      data-previs-role-editor
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-cyan-50">角色与表演</p>
          <p className="mt-1 text-[11px] text-white/55">
            {!model
              ? "尚未导入角色模型"
              : !appliedCurrent
                ? "角色配置待准备"
                : "已保存配置 · 效果待预览检查"}
          </p>
        </div>
        <div
          className="flex gap-1 rounded border border-white/15 p-1"
          role="group"
          aria-label="角色工具模式"
        >
          <button
            type="button"
            className={`${button} ${mode === "create" ? "bg-cyan-300/15" : "border-transparent"}`}
            aria-pressed={mode === "create"}
            onClick={() => setMode("create")}
          >
            日常创作
          </button>
          <button
            type="button"
            className={`${button} ${mode === "prepare" ? "bg-cyan-300/15" : "border-transparent"}`}
            aria-pressed={mode === "prepare"}
            onClick={() => setMode("prepare")}
          >
            角色准备
          </button>
        </div>
      </div>
      <div hidden={mode !== "create"} className="space-y-3">
        {!model ? (
          <p className="rounded bg-white/5 p-2 text-white/65">
            先在人物卡导入或建立角色模型。普通模型不一定带有骨骼，导入后仍须检查。
          </p>
        ) : null}
        {incompatible ? (
          <p className="text-amber-200">
            当前形体不能使用人形角色模型，请在专业调度中检查。
          </p>
        ) : null}
        {model && !incompatible && matchingProfiles.length > 0 ? (
          <div className="space-y-2 rounded border border-white/10 p-2">
            <p className="font-medium text-cyan-100">复用本项目的角色配置</p>
            <p className="text-[11px] text-white/55">
              只复用同一模型的准备设置，动作和表演由本段决定。
            </p>
            {matchingProfiles.map((profile, i) => (
              <button
                type="button"
                className={button}
                key={`${profile.sourceJobId}:${i}`}
                disabled={disabled}
                onClick={() => applyProfile(profile)}
              >
                使用{profile.label}的配置 · {profile.originLabel}
              </button>
            ))}
          </div>
        ) : null}
        {model && !form.enabled && !incompatible ? (
          <div className="space-y-2">
            <p className="text-white/65">
              先完成一次角色准备，再在各段选择动作和表情；不会自动给无骨模型补骨骼。
            </p>
            <button
              type="button"
              className={button}
              onClick={() => setMode("prepare")}
            >
              准备当前角色
            </button>
          </div>
        ) : null}
        {form.enabled ? (
          <fieldset
            disabled={disabled || !validSource}
            className="space-y-3 disabled:opacity-50"
          >
            {!validSource ? (
              <p role="alert" className="text-amber-200">
                模型版本已变化，请到角色准备重新核对；旧配置仍保留。
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                {controller
                  ? "已配置三种表情 · 请预览核实效果"
                  : "尚未配置表情，当前仅使用身体动作"}
              </p>
              <button
                type="button"
                className={button}
                onClick={() => setMode("prepare")}
              >
                {controller ? "检查角色准备" : "准备表情能力"}
              </button>
            </div>
            {controller ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.performanceEnabled}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      performanceEnabled: e.target.checked,
                      cues:
                        e.target.checked && !f.cues.length
                          ? [creatorCue(0, durationSec, spec, actor.id)]
                          : f.cues,
                    }))
                  }
                />
                使用眼神与表情
              </label>
            ) : null}
            {controller && form.performanceEnabled ? (
              <div className="space-y-3">
                {form.cues.map((cue, index) => {
                  const choices = spec
                    ? creatorGazeChoices(spec, actor.id, cue)
                    : [];
                  const selected = selectedGazeChoice(cue, choices);
                  return (
                    <fieldset
                      key={index}
                      className="space-y-2 rounded border border-white/15 p-2"
                      data-creator-cue={index}
                    >
                      <legend className="px-1 text-white/65">
                        表演 {index + 1}
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                          表情
                          <select
                            aria-label={`表演${index + 1}表情`}
                            className={`${field} mt-1`}
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
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              )
                            )}
                          </select>
                        </label>
                        <label>
                          看向谁
                          <select
                            aria-label={`表演${index + 1}看向谁`}
                            className={`${field} mt-1`}
                            value={selected}
                            onChange={e => {
                              try {
                                updateCue(
                                  index,
                                  applyGazeChoice(cue, e.target.value, choices)
                                );
                                setError("");
                              } catch (e) {
                                setError(
                                  e instanceof Error ? e.message : String(e)
                                );
                              }
                            }}
                          >
                            <option value="" disabled>
                              选择注视对象
                            </option>
                            {selected === "saved" ? (
                              <option value="saved">
                                已保存的位置（保留）
                              </option>
                            ) : null}
                            {choices.map(choice => (
                              <option
                                key={choice.id}
                                value={choice.id}
                                disabled={!!choice.unavailableReason}
                              >
                                {choice.label}
                                {choice.unavailableReason ? " · 需分段" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          开始时间（秒）
                          <input
                            aria-label={`表演${index + 1}开始`}
                            className={`${field} mt-1`}
                            type="number"
                            min={0}
                            max={durationSec - 0.5}
                            step={0.5}
                            value={cue.startSec}
                            onChange={e =>
                              updateCue(index, { startSec: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          结束时间（秒）
                          <input
                            aria-label={`表演${index + 1}结束`}
                            className={`${field} mt-1`}
                            type="number"
                            min={0.5}
                            max={durationSec}
                            step={0.5}
                            value={cue.endSec}
                            onChange={e =>
                              updateCue(index, { endSec: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-3">
                        表情强度
                        <input
                          aria-label={`表演${index + 1}强度`}
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          className="min-w-0 flex-1 accent-cyan-300"
                          value={cue.intensity}
                          onChange={e =>
                            updateCue(index, { intensity: e.target.value })
                          }
                        />
                        <span className="w-10 text-right tabular-nums">
                          {Math.round(Number(cue.intensity) * 100)}%
                        </span>
                      </label>
                      {selected === "saved" ? (
                        <p className="text-[11px] text-amber-100/80">
                          保留已有视线位置；如果改过人物站位或机位，请重新选择注视对象。
                        </p>
                      ) : null}
                      {choices.some(c => c.unavailableReason) ? (
                        <p className="text-[11px] text-white/55">
                          当前支持看向固定位置。对方移动或时段内切换机位时，请分段设置。
                        </p>
                      ) : null}
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
                        删除这段表演
                      </button>
                    </fieldset>
                  );
                })}
                <button
                  type="button"
                  className={button}
                  disabled={
                    form.cues.length >= 24 ||
                    durationSec - (Number(form.cues.at(-1)?.endSec) || 0) < 0.5
                  }
                  onClick={appendCue}
                >
                  添加一段表演
                </button>
                <p className="text-[11px] text-white/55">
                  看向人物使用其约头部位置；眼神幅度有限，是否自然以预览为准。转头与呼吸细节可在专业设置调整。
                </p>
              </div>
            ) : null}
          </fieldset>
        ) : null}
      </div>
      <div hidden={mode !== "prepare"} className="space-y-3">
        <p className="mb-2 text-white/65">
          角色制作人员在这里完成一次准备。本项目其他段可复用同一模型的配置；换模型后需要重新核对。
        </p>
        <p className="mb-2 text-amber-200/80">
          只支持已带骨、已蒙皮的人形模型。模型原始姿态和接地仍需检查；暂不兼容双人接触。复杂材质可能无法预演。
        </p>
        <fieldset disabled={disabled} className="space-y-3 disabled:opacity-50">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={(!model || incompatible) && !form.enabled}
              onChange={e =>
                setForm(f => ({ ...f, enabled: e.target.checked }))
              }
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
              <details
                className="space-y-3 rounded border border-white/15 p-2"
                data-rig-professional
              >
                <summary className="cursor-pointer text-cyan-100">
                  专业设置 · 骨骼、表情与坐标
                </summary>
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
                      setForm(f => ({
                        ...f,
                        performanceEnabled: e.target.checked,
                      }))
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
              </details>
            </>
          )}
        </fieldset>
      </div>
      <fieldset disabled={disabled} className="mt-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={apply}>
            {mode === "prepare" ? "保存角色配置" : "应用本段表演"}
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
    </section>
  );
}

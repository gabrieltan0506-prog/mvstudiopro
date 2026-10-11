import { useEffect, useState } from "react";
import type { CodeMotionProject } from "@shared/codeMotion";
import {
  CODE_MOTION_EFFECTS,
  applyCodeMotionEffect,
  type CodeMotionEffect,
} from "@shared/codeMotionEffects";

export default function CodeMotionEffects({
  project,
  disabled,
  paidAvailable,
  threeDAvailable,
  onChange,
}: {
  project: CodeMotionProject;
  disabled: boolean;
  paidAvailable: boolean;
  threeDAvailable: boolean;
  onChange(project: CodeMotionProject): void;
}) {
  const tier =
    project.brief.generationTier ?? (paidAvailable ? "paid" : "free");
  const [effect, setEffect] = useState<
      CodeMotionEffect | "model3d" | "splat3d"
    >("fade"),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (
      (tier === "free" || !threeDAvailable) &&
      (effect === "model3d" || effect === "splat3d")
    )
      setEffect("fade");
  }, [tier, effect, threeDAvailable]);
  const external = effect === "model3d" || effect === "splat3d";
  const selectedEffect = CODE_MOTION_EFFECTS.find(item => item.id === effect);
  let at = 0;
  const editableScenes =
    project.brief.style === "scenes"
      ? (project.plan?.scenes.filter(scene => {
          const start = at;
          at += scene.duration;
          return (
            scene.composition &&
            !project.plan?.codeVideo?.clips.some(
              clip => clip.at < at && clip.at + clip.duration > start
            )
          );
        }).length ?? 0)
      : 0;
  return (
    <section
      aria-label="特效与生成能力"
      className="space-y-3 rounded-xl border border-stone-200 p-4"
    >
      <h3 className="font-medium">特效与生成方式</h3>
      <label className="block text-sm">
        生成方案
        <select
          aria-label="生成方案"
          className="ml-2 rounded border p-2"
          disabled={disabled}
          value={tier}
          onChange={e => {
            const generationTier = e.target.value as "free" | "paid";
            if (generationTier === "free" && external) setEffect("fade");
            setMessage("");
            onChange({
              ...project,
              brief: { ...project.brief, generationTier },
            });
          }}
        >
          <option value="free">免费生成</option>
          <option value="paid" disabled={!paidAvailable}>
            付费生成{!paidAvailable ? "（需升级）" : ""}
          </option>
        </select>
      </label>
      <label className="block text-sm">
        选择效果
        <select
          aria-label="选择特效与能力"
          aria-describedby="ink-effect-description"
          className="ml-2 rounded border p-2"
          disabled={disabled}
          value={effect}
          onChange={e => {
            setEffect(e.target.value as typeof effect);
            setMessage("");
          }}
        >
          {(
            [
              ["layout", "图片与信息编排"],
              ["transition", "镜头转场"],
              ["decoration", "画面装饰"],
            ] as const
          ).map(([group, label]) => (
            <optgroup key={group} label={label}>
              {CODE_MOTION_EFFECTS.filter(item => item.group === group).map(
                item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                )
              )}
            </optgroup>
          ))}
          <optgroup label="独立付费工作台">
            <option
              value="model3d"
              disabled={tier === "free" || !threeDAvailable}
            >
              3D建模 · 付费工作台
              {tier === "paid" && !threeDAvailable ? "（当前账号未开放）" : ""}
            </option>
            <option
              value="splat3d"
              disabled={tier === "free" || !threeDAvailable}
            >
              3DGS场景 · 付费工作台
              {tier === "paid" && !threeDAvailable ? "（当前账号未开放）" : ""}
            </option>
          </optgroup>
        </select>
      </label>
      {external ? (
        <p id="ink-effect-description" className="text-xs leading-5">
          {effect === "model3d" ? "3D建模" : "3DGS场景"}
          在漫剧工作台内选择项目、参考素材并确认费用。此处不会发起生成，产物尚不支持直接导入本映客工程。
          <a
            className="ml-2 underline"
            href="/manhua-projects"
            target="_blank"
            rel="noreferrer"
          >
            打开漫剧工作台
          </a>
        </p>
      ) : (
        <>
          <div
            id="ink-effect-description"
            aria-live="polite"
            className="rounded-lg bg-stone-50 p-3 text-sm leading-6"
          >
            <p className="font-medium">{selectedEffect?.label}</p>
            <p>{selectedEffect?.description}</p>
            <p className="text-xs text-stone-600">
              适合：{selectedEffect?.useCase}
            </p>
          </div>
          <p className="text-xs text-stone-600" aria-label="效果采用范围">
            {!project.plan || project.brief.style !== "scenes"
              ? "请先在逐镜编排中整理画面，再采用效果。"
              : editableScenes > 0
                ? `将采用到 ${editableScenes} 个代码镜头；已有视频覆盖的镜头保留原片。`
                : "当前镜头均由原视频覆盖，没有可采用代码效果的镜头。"}
          </p>
          <button
            disabled={disabled || editableScenes === 0}
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => {
              try {
                onChange(applyCodeMotionEffect(project, effect));
                setMessage(
                  "已采用到代码镜头，可预览并保存；原视频片段保持不变。"
                );
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "未采用特效");
              }
            }}
          >
            采用到代码镜头
          </button>
          <p className="text-xs text-stone-500">
            特效写入可编辑画面，不调用视频模型。请先整理逐镜安排；选择免费生成会清除尚未提交的付费建模与3DGS选项。已开始制作的方案由原任务锁定。
          </p>
        </>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </section>
  );
}

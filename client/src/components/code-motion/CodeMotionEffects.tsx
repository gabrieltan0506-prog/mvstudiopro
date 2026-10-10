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
    if (tier === "free" && (effect === "model3d" || effect === "splat3d"))
      setEffect("fade");
  }, [tier, effect]);
  const external = effect === "model3d" || effect === "splat3d";
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
        可用特效
        <select
          aria-label="选择特效与能力"
          className="ml-2 rounded border p-2"
          disabled={disabled}
          value={effect}
          onChange={e => {
            setEffect(e.target.value as typeof effect);
            setMessage("");
          }}
        >
          {CODE_MOTION_EFFECTS.map(e => (
            <option key={e.id} value={e.id}>
              {e.label} · 免费代码特效
            </option>
          ))}
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
        </select>
      </label>
      {external ? (
        <p className="text-xs leading-5">
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
          <button
            disabled={
              disabled || !project.plan || project.brief.style !== "scenes"
            }
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
            特效写入可编辑画面，不调用视频模型。请先整理逐镜安排；选择免费生成会清除尚未提交的3D选项。已开始制作的方案由原任务锁定。
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

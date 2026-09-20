import React from "react";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";

/** 只读现有镜头数据，与成片共用来源；缺项明确展示，不自动补假表演。 */
export function ManhuaDirectorExecutionTable({ shots }: { shots: ManhuaWorkbenchShot[] }) {
  return <details className="mt-3 rounded-lg border border-white/10 p-2" data-manhua-director-execution>
    <summary className="cursor-pointer text-xs text-cyan-100">本段导演执行表 · {shots.length} 镜</summary>
    <p className="my-2 text-[11px] text-white/50">按镜头核对动作、运镜与对白。细微表演也包括身体和手势；无五官白模不代表面部表演已验证。</p>
    <div className="overflow-x-auto"><table className="min-w-[720px] text-left text-xs">
      <thead><tr>{["镜号 / 时长", "运镜与构图", "人物动作与站位", "情绪与细微表演", "对白与语气", "声音提示"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
      <tbody>{shots.map(shot => <tr key={shot.index} className="border-t border-white/10 align-top" data-execution-shot={shot.index}>
        <td className="p-2">{String(shot.index).padStart(2, "0")} / {shot.durationSec}秒</td>
        <td className="whitespace-pre-wrap p-2">{shot.cameraZh || "未填写"}</td>
        <td className="whitespace-pre-wrap p-2">{shot.actionZh || "未填写"}</td>
        <td className="whitespace-pre-wrap p-2">{[shot.emotionZh, shot.microExpressionZh].filter(Boolean).join("\n") || "未填写"}</td>
        <td className="whitespace-pre-wrap p-2">{shot.dialogueSuppressed ? "本镜无对白" : [shot.dialogueZh, ...(shot.additionalDialogueCues || []).map(cue => [cue.speakerAtTag || cue.speakerNameZh, cue.dialogueZh].filter(Boolean).join("：")), shot.voiceToneZh].filter(Boolean).join("\n") || "未填写"}</td>
        <td className="whitespace-pre-wrap p-2">{shot.soundZh || "未填写"}</td>
      </tr>)}</tbody>
    </table></div>
  </details>;
}

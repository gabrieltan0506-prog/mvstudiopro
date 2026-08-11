/**
 * 逐镜拆片表：执行卡里的结构化分镜表格。
 * 数据由扩写服务保底产出（LLM 字段优先，口播时间轴降级拆装），
 * 这里只管展示 + 复制 Markdown（PDF 链路依赖 GCS pdf-worker，按用户口径不接）。
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  formatPlatformStoryboardCellsMarkdown,
  type PlatformStoryboardCell,
} from "@shared/platformStoryboardCells";

/** 剪贴板降级：clipboard API 被权限/沙箱挡下时走老 execCommand，再不行必须让用户知道 */
function copyTextWithFallback(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

const HEADERS = ["镜", "台词文案", "场景", "景别", "动作·画面", "运镜", "剪辑备注"] as const;

export default function PlatformStoryboardCellsTable(props: {
  cells: PlatformStoryboardCell[];
}) {
  const { cells } = props;
  const [copied, setCopied] = useState(false);
  if (!cells.length) return null;

  const onCopy = () => {
    const md = formatPlatformStoryboardCellsMarkdown(cells);
    const markCopied = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    // 失败不许静默吞：clipboard API → execCommand 降级 → 明确报错（用户实测贴不上，2026-08-12）
    const tryFallback = () => {
      if (copyTextWithFallback(md)) {
        markCopied();
      } else {
        toast.error("复制没成功——请手动框选表格复制，或换浏览器再试");
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md).then(markCopied).catch(tryFallback);
    } else {
      tryFallback();
    }
  };

  return (
    <div data-platform-storyboard-cells>
      <div className="flex items-center justify-between gap-2">
        <strong className="text-[#9ddcff]">逐镜拆片表（照着就能拍）：</strong>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70 transition-colors hover:border-white/30 hover:text-white"
        >
          {copied ? "已复制" : "复制表格"}
        </button>
      </div>
      <div className="mt-1.5 overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[560px] border-collapse text-left text-[11px] leading-relaxed">
          <thead>
            <tr className="bg-white/[0.05] text-white/55">
              {HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.cellIndex} className="border-t border-white/8 align-top">
                <td className="px-2 py-1.5 text-white/45">{c.cellIndex}</td>
                <td className="px-2 py-1.5 text-[#8cefff]">{c.dialogueZh || "—"}</td>
                <td className="px-2 py-1.5">{c.sceneZh || "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{c.shotSize || "—"}</td>
                <td className="px-2 py-1.5">{c.actionZh || "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{c.cameraMoveZh || "—"}</td>
                <td className="px-2 py-1.5 text-white/55">{c.editNoteZh || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

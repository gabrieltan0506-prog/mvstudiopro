import { useEffect, useState } from "react";
import {
  OPENAI_IMAGE_VARIANT_MODE_LABEL_ZH,
  type OpenAiImageVariantMode,
} from "@shared/openaiImageVariant";
import { readOpenAiImageVariantMode, writeOpenAiImageVariantPref } from "@/lib/openaiImageVariantPref";

/**
 * 出图档位开关：OpenAI 官方 flare / sunburst / 双档各一张。画布与知识卡共用一个 localStorage 记忆，
 * 每次出图入队时现读，所以这里只管显示与写入。「双档各一张」只在画布图片节点生效（两张都进版本历史，扣两张费）；
 * 只出一张的入口（知识卡、资产标准化）按 flare 走。
 */
const MODES: OpenAiImageVariantMode[] = ["flare", "sunburst", "both"];
const SHORT: Record<OpenAiImageVariantMode, string> = { flare: "Flare", sunburst: "Sunburst", both: "双档" };

export default function OpenAiImageVariantSwitch({ compact }: { compact?: boolean }) {
  const [mode, setMode] = useState<OpenAiImageVariantMode>(() => readOpenAiImageVariantMode());
  useEffect(() => {
    const onStorage = () => setMode(readOpenAiImageVariantMode());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const pick = (next: OpenAiImageVariantMode) => {
    writeOpenAiImageVariantPref(next);
    setMode(next);
  };
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-0.5"
      title="OpenAI 官方出图模型：Flare 快、Sunburst 改图精度高；双档=画布图片节点两档各出一张（扣两张费）；WaveSpeed / EvoLink 只在官方失败时兜底"
      role="radiogroup"
      aria-label="出图模型档位"
    >
      {MODES.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={mode === v}
          onClick={() => pick(v)}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] transition ${
            mode === v ? "bg-[rgba(73,230,255,0.16)] text-[#8cefff]" : "text-[#b7add8] hover:bg-white/10"
          }`}
        >
          {compact ? SHORT[v] : OPENAI_IMAGE_VARIANT_MODE_LABEL_ZH[v]}
        </button>
      ))}
    </div>
  );
}

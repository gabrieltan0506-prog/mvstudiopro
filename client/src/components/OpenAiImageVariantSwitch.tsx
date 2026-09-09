import { useEffect, useState } from "react";
import {
  OPENAI_IMAGE_VARIANT_LABEL_ZH,
  type OpenAiImageVariant,
} from "@shared/openaiImageVariant";
import { readOpenAiImageVariantPref, writeOpenAiImageVariantPref } from "@/lib/openaiImageVariantPref";

/**
 * 出图档位开关：OpenAI 官方 flare / sunburst。画布与知识卡共用一个 localStorage 记忆，
 * 每次出图入队时现读，所以这里只管显示与写入。
 */
export default function OpenAiImageVariantSwitch({ compact }: { compact?: boolean }) {
  const [variant, setVariant] = useState<OpenAiImageVariant>(() => readOpenAiImageVariantPref());
  useEffect(() => {
    const onStorage = () => setVariant(readOpenAiImageVariantPref());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const pick = (next: OpenAiImageVariant) => {
    writeOpenAiImageVariantPref(next);
    setVariant(next);
  };
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-0.5"
      title="OpenAI 官方出图模型：Flare 快、Sunburst 改图精度高；WaveSpeed / EvoLink 只在官方失败时兜底"
      role="radiogroup"
      aria-label="出图模型档位"
    >
      {(["flare", "sunburst"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={variant === v}
          onClick={() => pick(v)}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] transition ${
            variant === v
              ? "bg-[rgba(73,230,255,0.16)] text-[#8cefff]"
              : "text-[#b7add8] hover:bg-white/10"
          }`}
        >
          {compact ? (v === "flare" ? "Flare" : "Sunburst") : OPENAI_IMAGE_VARIANT_LABEL_ZH[v]}
        </button>
      ))}
    </div>
  );
}

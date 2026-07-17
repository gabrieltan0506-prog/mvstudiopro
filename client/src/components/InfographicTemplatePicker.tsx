import { useState } from "react";
import {
  INFOGRAPHIC_NOTE_TEMPLATES,
  fillInfographicTemplatePrompt,
} from "@shared/infographicNoteTemplates";

export default function InfographicTemplatePicker({
  disabled,
  onApply,
}: {
  disabled?: boolean;
  onApply: (prompt: string, labelZh: string) => void;
}) {
  const [subject, setSubject] = useState("");
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="text-[12px] font-semibold text-white/80">百科可视化图文模板</div>
      <input
        disabled={disabled}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="主体（如 Hermès 工艺 / Tesla 发展史）"
        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-[12px] text-white"
      />
      <div className="flex flex-wrap gap-1.5">
        {INFOGRAPHIC_NOTE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            title={t.blurbZh}
            onClick={() =>
              onApply(fillInfographicTemplatePrompt(t.id, subject || t.subjectHintZh), t.labelZh)
            }
            className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] text-cyan-50/90 hover:border-cyan-300/45 disabled:opacity-40"
          >
            {t.labelZh}
          </button>
        ))}
      </div>
    </div>
  );
}

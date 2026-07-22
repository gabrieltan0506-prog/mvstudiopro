/**
 * 资产阶段：产品化风格包编辑（3+5+2 HEX + 光影/构图 DNA）。
 * 色卡 PNG 离线验收可走 Agent skill；此处写入结构化注入。
 */
import { useMemo, useState } from "react";
import {
  buildManhuaStylePackDraft,
  evaluateManhuaStylePackQuality,
  parseManhuaStylePack,
  type ManhuaStylePack,
} from "@shared/manhuaStylePack";

type Props = {
  value: ManhuaStylePack | null;
  onChange: (next: ManhuaStylePack | null) => void;
  artStyleLabelZh?: string;
  sceneKeywordsZh?: string[];
};

function ColorRow(props: {
  label: string;
  colors: string[];
  count: number;
  onChange: (colors: string[]) => void;
}) {
  const slots = Array.from({ length: props.count }, (_, i) => props.colors[i] || "");
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-white/55">{props.label}</div>
      <div className="flex flex-wrap gap-1.5">
        {slots.map((c, i) => (
          <input
            key={`${props.label}-${i}`}
            value={c}
            onChange={(e) => {
              const next = [...slots];
              next[i] = e.target.value.trim();
              props.onChange(next);
            }}
            placeholder="#AABBCC"
            className="w-[4.75rem] rounded border border-white/15 bg-black/40 px-1.5 py-1 font-mono text-[10px] text-white/90"
          />
        ))}
      </div>
    </div>
  );
}

export default function ManhuaStylePackPanel({
  value,
  onChange,
  artStyleLabelZh,
  sceneKeywordsZh,
}: Props) {
  const [draft, setDraft] = useState<Partial<ManhuaStylePack>>(
    () => value || buildManhuaStylePackDraft({ artStyleLabelZh, sceneKeywordsZh }),
  );
  const quality = useMemo(
    () => evaluateManhuaStylePackQuality(parseManhuaStylePack(draft)),
    [draft],
  );

  const apply = () => {
    const pack = parseManhuaStylePack(draft);
    if (!pack) {
      onChange(null);
      return;
    }
    onChange(pack);
  };

  return (
    <div
      className="space-y-2 rounded-lg border border-violet-400/25 bg-violet-500/5 p-2.5"
      data-manhua-style-pack-panel="true"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-violet-100/90">风格包</div>
        <button
          type="button"
          className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/5"
          onClick={() => {
            const d = buildManhuaStylePackDraft({ artStyleLabelZh, sceneKeywordsZh });
            setDraft(d);
            onChange(null);
          }}
        >
          从画风草稿
        </button>
      </div>
      <p className="text-[10px] leading-snug text-white/45">
        填满 3 主色 + 5 辅色 + 2 点缀色与强视觉锁后生效；只借色彩光影构图，不抄原片造型。
      </p>
      <input
        value={draft.nameZh || ""}
        onChange={(e) => setDraft((d) => ({ ...d, nameZh: e.target.value }))}
        placeholder="风格包名称"
        className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/90"
      />
      <textarea
        value={draft.artLockZh || ""}
        onChange={(e) => setDraft((d) => ({ ...d, artLockZh: e.target.value }))}
        placeholder="强视觉锁：色彩+光源+构图+情绪（一句）"
        rows={2}
        className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/90"
      />
      <ColorRow
        label="主色 ×3"
        colors={draft.primaryColors || []}
        count={3}
        onChange={(primaryColors) => setDraft((d) => ({ ...d, primaryColors }))}
      />
      <ColorRow
        label="辅助色 ×5"
        colors={draft.secondaryColors || []}
        count={5}
        onChange={(secondaryColors) => setDraft((d) => ({ ...d, secondaryColors }))}
      />
      <ColorRow
        label="点缀色 ×2"
        colors={draft.accentColors || []}
        count={2}
        onChange={(accentColors) => setDraft((d) => ({ ...d, accentColors }))}
      />
      {(
        [
          ["lightingZh", "光影"],
          ["textureZh", "材质"],
          ["compositionZh", "构图"],
          ["cameraRhythmZh", "镜头节奏"],
        ] as const
      ).map(([key, label]) => (
        <input
          key={key}
          value={String(draft[key] || "")}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          placeholder={label}
          className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/90"
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-white/50">
          {quality.ok ? "已可注入静帧/成片" : quality.issues[0] || "未完成"}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/60"
            onClick={() => {
              setDraft(buildManhuaStylePackDraft({ artStyleLabelZh, sceneKeywordsZh }));
              onChange(null);
            }}
          >
            清除
          </button>
          <button
            type="button"
            className="rounded border border-violet-300/40 bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-50 disabled:opacity-40"
            disabled={!quality.ok}
            onClick={apply}
          >
            应用风格包
          </button>
        </div>
      </div>
      {value ? (
        <div className="text-[10px] text-emerald-200/80">当前生效：{value.nameZh}</div>
      ) : null}
    </div>
  );
}

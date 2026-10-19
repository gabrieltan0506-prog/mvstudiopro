import {
  SUBTITLE_HIGHLIGHT_OPTIONS,
  type SubtitleHighlight,
} from "@shared/subtitleHighlights";

export function SubtitleHighlightEditor({
  value,
  onChange,
  disabled,
}: {
  value: SubtitleHighlight[];
  onChange: (value: SubtitleHighlight[]) => void;
  disabled: boolean;
}) {
  const patch = (id: string, next: Partial<SubtitleHighlight>) =>
    onChange(value.map(c => (c.id === id ? { ...c, ...next } : c)));
  return (
    <fieldset
      disabled={disabled}
      className="mt-3 space-y-3 rounded border border-white/15 p-3"
    >
      <legend className="text-xs">重点字幕 · 与普通字幕同时烧录</legend>
      {value.map((cue, index) => (
        <div
          key={cue.id}
          className="space-y-2 border-b border-white/10 pb-3"
          aria-label={`重点字幕${index + 1}`}
        >
          <input
            aria-label={`重点文字${index + 1}`}
            value={cue.text}
            maxLength={48}
            onChange={e => patch(cue.id, { text: e.target.value })}
            placeholder="重点文字；归序用 | 分开"
            className="w-full rounded border bg-transparent p-2 text-xs"
          />
          <select
            aria-label={`重点效果${index + 1}`}
            value={cue.effect}
            onChange={e =>
              patch(cue.id, {
                effect: e.target.value as SubtitleHighlight["effect"],
              })
            }
            className="rounded border bg-transparent p-2 text-xs"
          >
            {SUBTITLE_HIGHLIGHT_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2 text-xs">
            {(
              [
                ["开始秒", "startSec", 0, 7200, 0.01],
                ["结束秒", "endSec", 0, 7200, 0.01],
                ["重点字号", "fontSize", 8, 24, 1],
                ["距顶部%", "positionPercent", 15, 85, 1],
              ] as const
            ).map(([label, key, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={`${label}${index + 1}`}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={cue[key]}
                  onChange={e =>
                    patch(cue.id, { [key]: Number(e.target.value) })
                  }
                  className="ml-1 w-20 rounded border bg-transparent p-1"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange(value.filter(c => c.id !== cue.id))}
            className="text-xs underline"
          >
            删除本条重点
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || value.length >= 120}
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              startSec: value.at(-1)?.endSec ?? 0,
              endSec: (value.at(-1)?.endSec ?? 0) + 2,
              text: "",
              effect: "impact",
              positionPercent: 72,
              fontSize: 13,
            },
          ])
        }
        className="rounded border px-3 py-2 text-xs"
      >
        添加重点字幕
      </button>
      <p className="text-xs text-white/60">
        按原片填写时间并预览避开人物。归序用竖线分成2至4个关键词，每个最多6字；其他重点最多18字，每条0.2至30秒。
      </p>
    </fieldset>
  );
}

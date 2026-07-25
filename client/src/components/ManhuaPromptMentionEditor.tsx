import { useEffect, useMemo, useRef, useState } from "react";
import {
  manhuaAssetChipDutyLabelZh,
  parseManhuaPromptAssetMetaByTag,
  type ManhuaPromptAssetMeta,
} from "@shared/manhuaPromptAssetChips";
import { readMentionQuery } from "@/lib/manhuaPromptMention";

const KIND_ORDER: ManhuaPromptAssetMeta["kind"][] = ["角色", "服装", "场景", "道具"];

const KIND_TONE: Record<ManhuaPromptAssetMeta["kind"], string> = {
  角色: "text-amber-200",
  服装: "text-fuchsia-200",
  场景: "text-sky-200",
  道具: "text-emerald-200",
};

/**
 * 段成片提示词编辑框：敲 `@` 直接列出本段可用的人物/场景/道具让人挑。
 *
 * 资产目录来自这段提示词自带的对照表，所以列出来的一定是本段真的挂了图的那些；
 * 用户不必再去别处翻 `cust_xxx` 这种 id，挑完写进去的标签也保证和硬绑表对得上。
 */
export default function ManhuaPromptMentionEditor({
  value,
  onChange,
  disabled,
  rows = 5,
  placeholder,
  thumbUrlByAssetId,
  segmentIndex,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  thumbUrlByAssetId?: Record<string, string>;
  segmentIndex?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const assets = useMemo(() => {
    const byTag = parseManhuaPromptAssetMetaByTag(value);
    return Object.values(byTag).sort((a, b) => {
      const ko = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (ko !== 0) return ko;
      return a.tag.localeCompare(b.tag, "zh");
    });
  }, [value]);

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim();
    if (!q) return assets;
    return assets.filter(
      (a) => a.tag.includes(q) || a.labelZh.includes(q) || a.kind.includes(q),
    );
  }, [assets, mention]);

  useEffect(() => {
    setActiveIdx(0);
  }, [mention?.query]);

  const syncMention = (el: HTMLTextAreaElement) => {
    if (!assets.length) {
      setMention(null);
      return;
    }
    setMention(readMentionQuery(el.value, el.selectionStart ?? 0));
  };

  const insert = (meta: ManhuaPromptAssetMeta) => {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? 0;
    const next = `${value.slice(0, mention.at)}${meta.tag}${value.slice(caret)}`;
    onChange(next);
    setMention(null);
    const pos = mention.at + meta.tag.length;
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const open = Boolean(mention) && matches.length > 0;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        data-manhua-clip-prompt={segmentIndex}
        disabled={disabled}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          syncMention(e.currentTarget);
        }}
        onClick={(e) => syncMention(e.currentTarget)}
        onKeyUp={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") return;
          syncMention(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            insert(matches[activeIdx] || matches[0]!);
          } else if (e.key === "Escape") {
            setMention(null);
          }
        }}
        onBlur={() => window.setTimeout(() => setMention(null), 120)}
        className="w-full resize-y rounded border border-white/10 bg-black/40 px-1.5 py-1 font-mono text-[10px] leading-snug text-white/80 disabled:opacity-40"
      />
      {open ? (
        <div
          data-manhua-mention-picker="open"
          className="absolute left-1 top-full z-30 mt-1 max-h-56 w-64 overflow-auto rounded border border-white/15 bg-[#12141a] p-1 shadow-xl"
        >
          <div className="px-1 pb-1 text-[9px] text-white/40">
            本段可挂资产 · ↑↓ 选，回车插入
          </div>
          {matches.map((m, i) => {
            const thumb = thumbUrlByAssetId?.[m.assetId];
            const duty = manhuaAssetChipDutyLabelZh(m.duty);
            return (
              <button
                key={m.tag}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(m)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[10px] ${
                  i === activeIdx ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded bg-white/10" />
                )}
                <span className={`shrink-0 font-mono ${KIND_TONE[m.kind]}`}>{m.tag}</span>
                <span className="truncate text-white/75">{m.labelZh}</span>
                {duty ? (
                  <span className="ml-auto shrink-0 text-[9px] text-white/40">{duty}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

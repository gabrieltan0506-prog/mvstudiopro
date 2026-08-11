import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  manhuaAssetChipDutyLabelZh,
  type ManhuaPromptAssetMeta,
} from "@shared/manhuaPromptAssetChips";
import {
  buildManhuaMentionCandidates,
  upsertManhuaPromptAssetBindRow,
  type ManhuaAssetLockRegistry,
  type ManhuaMentionCandidate,
} from "@shared/manhuaAssetLockRegistry";
import type { ManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import { readMentionQuery } from "@/lib/manhuaPromptMention";

const KIND_TONE: Record<string, string> = {
  角色: "text-amber-200",
  服装: "text-fuchsia-200",
  场景: "text-sky-200",
  道具: "text-emerald-200",
  板: "text-orange-200",
};

const PICKER_W = 288;
const PICKER_MAX_H = 224;

/**
 * 面板必须挂到 body：审阅栏是 `max-h-[42vh] overflow-y-auto` 的滚动容器，
 * 绝对定位的下拉会被它整条裁掉——面板明明开着，屏幕上一片空白。
 * 这里按输入框位置算固定坐标，下方不够就翻到上方，并夹回视口内。
 */
function pickerPosition(anchor: DOMRect): { left: number; top: number } {
  const gap = 4;
  const below = anchor.bottom + gap;
  const flip = below + PICKER_MAX_H > window.innerHeight - 8;
  const top = flip ? Math.max(8, anchor.top - PICKER_MAX_H - gap) : below;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PICKER_W - 8));
  return { left, top };
}

/**
 * 段成片提示词编辑框：敲 `@` 列出本集所有可锁的人物/场景/道具，挑一个就真锁上。
 *
 * 候选来自**资产库 + 剧本设定表**。早先版本反着接——候选解析自这段提示词自带的
 * 对照表，于是资产还没绑时候选恒为空，面板一次都不弹，偏偏那正是最需要挑图的时刻。
 * 现在还没出图的角色也列（置灰），点一下直接去补图，不让人对着哑火的 @ 猜自己敲错了。
 *
 * 挑中之后除了插标签，还要把这一行写进对照表：出片时靠对照表把 tag 解析成垫图，
 * 只插标签不落表的话，脸照样锁不住。
 */
export default function ManhuaPromptMentionEditor({
  value,
  onChange,
  disabled,
  rows = 5,
  placeholder,
  thumbUrlByAssetId,
  segmentIndex,
  registry,
  assetCanon,
  onRequestGenerateAsset,
  boardCandidate = null,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  thumbUrlByAssetId?: Record<string, string>;
  segmentIndex?: number;
  /** 本集资产库：@ 的候选源 */
  registry?: ManhuaAssetLockRegistry | null;
  /** 剧本设定表：补上还没出图的角色/场景，让人看得见并能点去生成 */
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** 点了还没出图的候选：跳去生成那一张 */
  onRequestGenerateAsset?: (candidate: ManhuaMentionCandidate) => void;
  /** 本集导演板（有则出现 @板N 候选：红线=角色动线、青线=镜头轨迹，只进提示词层） */
  boardCandidate?: { tag: string; labelZh: string; thumbUrl?: string } | null;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  const candidates = useMemo(() => {
    const base = buildManhuaMentionCandidates({ registry, prompt: value, assetCanon });
    if (!boardCandidate?.tag) return base;
    // 导演板：插 tag 不落对照表（出片链按段自动带板；红青线只进提示词层）
    return [
      ...base,
      {
        tag: boardCandidate.tag,
        assetId: `board:${boardCandidate.tag}`,
        labelZh: boardCandidate.labelZh,
        kind: "板",
        duty: null,
        ready: true,
        bound: false,
      } as unknown as ManhuaMentionCandidate,
    ];
  }, [registry, value, assetCanon, boardCandidate]);

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.tag.includes(q) || c.labelZh.includes(q) || c.kind.includes(q),
    );
  }, [candidates, mention]);

  useEffect(() => {
    setActiveIdx(0);
  }, [mention?.query]);

  const syncMention = (el: HTMLTextAreaElement) => {
    setMention(readMentionQuery(el.value, el.selectionStart ?? 0));
  };

  const trackAnchor = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAnchor(pickerPosition(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!mention) {
      setAnchor(null);
      return;
    }
    trackAnchor();
  }, [mention, trackAnchor]);

  // 审阅栏本身会滚：面板固定在 body 上，不跟着重算就会飘在原地
  useEffect(() => {
    if (!mention) return;
    window.addEventListener("scroll", trackAnchor, true);
    window.addEventListener("resize", trackAnchor);
    return () => {
      window.removeEventListener("scroll", trackAnchor, true);
      window.removeEventListener("resize", trackAnchor);
    };
  }, [mention, trackAnchor]);

  const pick = (c: ManhuaMentionCandidate) => {
    const el = ref.current;
    if (!el || !mention) return;
    // 还没出图的没有编号可插，插了也是句空标签：直接把人送去补这一张
    if (!c.ready || !c.tag) {
      setMention(null);
      onRequestGenerateAsset?.(c);
      return;
    }
    const caret = el.selectionStart ?? 0;
    const withTag = `${value.slice(0, mention.at)}${c.tag}${value.slice(caret)}`;
    if (c.kind === "板") {
      onChange(withTag);
      setMention(null);
      const posB = mention.at + c.tag.length;
      window.requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(posB, posB);
      });
      return;
    }
    const meta: ManhuaPromptAssetMeta = {
      tag: c.tag,
      assetId: c.assetId,
      labelZh: c.labelZh,
      kind: c.kind as ManhuaPromptAssetMeta["kind"],
      duty: c.duty ?? null,
    };
    onChange(upsertManhuaPromptAssetBindRow(withTag, meta));
    setMention(null);
    const pos = mention.at + c.tag.length;
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const open = Boolean(mention) && matches.length > 0;
  // 敲了 @ 却一个候选都没有：说明本集连设定表都还没有，得说清楚而不是干瞪眼
  const emptyHint = Boolean(mention) && matches.length === 0;

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
            pick(matches[activeIdx] || matches[0]!);
          } else if (e.key === "Escape") {
            setMention(null);
          }
        }}
        onBlur={() => window.setTimeout(() => setMention(null), 160)}
        className="w-full resize-y rounded border border-white/10 bg-black/40 px-1.5 py-1 font-mono text-[10px] leading-snug text-white/80 disabled:opacity-40"
      />
      {emptyHint && anchor
        ? createPortal(
            <div
              data-manhua-mention-picker="empty"
              style={{ left: anchor.left, top: anchor.top, width: PICKER_W }}
              className="fixed z-[60] rounded border border-white/15 bg-[#12141a] px-2 py-1.5 text-[10px] leading-4 text-white/55 shadow-xl"
            >
              本集还没有可挂的人物或场景。先在左栏「资产设定」点「生成全部」，出图后这里就能挑。
            </div>,
            document.body,
          )
        : null}
      {open && anchor
        ? createPortal(
            <div
              data-manhua-mention-picker="open"
              style={{
                left: anchor.left,
                top: anchor.top,
                width: PICKER_W,
                maxHeight: PICKER_MAX_H,
              }}
              className="fixed z-[60] overflow-auto rounded border border-white/15 bg-[#12141a] p-1 shadow-xl"
            >
          <div className="px-1 pb-1 text-[9px] text-white/40">
            本集可挂资产 · ↑↓ 选，回车插入 · 灰的先去出图
          </div>
          {matches.map((m, i) => {
            const thumb = thumbUrlByAssetId?.[m.assetId];
            const duty = manhuaAssetChipDutyLabelZh(m.duty);
            return (
              <button
                key={m.tag || `pending:${m.assetId}`}
                type="button"
                data-manhua-mention-ready={m.ready ? "true" : "false"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[10px] ${
                  i === activeIdx ? "bg-white/10" : "hover:bg-white/5"
                } ${m.ready ? "" : "opacity-50"}`}
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
                <span className={`shrink-0 font-mono ${KIND_TONE[m.kind] || "text-white/60"}`}>
                  {m.tag || m.kind}
                </span>
                <span className="truncate text-white/75">{m.labelZh}</span>
                <span className="ml-auto shrink-0 text-[9px] text-white/40">
                  {m.ready ? duty || (m.bound ? "已挂" : "") : "未出图 · 去生成"}
                </span>
              </button>
            );
          })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

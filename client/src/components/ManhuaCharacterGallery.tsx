/**
 * 漫剧工厂 · 角色库卡片墙 + 设定卡三视图预览 + 画风 A/B/C
 * 设定卡图底部为 FRONT/SIDE/BACK；上方为人像与文案。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MANHUA_ART_STYLE_PRESETS,
  formatManhuaCharacterLookSummary,
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  listManhuaCharactersByGender,
  type ManhuaArtStyleId,
  type ManhuaCharacterGender,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";

function matchesCharacterQuery(c: ManhuaCharacterTemplate, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [c.nameZh, c.jobZh, c.id, ...c.temperamentTags, c.promptZh].join(" ").toLowerCase();
  return hay.includes(needle);
}

type Props = {
  femaleId: string;
  maleId: string;
  femaleAutoApplied?: boolean;
  maleAutoApplied?: boolean;
  artStyleId: ManhuaArtStyleId;
  artStyleAutoApplied?: boolean;
  disabled?: boolean;
  onSelectFemale: (id: string) => void;
  onSelectMale: (id: string) => void;
  onSelectArtStyle: (id: ManhuaArtStyleId) => void;
  onClearManual?: () => void;
  /** 同版式：铺设定卡生图节点（不自动跑） */
  onGenerateSameLayout?: (gender: ManhuaCharacterGender) => void;
  reasonZh?: string;
};

/** 设定卡下半 FRONT/SIDE/BACK：三栏各自裁切，而不是整条糊一层标签 */
function TriViewStrip({ url, compact }: { url: string; compact?: boolean }) {
  const h = compact ? "h-24" : "h-28";
  const panels: Array<{ label: string; bgPos: string }> = [
    { label: "正面", bgPos: "0% 100%" },
    { label: "侧面", bgPos: "50% 100%" },
    { label: "背面", bgPos: "100% 100%" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {panels.map((p) => (
        <div key={p.label} className={`relative overflow-hidden rounded-md border border-white/10 bg-black/50 ${h}`}>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${url})`,
              backgroundRepeat: "no-repeat",
              // 宽×3 取下半三视图之一；高放大以锁底部全身条
              backgroundSize: "300% 255%",
              backgroundPosition: p.bgPos,
            }}
            role="img"
            aria-label={p.label}
          />
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] font-semibold tracking-wide text-white/85">
            {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function CharacterSheetPreview({
  character,
  accent,
  autoApplied,
  compact,
}: {
  character: ManhuaCharacterTemplate;
  accent: "cyan" | "amber";
  autoApplied?: boolean;
  compact?: boolean;
}) {
  const url = getManhuaCharacterPreviewUrl(character.id);
  const ring =
    accent === "cyan"
      ? "border-cyan-400/55 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
      : "border-amber-400/55 shadow-[0_0_24px_rgba(251,191,36,0.12)]";
  const tag =
    accent === "cyan"
      ? "bg-cyan-500/15 text-cyan-100 border-cyan-400/35"
      : "bg-amber-500/15 text-amber-100 border-amber-400/35";
  const look = formatManhuaCharacterLookSummary(character);

  return (
    <div className={`overflow-hidden rounded-xl border ${ring} bg-black/40`}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-white">{character.nameZh}</h4>
            {autoApplied ? (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${tag}`}>已自动套用</span>
            ) : (
              <span className="rounded-md border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-100">
                已选中
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-white/55">
            {character.jobZh}
            {character.age ? ` · ${character.age}岁` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {character.temperamentTags.map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/75">
                {t}
              </span>
            ))}
          </div>
          {look ? <p className="mt-2 text-[10px] leading-snug text-white/50">{look}</p> : null}
        </div>
      </div>

      {url ? (
        <>
          {/* 设定卡上半左侧为人像；用左上定位裁切，避免裁到右侧文案 */}
          <div
            className={`relative mx-3 mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/50 ${compact ? "h-28" : "h-40"}`}
          >
            <img
              src={url}
              alt={`${character.nameZh} 人像`}
              className="absolute inset-0 h-full w-[210%] max-w-none object-cover object-[12%_18%]"
              loading="lazy"
            />
          </div>
          <div className="mx-3 mt-2 mb-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-white/45">
              <span>三视图 · 正 / 侧 / 背</span>
              <span className="inline-flex items-center gap-1 text-emerald-200/70">
                <span className="text-emerald-300">✓</span>
                已锁定妆造
              </span>
            </div>
            <TriViewStrip url={url} compact={compact} />
          </div>
        </>
      ) : (
        <div className="m-3 rounded-lg border border-dashed border-white/15 px-3 py-8 text-center text-[11px] text-white/40">
          暂无预览图
        </div>
      )}
    </div>
  );
}

function LibraryCard({
  character,
  selected,
  accent,
  onSelect,
  disabled,
}: {
  character: ManhuaCharacterTemplate;
  selected: boolean;
  accent: "cyan" | "amber";
  onSelect: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const url = getManhuaCharacterPreviewUrl(character.id);
  const showPreview = hover || pinned;
  const border = selected
    ? accent === "cyan"
      ? "border-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,0.45)]"
      : "border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.45)]"
    : "border-white/10 hover:border-white/25";

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          setPinned((v) => !v);
        }}
        data-character-id={character.id}
        className={`w-full overflow-hidden rounded-xl border bg-black/35 text-left transition disabled:opacity-45 ${border}`}
      >
        <div className="relative h-28 overflow-hidden bg-black/50">
          {url ? (
            <img
              src={url}
              alt={character.nameZh}
              className="absolute inset-0 h-full w-[200%] max-w-none object-cover object-[12%_16%]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-white/35">无图</div>
          )}
          {selected ? (
            <span
              className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                accent === "cyan" ? "bg-cyan-400 text-black" : "bg-amber-400 text-black"
              }`}
            >
              ✓
            </span>
          ) : null}
        </div>
        <div className="px-2 py-1.5">
          <div className="truncate text-[12px] font-semibold text-white">{character.nameZh}</div>
          <div className="truncate text-[10px] text-white/45">{character.temperamentTags.slice(0, 3).join(" · ")}</div>
        </div>
      </button>

      {showPreview && url ? (
        <div className="pointer-events-none absolute left-1/2 top-0 z-30 w-64 -translate-x-1/2 -translate-y-[92%] rounded-xl border border-white/20 bg-[#0c081c]/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-white/70">
            <span>预览妆造 · 三视图</span>
            {pinned ? <span className="text-cyan-200/80">已钉住</span> : null}
          </div>
          <TriViewStrip url={url} compact />
          <div className="mt-1 truncate text-[10px] text-white/55">
            {character.nameZh} · {character.jobZh}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyLead({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 px-3 py-10 text-center text-[11px] text-white/40">
      尚未选择{label}
    </div>
  );
}

export default function ManhuaCharacterGallery({
  femaleId,
  maleId,
  femaleAutoApplied,
  maleAutoApplied,
  artStyleId,
  artStyleAutoApplied,
  disabled,
  onSelectFemale,
  onSelectMale,
  onSelectArtStyle,
  onClearManual,
  onGenerateSameLayout,
  reasonZh,
}: Props) {
  const [libraryTab, setLibraryTab] = useState<ManhuaCharacterGender>("female");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const libraryRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const females = useMemo(() => listManhuaCharactersByGender("female"), []);
  const males = useMemo(() => listManhuaCharactersByGender("male"), []);
  const selectedFemale = femaleId ? getManhuaCharacterById(femaleId) : null;
  const selectedMale = maleId ? getManhuaCharacterById(maleId) : null;
  const pool = libraryTab === "female" ? females : males;
  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of pool) {
      for (const t of c.temperamentTags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([t]) => t)
      .slice(0, 10);
  }, [pool]);
  const filteredPool = useMemo(
    () =>
      pool.filter((c) => {
        if (tagFilter && !c.temperamentTags.includes(tagFilter)) return false;
        return matchesCharacterQuery(c, libraryQuery);
      }),
    [pool, libraryQuery, tagFilter],
  );
  const selectedInTab = libraryTab === "female" ? femaleId : maleId;

  useEffect(() => {
    if (!selectedInTab || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-character-id="${selectedInTab}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedInTab, libraryTab, filteredPool.length]);

  const focusLibrary = (gender: ManhuaCharacterGender) => {
    setLibraryTab(gender);
    setLibraryQuery("");
    setTagFilter("");
    requestAnimationFrame(() => {
      libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-white/90">② 角色卡</div>
          <div className="mt-1.5 max-w-xl rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-white/55">
            <span className="font-semibold text-white/70">怎么用：</span>
            题材自动套用 → 悬停/长按看三视图 → 点选更换（女主青 / 男主琥珀）→ 下方统一画风 →
            「同版式」铺生图节点（需你点运行）
          </div>
        </div>
        {onClearManual ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onClearManual}
            className="text-[10px] text-sky-200/80 underline-offset-2 hover:underline disabled:opacity-40"
          >
            恢复自动推荐
          </button>
        ) : null}
      </div>
      {reasonZh ? <p className="mt-2 text-[10px] leading-snug text-emerald-200/75">{reasonZh}</p> : null}

      {/* 双人同显 */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-cyan-100/80">女主（青色高亮）</div>
          {selectedFemale ? (
            <CharacterSheetPreview character={selectedFemale} accent="cyan" autoApplied={femaleAutoApplied} compact />
          ) : (
            <EmptyLead label="女主" />
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => focusLibrary("female")}
              className="rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 disabled:opacity-40"
            >
              更换女主
            </button>
            <button
              type="button"
              disabled={disabled || !onGenerateSameLayout}
              onClick={() => onGenerateSameLayout?.("female")}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 disabled:opacity-40"
            >
              同版式生成新人
            </button>
            <button
              type="button"
              disabled={disabled || !selectedFemale}
              onClick={() => onSelectFemale("")}
              className="rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-[11px] text-white/55 disabled:opacity-40"
            >
              清除
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-amber-100/80">男主（琥珀高亮）</div>
          {selectedMale ? (
            <CharacterSheetPreview character={selectedMale} accent="amber" autoApplied={maleAutoApplied} compact />
          ) : (
            <EmptyLead label="男主" />
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => focusLibrary("male")}
              className="rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold text-amber-50 disabled:opacity-40"
            >
              更换男主
            </button>
            <button
              type="button"
              disabled={disabled || !onGenerateSameLayout}
              onClick={() => onGenerateSameLayout?.("male")}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 disabled:opacity-40"
            >
              同版式生成新人
            </button>
            <button
              type="button"
              disabled={disabled || !selectedMale}
              onClick={() => onSelectMale("")}
              className="rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-[11px] text-white/55 disabled:opacity-40"
            >
              清除
            </button>
          </div>
        </div>
      </div>

      <div ref={libraryRef} className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-white/70">从角色库更换</div>
          <div className="inline-flex rounded-lg border border-white/10 bg-black/40 p-0.5">
            <button
              type="button"
              onClick={() => {
                setLibraryTab("female");
                setLibraryQuery("");
                setTagFilter("");
              }}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold ${
                libraryTab === "female" ? "bg-cyan-500/25 text-cyan-100" : "text-white/55"
              }`}
            >
              女主
            </button>
            <button
              type="button"
              onClick={() => {
                setLibraryTab("male");
                setLibraryQuery("");
                setTagFilter("");
              }}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold ${
                libraryTab === "male" ? "bg-amber-500/25 text-amber-100" : "text-white/55"
              }`}
            >
              男主
            </button>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            disabled={disabled}
            placeholder="搜索名字 / 职业 / 气质…"
            className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/25 disabled:opacity-45"
          />
          <span className="text-[10px] text-white/35">
            {filteredPool.length}/{pool.length}
          </span>
        </div>
        {tagOptions.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setTagFilter("")}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                !tagFilter ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
              }`}
            >
              全部气质
            </button>
            {tagOptions.map((t) => (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => setTagFilter((prev) => (prev === t ? "" : t))}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  tagFilter === t
                    ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                    : "border-white/10 text-white/50 hover:border-white/25"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mb-2 text-[10px] text-white/40">
          悬停预览三视图 · 右键钉住/取消预览
        </div>
        <div
          ref={gridRef}
          className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4"
        >
          {filteredPool.map((c) => (
            <LibraryCard
              key={c.id}
              character={c}
              selected={selectedInTab === c.id}
              accent={libraryTab === "female" ? "cyan" : "amber"}
              disabled={disabled}
              onSelect={() => {
                if (libraryTab === "female") onSelectFemale(c.id);
                else onSelectMale(c.id);
              }}
            />
          ))}
          {!filteredPool.length ? (
            <div className="col-span-full rounded-lg border border-dashed border-white/15 px-3 py-8 text-center text-[11px] text-white/40">
              无匹配角色，试试清空搜索或气质筛选
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-white/80">角色与场景画风（须与场景一致）</div>
          {artStyleAutoApplied ? (
            <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-100">
              已按题材推荐
            </span>
          ) : (
            <span className="text-[10px] text-white/40">手选优先</span>
          )}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {MANHUA_ART_STYLE_PRESETS.map((p) => {
            const selected = artStyleId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectArtStyle(p.id)}
                className={`rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-45 ${
                  selected
                    ? "border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-white">{p.labelZh}</span>
                  {selected ? <span className="text-[11px] font-bold text-cyan-300">✓</span> : null}
                </div>
                <p className="mt-1 text-[10px] text-white/45">{p.shortZh}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-white/40">
          选定后写入角色卡与关键静帧提示词。库预览图目前为 CG 设定卡底图；「同版式生成新人」会铺一张竖版设定卡生图节点，需你在画布上点运行。
        </p>
      </div>
    </div>
  );
}

/**
 * 漫剧工厂 · 角色库卡片墙 + 设定卡三视图预览 + 画风 A/B/C
 * 设定卡图底部为 FRONT/SIDE/BACK；上方为人像与文案。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MANHUA_ART_STYLE_PRESETS,
  MANHUA_COUPLE_PACKS,
  MANHUA_TEMPERAMENT_PACKS,
  buildManhuaCharacterClipboardText,
  characterMatchesTemperamentPack,
  formatManhuaCharacterLookSummary,
  getManhuaArtStylePreset,
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  getManhuaTemperamentPackById,
  listManhuaCharactersByGender,
  parseManhuaCoupleSelection,
  parseManhuaFavoriteIds,
  recommendManhuaCouplePacksFromTopic,
  serializeManhuaCoupleSelection,
  serializeManhuaFavoriteIds,
  suggestManhuaContrastPartner,
  suggestManhuaSameFieldPartner,
  type ManhuaArtStyleId,
  type ManhuaCharacterGender,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";
import {
  clearRecentIds,
  copyText,
  loadCustomCouples,
  loadFavoriteIds,
  loadLibraryPrefs,
  loadRecentIds,
  pushRecentId,
  saveCustomCouples,
  saveFavoriteIds,
  saveLibraryPrefs,
  toggleFavoriteId,
  type CustomCouple,
} from "@/lib/manhuaCharacterGalleryStorage";

type AgeBand = "" | "le25" | "26_28" | "ge29";

function matchesAgeBand(c: ManhuaCharacterTemplate, band: AgeBand): boolean {
  if (!band) return true;
  const age = c.age || 0;
  if (!age) return false;
  if (band === "le25") return age <= 25;
  if (band === "26_28") return age >= 26 && age <= 28;
  return age >= 29;
}

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
  /** 题材文案：软高亮套组，不自动覆盖 */
  topicHint?: string;
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
  artStyleId,
}: {
  character: ManhuaCharacterTemplate;
  accent: "cyan" | "amber";
  autoApplied?: boolean;
  compact?: boolean;
  artStyleId?: ManhuaArtStyleId;
}) {
  const url = getManhuaCharacterPreviewUrl(character.id);
  const style = getManhuaArtStylePreset(artStyleId);
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
            <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/55">
              {style.labelZh}
            </span>
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
  favorited,
  accent,
  onSelect,
  onToggleFavorite,
  disabled,
}: {
  character: ManhuaCharacterTemplate;
  selected: boolean;
  favorited: boolean;
  accent: "cyan" | "amber";
  onSelect: () => void;
  onToggleFavorite: () => void;
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
    : favorited
      ? "border-rose-300/35 hover:border-rose-300/55"
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
        aria-label={`选用 ${character.nameZh}${favorited ? "（已收藏）" : ""}`}
        aria-pressed={selected}
        className={`w-full overflow-hidden rounded-xl border bg-black/35 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70 disabled:opacity-45 ${border}`}
      >
        <div className="relative h-28 overflow-hidden bg-black/50">
          {url ? (
            <img
              src={url}
              alt=""
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
          <div className="flex items-baseline justify-between gap-1">
            <div className="truncate text-[12px] font-semibold text-white">{character.nameZh}</div>
            {character.age ? <span className="shrink-0 text-[10px] text-white/35">{character.age}</span> : null}
          </div>
          <div className="truncate text-[10px] text-white/45">
            {character.jobZh}
            {character.temperamentTags.length ? ` · ${character.temperamentTags.slice(0, 2).join(" · ")}` : ""}
          </div>
        </div>
      </button>
      <button
        type="button"
        disabled={disabled}
        title={favorited ? "取消收藏" : "收藏"}
        aria-label={favorited ? `取消收藏 ${character.nameZh}` : `收藏 ${character.nameZh}`}
        aria-pressed={favorited}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`absolute left-1.5 top-1.5 z-10 rounded-full border px-1.5 py-0.5 text-[11px] leading-none backdrop-blur disabled:opacity-40 ${
          favorited
            ? "border-rose-300/50 bg-rose-500/30 text-rose-100"
            : "border-white/20 bg-black/50 text-white/55 hover:border-white/35 hover:text-white/85"
        }`}
      >
        ★
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

function DualCompareStrip({
  female,
  male,
  artStyleId,
}: {
  female: ManhuaCharacterTemplate | null;
  male: ManhuaCharacterTemplate | null;
  artStyleId: ManhuaArtStyleId;
}) {
  if (!female && !male) return null;
  const style = getManhuaArtStylePreset(artStyleId);
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-white/75">双人对照</div>
        <div className="text-[10px] text-white/40">画风 · {style.labelZh}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { c: female, label: "女主", tone: "text-cyan-100/85" },
          { c: male, label: "男主", tone: "text-amber-100/85" },
        ].map(({ c, label, tone }) => (
          <div key={label} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
            <div className={`text-[10px] font-semibold ${tone}`}>{label}</div>
            {c ? (
              <>
                <div className="mt-0.5 truncate text-[12px] font-semibold text-white">{c.nameZh}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-white/50">
                  {formatManhuaCharacterLookSummary(c)}
                </div>
              </>
            ) : (
              <div className="mt-1 text-[10px] text-white/35">未选</div>
            )}
          </div>
        ))}
      </div>
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
  topicHint,
}: Props) {
  const initialPrefs = useMemo(() => loadLibraryPrefs(), []);
  const [libraryTab, setLibraryTab] = useState<ManhuaCharacterGender>(
    () => initialPrefs.tab || "female",
  );
  const [libraryQuery, setLibraryQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [ageBand, setAgeBand] = useState<AgeBand>("");
  const [packFilterId, setPackFilterId] = useState(() => initialPrefs.packFilterId || "");
  const [sortMode, setSortMode] = useState<"default" | "name" | "age">(
    () => initialPrefs.sortMode || "default",
  );
  const [denseGrid, setDenseGrid] = useState(() => Boolean(initialPrefs.dense));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [unselectedOnly, setUnselectedOnly] = useState(false);
  const [lockArtStyle, setLockArtStyle] = useState(() => Boolean(initialPrefs.lockArtStyle));
  const [compareId, setCompareId] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecentIds());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavoriteIds());
  const [customCouples, setCustomCouples] = useState<CustomCouple[]>(() => loadCustomCouples());
  const [copyFlash, setCopyFlash] = useState("");
  const libraryRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const packFilter = useMemo(() => getManhuaTemperamentPackById(packFilterId), [packFilterId]);
  const topicCoupleRec = useMemo(
    () => recommendManhuaCouplePacksFromTopic(topicHint || ""),
    [topicHint],
  );
  const topicCoupleSet = useMemo(() => new Set(topicCoupleRec.packIds), [topicCoupleRec.packIds]);
  const females = useMemo(() => listManhuaCharactersByGender("female"), []);
  const males = useMemo(() => listManhuaCharactersByGender("male"), []);
  const selectedFemale = femaleId ? getManhuaCharacterById(femaleId) : null;
  const selectedMale = maleId ? getManhuaCharacterById(maleId) : null;
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const pool = libraryTab === "female" ? females : males;
  const recentInTab = useMemo(() => {
    const out: ManhuaCharacterTemplate[] = [];
    for (const id of recentIds) {
      const c = getManhuaCharacterById(id);
      if (c && c.gender === libraryTab) out.push(c);
      if (out.length >= 6) break;
    }
    return out;
  }, [recentIds, libraryTab]);
  const favoritesInTab = useMemo(() => {
    const out: ManhuaCharacterTemplate[] = [];
    for (const id of favoriteIds) {
      const c = getManhuaCharacterById(id);
      if (c && c.gender === libraryTab) out.push(c);
      if (out.length >= 8) break;
    }
    return out;
  }, [favoriteIds, libraryTab]);
  const similarInTab = useMemo(() => {
    const current = pool.find((c) => c.id === (libraryTab === "female" ? femaleId : maleId));
    if (!current) return [] as ManhuaCharacterTemplate[];
    const tags = new Set(current.temperamentTags);
    return pool
      .filter((c) => c.id !== current.id)
      .map((c) => ({
        c,
        score: c.temperamentTags.reduce((n, t) => n + (tags.has(t) ? 1 : 0), 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.nameZh.localeCompare(b.c.nameZh, "zh"))
      .slice(0, 5)
      .map((x) => x.c);
  }, [pool, libraryTab, femaleId, maleId]);
  const contrastPartners = useMemo(() => {
    const anchorId = libraryTab === "female" ? femaleId : maleId;
    if (!anchorId) return [] as ManhuaCharacterTemplate[];
    return suggestManhuaContrastPartner(anchorId, {
      excludeIds: [femaleId, maleId],
      limit: 5,
    });
  }, [libraryTab, femaleId, maleId]);
  const sameFieldPartners = useMemo(() => {
    const anchorId = libraryTab === "female" ? femaleId : maleId;
    if (!anchorId) return [] as ManhuaCharacterTemplate[];
    return suggestManhuaSameFieldPartner(anchorId, {
      excludeIds: [femaleId, maleId],
      limit: 5,
    });
  }, [libraryTab, femaleId, maleId]);

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
  const jobOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of pool) {
      const j = String(c.jobZh || "").trim();
      if (j) counts.set(j, (counts.get(j) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([j]) => j)
      .slice(0, 8);
  }, [pool]);
  const filteredPool = useMemo(() => {
    const selectedIds = new Set([femaleId, maleId].filter(Boolean));
    const list = pool.filter((c) => {
      if (favoritesOnly && !favoriteSet.has(c.id)) return false;
      if (unselectedOnly && selectedIds.has(c.id)) return false;
      if (!characterMatchesTemperamentPack(c, packFilter)) return false;
      if (tagFilter && !c.temperamentTags.includes(tagFilter)) return false;
      if (jobFilter && c.jobZh !== jobFilter) return false;
      if (!matchesAgeBand(c, ageBand)) return false;
      return matchesCharacterQuery(c, libraryQuery);
    });
    if (sortMode === "name") {
      return [...list].sort((a, b) => a.nameZh.localeCompare(b.nameZh, "zh"));
    }
    if (sortMode === "age") {
      return [...list].sort((a, b) => (a.age || 99) - (b.age || 99) || a.nameZh.localeCompare(b.nameZh, "zh"));
    }
    return list;
  }, [
    pool,
    libraryQuery,
    tagFilter,
    jobFilter,
    ageBand,
    favoritesOnly,
    unselectedOnly,
    favoriteSet,
    packFilter,
    sortMode,
    femaleId,
    maleId,
  ]);
  const selectedInTab = libraryTab === "female" ? femaleId : maleId;

  const rememberSelect = (id: string, gender: ManhuaCharacterGender) => {
    if (gender === "female") onSelectFemale(id);
    else onSelectMale(id);
    if (id) {
      pushRecentId(id);
      setRecentIds(loadRecentIds());
    }
  };

  const applyCouplePair = (
    female: string,
    male: string,
    opts?: { artStyleId?: ManhuaArtStyleId; labelZh?: string },
  ) => {
    rememberSelect(female, "female");
    rememberSelect(male, "male");
    if (opts?.artStyleId && !lockArtStyle) onSelectArtStyle(opts.artStyleId);
    setCopyFlash(
      opts?.labelZh
        ? `已套用套组：${opts.labelZh}${lockArtStyle && opts.artStyleId ? "（画风已锁定）" : ""}`
        : "已套用双人",
    );
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const applyCouplePack = (packId: string) => {
    const pack = MANHUA_COUPLE_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    applyCouplePair(pack.femaleId, pack.maleId, {
      artStyleId: pack.artStyleId,
      labelZh: pack.labelZh,
    });
  };

  const saveCurrentAsCustomCouple = () => {
    if (!femaleId || !maleId) return;
    const f = getManhuaCharacterById(femaleId);
    const m = getManhuaCharacterById(maleId);
    if (!f || !m) return;
    const labelZh = `${f.nameZh}×${m.nameZh}`;
    const id = `custom_${femaleId}_${maleId}`;
    const entry: CustomCouple = {
      id,
      labelZh,
      femaleId,
      maleId,
      artStyleId,
    };
    const next = [entry, ...customCouples.filter((x) => x.id !== id)].slice(0, 8);
    setCustomCouples(saveCustomCouples(next));
    setCopyFlash(`已保存套组：${labelZh}`);
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const removeCustomCouple = (id: string) => {
    setCustomCouples(saveCustomCouples(customCouples.filter((x) => x.id !== id)));
  };

  const exportCustomCouples = async () => {
    const payload = JSON.stringify({ v: 1, kind: "manhua-character-custom-couples", items: customCouples });
    const ok = await copyText(payload);
    setCopyFlash(ok ? `已导出我的套组 ${customCouples.length}` : "导出失败");
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const importCustomCouples = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const parsed = JSON.parse(raw) as { kind?: string; items?: CustomCouple[] };
      if (!parsed || parsed.kind !== "manhua-character-custom-couples" || !Array.isArray(parsed.items)) {
        setCopyFlash("剪贴板无有效「我的套组」JSON");
        window.setTimeout(() => setCopyFlash(""), 1800);
        return;
      }
      const incoming = parsed.items
        .filter(
          (x) =>
            x &&
            getManhuaCharacterById(x.femaleId)?.gender === "female" &&
            getManhuaCharacterById(x.maleId)?.gender === "male",
        )
        .map((x) => ({
          id: String(x.id || `custom_${x.femaleId}_${x.maleId}`),
          labelZh: String(x.labelZh || "我的套组").slice(0, 24),
          femaleId: String(x.femaleId),
          maleId: String(x.maleId),
          artStyleId: x.artStyleId,
        }));
      if (!incoming.length) {
        setCopyFlash("导入套组为空或 id 无效");
        window.setTimeout(() => setCopyFlash(""), 1800);
        return;
      }
      const merged = [...incoming, ...customCouples.filter((c) => !incoming.some((i) => i.id === c.id))].slice(
        0,
        8,
      );
      setCustomCouples(saveCustomCouples(merged));
      setCopyFlash(`已导入套组 ${incoming.length}`);
      window.setTimeout(() => setCopyFlash(""), 1600);
    } catch {
      setCopyFlash("无法读取/解析剪贴板");
      window.setTimeout(() => setCopyFlash(""), 1800);
    }
  };

  const pickRandomCouplePack = () => {
    if (!MANHUA_COUPLE_PACKS.length) return;
    const others = MANHUA_COUPLE_PACKS.filter((p) => !(p.femaleId === femaleId && p.maleId === maleId));
    const bag = others.length ? others : MANHUA_COUPLE_PACKS;
    const pick = bag[Math.floor(Math.random() * bag.length)];
    if (pick) applyCouplePack(pick.id);
  };

  const pickRandomBothLeads = () => {
    const fPool = females.filter((c) => characterMatchesTemperamentPack(c, packFilter));
    const mPool = males.filter((c) => characterMatchesTemperamentPack(c, packFilter));
    if (!fPool.length || !mPool.length) return;
    const fBag = fPool.filter((c) => c.id !== femaleId);
    const mBag = mPool.filter((c) => c.id !== maleId);
    const f = (fBag.length ? fBag : fPool)[Math.floor(Math.random() * (fBag.length ? fBag.length : fPool.length))];
    const m = (mBag.length ? mBag : mPool)[Math.floor(Math.random() * (mBag.length ? mBag.length : mPool.length))];
    if (f && m) applyCouplePair(f.id, m.id, { artStyleId, labelZh: `${f.nameZh}×${m.nameZh}` });
  };

  const favoriteBothLeads = () => {
    const ids = [femaleId, maleId].filter(Boolean);
    if (!ids.length) return;
    let next = [...favoriteIds];
    for (const id of ids) {
      if (!next.includes(id)) next = [id, ...next];
    }
    setFavoriteIds(saveFavoriteIds(next.slice(0, 24)));
    setCopyFlash("已收藏当前女主/男主");
    window.setTimeout(() => setCopyFlash(""), 1400);
  };

  const toggleFavorite = (id: string) => {
    setFavoriteIds(toggleFavoriteId(id));
  };

  const exportFavorites = async () => {
    const payload = serializeManhuaFavoriteIds(favoriteIds);
    const ok = await copyText(payload);
    setCopyFlash(ok ? `已导出收藏 JSON（${favoriteIds.length}）` : "导出失败");
    window.setTimeout(() => setCopyFlash(""), 1800);
  };

  const importFavorites = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const ids = parseManhuaFavoriteIds(raw);
      if (!ids.length) {
        setCopyFlash("剪贴板无有效收藏 id");
        window.setTimeout(() => setCopyFlash(""), 1800);
        return;
      }
      const merged = [...ids, ...favoriteIds.filter((x) => !ids.includes(x))].slice(0, 24);
      setFavoriteIds(saveFavoriteIds(merged));
      setCopyFlash(`已导入收藏 ${ids.length} 个`);
      window.setTimeout(() => setCopyFlash(""), 1800);
    } catch {
      setCopyFlash("无法读取剪贴板（需权限）");
      window.setTimeout(() => setCopyFlash(""), 1800);
    }
  };

  const clearFavorites = () => {
    setFavoriteIds(saveFavoriteIds([]));
    setFavoritesOnly(false);
    setCopyFlash("已清空收藏");
    window.setTimeout(() => setCopyFlash(""), 1400);
  };

  const pickRandomInTab = () => {
    if (!filteredPool.length) return;
    const others = filteredPool.filter((c) => c.id !== selectedInTab);
    const bag = others.length ? others : filteredPool;
    const pick = bag[Math.floor(Math.random() * bag.length)];
    if (pick) rememberSelect(pick.id, libraryTab);
  };

  const copyFilteredIds = async () => {
    const ids = filteredPool.map((c) => c.id);
    if (!ids.length) return;
    const ok = await copyText(ids.join("\n"));
    setCopyFlash(ok ? `已复制筛选 id ${ids.length} 个` : "复制失败");
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const copySelected = async (gender: ManhuaCharacterGender) => {
    const id = gender === "female" ? femaleId : maleId;
    const text = buildManhuaCharacterClipboardText(id, { artStyleId });
    const ok = await copyText(text);
    setCopyFlash(ok ? (gender === "female" ? "女主锚点已复制" : "男主锚点已复制") : "复制失败");
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const copyBoth = async () => {
    const parts = [femaleId, maleId]
      .map((id) => buildManhuaCharacterClipboardText(id, { artStyleId }))
      .filter(Boolean);
    const ok = await copyText(parts.join("\n\n——\n\n"));
    setCopyFlash(ok ? "男女主锚点已复制" : "复制失败");
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const exportCoupleSelection = async () => {
    const payload = serializeManhuaCoupleSelection({ femaleId, maleId, artStyleId });
    const ok = await copyText(payload);
    setCopyFlash(ok ? "已导出双人选型 JSON" : "导出失败");
    window.setTimeout(() => setCopyFlash(""), 1600);
  };

  const importCoupleSelection = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const parsed = parseManhuaCoupleSelection(raw);
      if (!parsed || (!parsed.femaleId && !parsed.maleId)) {
        setCopyFlash("剪贴板无有效双人选型");
        window.setTimeout(() => setCopyFlash(""), 1800);
        return;
      }
      if (parsed.femaleId) rememberSelect(parsed.femaleId, "female");
      if (parsed.maleId) rememberSelect(parsed.maleId, "male");
      if (parsed.artStyleId) onSelectArtStyle(parsed.artStyleId);
      setCopyFlash("已导入双人选型");
      window.setTimeout(() => setCopyFlash(""), 1600);
    } catch {
      setCopyFlash("无法读取剪贴板（需权限）");
      window.setTimeout(() => setCopyFlash(""), 1800);
    }
  };

  const clearLibraryFilters = () => {
    setLibraryQuery("");
    setTagFilter("");
    setJobFilter("");
    setAgeBand("");
    setPackFilterId("");
    setFavoritesOnly(false);
    setUnselectedOnly(false);
    setSortMode("default");
  };

  const hasActiveFilters = Boolean(
    libraryQuery ||
      tagFilter ||
      jobFilter ||
      ageBand ||
      packFilterId ||
      favoritesOnly ||
      unselectedOnly ||
      sortMode !== "default",
  );

  const compareCharacter =
    compareId && compareId !== selectedInTab ? getManhuaCharacterById(compareId) : null;
  const selectedForCompare = selectedInTab ? getManhuaCharacterById(selectedInTab) : null;

  useEffect(() => {
    setCompareId("");
  }, [libraryTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === "Escape") {
        if (hasActiveFilters || compareId) {
          e.preventDefault();
          clearLibraryFilters();
          setCompareId("");
        }
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (e.shiftKey) pickRandomBothLeads();
        else pickRandomInTab();
        return;
      }
      if ((e.key === "f" || e.key === "F") && selectedInTab) {
        e.preventDefault();
        toggleFavorite(selectedInTab);
        return;
      }
      if ((e.key === "c" || e.key === "C") && selectedInTab) {
        e.preventDefault();
        setCompareId((prev) => (prev === selectedInTab ? "" : selectedInTab));
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (/^[1-8]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const pack = MANHUA_COUPLE_PACKS[Number(e.key) - 1];
        if (pack) {
          e.preventDefault();
          applyCouplePack(pack.id);
        }
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (!filteredPool.length) return;
      e.preventDefault();
      const idx = Math.max(
        0,
        filteredPool.findIndex((c) => c.id === selectedInTab),
      );
      const nextIdx =
        e.key === "ArrowRight"
          ? (idx + 1) % filteredPool.length
          : (idx - 1 + filteredPool.length) % filteredPool.length;
      const next = filteredPool[nextIdx];
      if (next) rememberSelect(next.id, libraryTab);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, filteredPool, selectedInTab, libraryTab, hasActiveFilters, compareId]);

  useEffect(() => {
    if (!selectedInTab || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-character-id="${selectedInTab}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedInTab, libraryTab, filteredPool.length]);

  useEffect(() => {
    saveLibraryPrefs({
      tab: libraryTab,
      packFilterId: packFilterId || undefined,
      sortMode,
      dense: denseGrid,
      lockArtStyle,
    });
  }, [libraryTab, packFilterId, sortMode, denseGrid, lockArtStyle]);

  const focusLibrary = (gender: ManhuaCharacterGender) => {
    setLibraryTab(gender);
    setLibraryQuery("");
    setTagFilter("");
    setJobFilter("");
    setPackFilterId("");
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
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={disabled || (!femaleId && !maleId)}
            onClick={() => void copyBoth()}
            className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
          >
            复制双人锚点
          </button>
          <button
            type="button"
            disabled={disabled || (!femaleId && !maleId)}
            onClick={() => void exportCoupleSelection()}
            className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
          >
            导出双人选型
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void importCoupleSelection()}
            className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
          >
            导入双人选型
          </button>
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
      </div>
      {reasonZh ? <p className="mt-2 text-[10px] leading-snug text-emerald-200/75">{reasonZh}</p> : null}
      {copyFlash ? <p className="mt-1 text-[10px] text-emerald-200/85">{copyFlash}</p> : null}
      <DualCompareStrip female={selectedFemale} male={selectedMale} artStyleId={artStyleId} />

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-white/75">男女套组（一键选用）</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled || !MANHUA_COUPLE_PACKS.length}
              onClick={pickRandomCouplePack}
              className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
            >
              随机套组
            </button>
            <button
              type="button"
              disabled={disabled || !females.length || !males.length}
              onClick={pickRandomBothLeads}
              className="text-[10px] text-white/70 underline-offset-2 hover:underline disabled:opacity-40"
            >
              随机双人
            </button>
            <button
              type="button"
              disabled={disabled || !femaleId || !maleId}
              onClick={favoriteBothLeads}
              className="text-[10px] text-rose-200/80 underline-offset-2 hover:underline disabled:opacity-40"
            >
              收藏当前双人
            </button>
            <button
              type="button"
              disabled={disabled || !femaleId || !maleId}
              onClick={saveCurrentAsCustomCouple}
              className="text-[10px] text-emerald-200/80 underline-offset-2 hover:underline disabled:opacity-40"
            >
              保存当前双人为套组
            </button>
            <span className="text-[10px] text-white/35">会同步画风 · 不烧 token</span>
          </div>
        </div>
        {topicCoupleRec.reasonZh ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[10px] text-violet-100/70">{topicCoupleRec.reasonZh}（仅高亮，不自动套用）</p>
            {topicCoupleRec.packIds[0] ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => applyCouplePack(topicCoupleRec.packIds[0]!)}
                className="rounded-md border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-50 disabled:opacity-40"
              >
                一键套用首推
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {MANHUA_COUPLE_PACKS.map((p, idx) => {
            const active = femaleId === p.femaleId && maleId === p.maleId;
            const soft = topicCoupleSet.has(p.id);
            const hotkey = idx < 8 ? String(idx + 1) : "";
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                title={hotkey ? `${p.blurbZh}（快捷键 ${hotkey}）` : p.blurbZh}
                onClick={() => applyCouplePack(p.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-[10px] disabled:opacity-40 ${
                  active
                    ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-100"
                    : soft
                      ? "border-violet-400/40 bg-violet-500/10 text-violet-50 hover:border-violet-300/55"
                      : "border-white/10 bg-black/30 text-white/70 hover:border-white/25"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  {hotkey ? <span className="text-white/35">{hotkey}.</span> : null}
                  {p.labelZh}
                  {soft && !active ? (
                    <span className="rounded px-1 text-[9px] font-normal text-violet-200/80">题材</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-white/40">{p.blurbZh}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || !customCouples.length}
            onClick={() => void exportCustomCouples()}
            className="text-[10px] text-white/55 underline-offset-2 hover:underline disabled:opacity-40"
          >
            导出我的套组
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void importCustomCouples()}
            className="text-[10px] text-white/55 underline-offset-2 hover:underline disabled:opacity-40"
          >
            导入我的套组
          </button>
        </div>
        {customCouples.length ? (
          <div className="mt-2">
            <div className="mb-1 text-[10px] text-white/40">我的套组</div>
            <div className="flex flex-wrap gap-1.5">
              {customCouples.map((p) => {
                const active = femaleId === p.femaleId && maleId === p.maleId;
                return (
                  <div key={p.id} className="inline-flex items-stretch gap-0.5">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        applyCouplePair(p.femaleId, p.maleId, {
                          artStyleId: p.artStyleId,
                          labelZh: p.labelZh,
                        })
                      }
                      className={`rounded-l-lg border px-2.5 py-1.5 text-[10px] disabled:opacity-40 ${
                        active
                          ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-100"
                          : "border-white/10 bg-black/30 text-white/70 hover:border-white/25"
                      }`}
                    >
                      {p.labelZh}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      title="删除此套组"
                      onClick={() => removeCustomCouple(p.id)}
                      className="rounded-r-lg border border-l-0 border-white/10 bg-black/40 px-1.5 text-[10px] text-white/40 hover:text-white/70 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* 双人同显 */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-cyan-100/80">女主（青色高亮）</div>
          {selectedFemale ? (
            <CharacterSheetPreview
              character={selectedFemale}
              accent="cyan"
              autoApplied={femaleAutoApplied}
              artStyleId={artStyleId}
              compact
            />
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
              onClick={() => void copySelected("female")}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 disabled:opacity-40"
            >
              复制锚点
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
            <CharacterSheetPreview
              character={selectedMale}
              accent="amber"
              autoApplied={maleAutoApplied}
              artStyleId={artStyleId}
              compact
            />
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
              onClick={() => void copySelected("male")}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 disabled:opacity-40"
            >
              复制锚点
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
                setJobFilter("");
                setPackFilterId("");
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
                setJobFilter("");
                setPackFilterId("");
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
            aria-label="搜索角色库"
            className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/25 disabled:opacity-45"
          />
          <button
            type="button"
            disabled={disabled || !filteredPool.length}
            onClick={pickRandomInTab}
            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/80 disabled:opacity-40"
          >
            随机换人
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setFavoritesOnly((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
              favoritesOnly
                ? "border-rose-300/45 bg-rose-500/15 text-rose-100"
                : "border-white/15 bg-white/5 text-white/70"
            }`}
          >
            只看收藏{favoritesInTab.length ? ` (${favoritesInTab.length})` : ""}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setUnselectedOnly((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
              unselectedOnly
                ? "border-sky-300/45 bg-sky-500/15 text-sky-100"
                : "border-white/15 bg-white/5 text-white/70"
            }`}
          >
            仅未选中
          </button>
          <button
            type="button"
            disabled={disabled || !favoriteIds.length}
            onClick={() => void exportFavorites()}
            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 disabled:opacity-40"
          >
            导出收藏
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void importFavorites()}
            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 disabled:opacity-40"
          >
            导入收藏
          </button>
          <button
            type="button"
            disabled={disabled || !favoriteIds.length}
            onClick={clearFavorites}
            className="rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5 text-[11px] text-white/45 disabled:opacity-40"
          >
            清空收藏
          </button>
          <div className="inline-flex rounded-lg border border-white/10 bg-black/40 p-0.5">
            {(
              [
                ["default", "默认"],
                ["name", "姓名"],
                ["age", "年龄"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => setSortMode(id)}
                className={`rounded-md px-2 py-1 text-[10px] ${
                  sortMode === id ? "bg-white/15 text-white" : "text-white/45"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDenseGrid((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
              denseGrid
                ? "border-white/30 bg-white/10 text-white"
                : "border-white/15 bg-white/5 text-white/70"
            }`}
          >
            {denseGrid ? "紧凑" : "宽松"}
          </button>
          <button
            type="button"
            disabled={disabled || !hasActiveFilters}
            onClick={clearLibraryFilters}
            className="rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5 text-[11px] text-white/45 disabled:opacity-40"
          >
            清空筛选
          </button>
          <button
            type="button"
            disabled={disabled || !filteredPool.length}
            onClick={() => void copyFilteredIds()}
            className="rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5 text-[11px] text-white/45 disabled:opacity-40"
          >
            复制筛选 id
          </button>
          <span className="text-[10px] text-white/35">
            {filteredPool.length}/{pool.length}
          </span>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPackFilterId("")}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              !packFilterId ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
            }`}
          >
            全部组合
          </button>
          {MANHUA_TEMPERAMENT_PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              title={p.tags.join(" · ")}
              onClick={() => {
                setPackFilterId((prev) => (prev === p.id ? "" : p.id));
                setTagFilter("");
              }}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                packFilterId === p.id
                  ? "border-violet-400/45 bg-violet-500/15 text-violet-100"
                  : "border-white/10 text-white/50 hover:border-white/25"
              }`}
            >
              {p.labelZh}
            </button>
          ))}
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
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(
            [
              ["", "全部年龄"],
              ["le25", "≤25"],
              ["26_28", "26–28"],
              ["ge29", "≥29"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id || "all-age"}
              type="button"
              disabled={disabled}
              onClick={() => setAgeBand(id)}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                ageBand === id
                  ? "border-sky-400/45 bg-sky-500/15 text-sky-100"
                  : "border-white/10 text-white/50 hover:border-white/25"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {jobOptions.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setJobFilter("")}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                !jobFilter ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/50"
              }`}
            >
              全部职业
            </button>
            {jobOptions.map((j) => (
              <button
                key={j}
                type="button"
                disabled={disabled}
                onClick={() => setJobFilter((prev) => (prev === j ? "" : j))}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  jobFilter === j
                    ? "border-amber-400/45 bg-amber-500/15 text-amber-100"
                    : "border-white/10 text-white/50 hover:border-white/25"
                }`}
              >
                {j}
              </button>
            ))}
          </div>
        ) : null}
        {similarInTab.length ? (
          <div className="mb-2">
            <div className="mb-1 text-[10px] text-white/40">同类气质（相对当前人选）</div>
            <div className="flex flex-wrap gap-1.5">
              {similarInTab.map((c) => (
                <button
                  key={`sim-${c.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => rememberSelect(c.id, libraryTab)}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55 hover:border-white/25 disabled:opacity-40"
                >
                  {c.nameZh}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {contrastPartners.length ? (
          <div className="mb-2">
            <div className="mb-1 text-[10px] text-white/40">
              反差配对（异性 · 气质少重叠）→ 点选即换{libraryTab === "female" ? "男主" : "女主"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {contrastPartners.map((c) => (
                <button
                  key={`contrast-${c.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => rememberSelect(c.id, c.gender)}
                  className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] text-fuchsia-100/85 hover:border-fuchsia-300/50 disabled:opacity-40"
                >
                  {c.nameZh}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {sameFieldPartners.length ? (
          <div className="mb-2">
            <div className="mb-1 text-[10px] text-white/40">
              同行异性（职业关键词相近）→ 点选即换{libraryTab === "female" ? "男主" : "女主"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sameFieldPartners.map((c) => (
                <button
                  key={`field-${c.id}`}
                  type="button"
                  disabled={disabled}
                  title={c.jobZh}
                  onClick={() => rememberSelect(c.id, c.gender)}
                  className="rounded-full border border-teal-400/30 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-100/85 hover:border-teal-300/50 disabled:opacity-40"
                >
                  {c.nameZh}
                  <span className="ml-1 text-teal-100/45">{c.jobZh}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {favoritesInTab.length ? (
          <div className="mb-2">
            <div className="mb-1 text-[10px] text-white/40">收藏</div>
            <div className="flex flex-wrap gap-1.5">
              {favoritesInTab.map((c) => (
                <button
                  key={`fav-${c.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => rememberSelect(c.id, libraryTab)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
                    selectedInTab === c.id
                      ? "border-rose-300/45 bg-rose-500/15 text-rose-100"
                      : "border-white/10 text-white/55 hover:border-white/25"
                  }`}
                >
                  ★ {c.nameZh}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {recentInTab.length ? (
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-white/40">最近选用</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setRecentIds(clearRecentIds())}
                className="text-[10px] text-white/40 underline-offset-2 hover:underline disabled:opacity-40"
              >
                清空最近
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentInTab.map((c) => (
                <button
                  key={`recent-${c.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => rememberSelect(c.id, libraryTab)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
                    selectedInTab === c.id
                      ? libraryTab === "female"
                        ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                        : "border-amber-400/45 bg-amber-500/15 text-amber-100"
                      : "border-white/10 text-white/55 hover:border-white/25"
                  }`}
                >
                  {c.nameZh}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/40">
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className="text-left text-white/50 underline-offset-2 hover:underline"
          >
            {showShortcuts ? "收起快捷键" : "快捷键 / 操作说明"}
          </button>
          <button
            type="button"
            disabled={disabled || !selectedInTab}
            onClick={() =>
              setCompareId((prev) => (prev && prev === selectedInTab ? "" : selectedInTab || ""))
            }
            className="text-white/60 underline-offset-2 hover:underline disabled:opacity-40"
          >
            {compareId === selectedInTab ? "取消对比钉" : "钉住当前对比"}
          </button>
        </div>
        {showShortcuts ? (
          <ul className="mb-2 list-inside list-disc space-y-0.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[10px] text-white/45">
            <li>悬停看三视图 · 右键钉住预览</li>
            <li>★ 收藏 · R 随机换人 · Shift+R 随机双人 · F 收藏 · C 钉对比 · ? 说明</li>
            <li>1–8 套用预设套组 · Esc 清筛选/对比 · ←/→ 换人</li>
            <li>三视图=设定卡裁切；换画风只改 prompt；「同版式」勿点运行</li>
          </ul>
        ) : null}
        {compareCharacter && selectedForCompare ? (
          <div className="mb-3 grid gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 p-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] font-semibold text-violet-100/80">
                对比钉 · {compareCharacter.nameZh}
              </div>
              <CharacterSheetPreview
                character={compareCharacter}
                accent={libraryTab === "female" ? "cyan" : "amber"}
                artStyleId={artStyleId}
                compact
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold text-white/70">
                当前选 · {selectedForCompare.nameZh}
              </div>
              <CharacterSheetPreview
                character={selectedForCompare}
                accent={libraryTab === "female" ? "cyan" : "amber"}
                artStyleId={artStyleId}
                compact
              />
            </div>
          </div>
        ) : compareId && compareId === selectedInTab ? (
          <p className="mb-2 text-[10px] text-violet-100/70">已钉住对比基准，用 ←/→ 换到另一人即可左右对照</p>
        ) : null}
        <div
          ref={gridRef}
          className={`grid max-h-[420px] overflow-y-auto pr-1 ${
            denseGrid
              ? "grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5"
              : "grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
          }`}
          role="listbox"
          aria-label={`${libraryTab === "female" ? "女主" : "男主"}角色库`}
        >
          {filteredPool.map((c) => (
            <LibraryCard
              key={c.id}
              character={c}
              selected={selectedInTab === c.id}
              favorited={favoriteSet.has(c.id)}
              accent={libraryTab === "female" ? "cyan" : "amber"}
              disabled={disabled}
              onSelect={() => rememberSelect(c.id, libraryTab)}
              onToggleFavorite={() => toggleFavorite(c.id)}
            />
          ))}
          {!filteredPool.length ? (
            <div className="col-span-full rounded-lg border border-dashed border-white/15 px-3 py-8 text-center text-[11px] text-white/40">
              {favoritesOnly
                ? "当前没有收藏角色，点卡片左上角 ★ 收藏后再筛"
                : "无匹配角色，试试清空搜索或气质筛选"}
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setLockArtStyle((v) => !v)}
            className={`rounded-md border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
              lockArtStyle
                ? "border-amber-400/45 bg-amber-500/15 text-amber-100"
                : "border-white/10 text-white/45 hover:border-white/25"
            }`}
          >
            {lockArtStyle ? "画风已锁定（套组不改）" : "锁定画风"}
          </button>
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

      <p className="mt-3 text-[10px] leading-snug text-white/35">
        验收口径：三视图=设定卡裁切（非三张独立渲染）；换画风只改 prompt，预览仍为 CG 底图；「同版式」勿点运行以免烧生图。
      </p>
    </div>
  );
}

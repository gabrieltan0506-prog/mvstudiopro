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
  parseManhuaFavoriteIds,
  serializeManhuaFavoriteIds,
  type ManhuaArtStyleId,
  type ManhuaCharacterGender,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";

const RECENT_LS_KEY = "mv-manhua-character-recent-v1";
const FAV_LS_KEY = "mv-manhua-character-fav-v1";
const CUSTOM_COUPLE_LS_KEY = "mv-manhua-character-custom-couples-v1";

type CustomCouple = {
  id: string;
  labelZh: string;
  femaleId: string;
  maleId: string;
  artStyleId?: ManhuaArtStyleId;
};

function loadCustomCouples(): CustomCouple[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COUPLE_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => x as Partial<CustomCouple>)
      .filter(
        (x) =>
          x &&
          typeof x.id === "string" &&
          typeof x.femaleId === "string" &&
          typeof x.maleId === "string" &&
          Boolean(getManhuaCharacterById(x.femaleId)) &&
          Boolean(getManhuaCharacterById(x.maleId)),
      )
      .map((x) => ({
        id: String(x.id),
        labelZh: String(x.labelZh || "我的套组").slice(0, 24),
        femaleId: String(x.femaleId),
        maleId: String(x.maleId),
        artStyleId: x.artStyleId,
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function saveCustomCouples(list: CustomCouple[]): CustomCouple[] {
  const next = list.slice(0, 8);
  try {
    localStorage.setItem(CUSTOM_COUPLE_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function matchesCharacterQuery(c: ManhuaCharacterTemplate, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [c.nameZh, c.jobZh, c.id, ...c.temperamentTags, c.promptZh].join(" ").toLowerCase();
  return hay.includes(needle);
}

function loadIdList(key: string, max: number): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, max) : [];
  } catch {
    return [];
  }
}

function loadRecentIds(): string[] {
  return loadIdList(RECENT_LS_KEY, 8);
}

function pushRecentId(id: string) {
  const key = String(id || "").trim();
  if (!key) return;
  const next = [key, ...loadRecentIds().filter((x) => x !== key)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function loadFavoriteIds(): string[] {
  return loadIdList(FAV_LS_KEY, 24);
}

function toggleFavoriteId(id: string): string[] {
  const key = String(id || "").trim();
  if (!key) return loadFavoriteIds();
  const cur = loadFavoriteIds();
  const next = cur.includes(key) ? cur.filter((x) => x !== key) : [key, ...cur].slice(0, 24);
  try {
    localStorage.setItem(FAV_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function saveFavoriteIds(ids: string[]): string[] {
  const next = ids.map(String).filter((id) => Boolean(getManhuaCharacterById(id))).slice(0, 24);
  try {
    localStorage.setItem(FAV_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

async function copyText(text: string): Promise<boolean> {
  const t = String(text || "").trim();
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
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
          <div className="truncate text-[12px] font-semibold text-white">{character.nameZh}</div>
          <div className="truncate text-[10px] text-white/45">{character.temperamentTags.slice(0, 3).join(" · ")}</div>
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
}: Props) {
  const [libraryTab, setLibraryTab] = useState<ManhuaCharacterGender>("female");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [packFilterId, setPackFilterId] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecentIds());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavoriteIds());
  const [customCouples, setCustomCouples] = useState<CustomCouple[]>(() => loadCustomCouples());
  const [copyFlash, setCopyFlash] = useState("");
  const libraryRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const packFilter = useMemo(() => getManhuaTemperamentPackById(packFilterId), [packFilterId]);
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
        if (favoritesOnly && !favoriteSet.has(c.id)) return false;
        if (!characterMatchesTemperamentPack(c, packFilter)) return false;
        if (tagFilter && !c.temperamentTags.includes(tagFilter)) return false;
        return matchesCharacterQuery(c, libraryQuery);
      }),
    [pool, libraryQuery, tagFilter, favoritesOnly, favoriteSet, packFilter],
  );
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
    if (opts?.artStyleId) onSelectArtStyle(opts.artStyleId);
    setCopyFlash(opts?.labelZh ? `已套用套组：${opts.labelZh}` : "已套用双人");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        pickRandomInTab();
        return;
      }
      if ((e.key === "f" || e.key === "F") && selectedInTab) {
        e.preventDefault();
        toggleFavorite(selectedInTab);
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
  }, [disabled, filteredPool, selectedInTab, libraryTab]);

  useEffect(() => {
    if (!selectedInTab || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-character-id="${selectedInTab}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedInTab, libraryTab, filteredPool.length]);

  const focusLibrary = (gender: ManhuaCharacterGender) => {
    setLibraryTab(gender);
    setLibraryQuery("");
    setTagFilter("");
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
              disabled={disabled || !femaleId || !maleId}
              onClick={saveCurrentAsCustomCouple}
              className="text-[10px] text-emerald-200/80 underline-offset-2 hover:underline disabled:opacity-40"
            >
              保存当前双人为套组
            </button>
            <span className="text-[10px] text-white/35">会同步画风 · 不烧 token</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MANHUA_COUPLE_PACKS.map((p) => {
            const active = femaleId === p.femaleId && maleId === p.maleId;
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                title={p.blurbZh}
                onClick={() => applyCouplePack(p.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-[10px] disabled:opacity-40 ${
                  active
                    ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-black/30 text-white/70 hover:border-white/25"
                }`}
              >
                <div className="font-semibold">{p.labelZh}</div>
                <div className="mt-0.5 text-white/40">{p.blurbZh}</div>
              </button>
            );
          })}
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
            <div className="mb-1 text-[10px] text-white/40">最近选用</div>
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
        <div className="mb-2 text-[10px] text-white/40">
          悬停预览三视图 · 右键钉住 · ★收藏 · 随机换人 / R · F 收藏当前 · ←/→ 换人
        </div>
        <div
          ref={gridRef}
          className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4"
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

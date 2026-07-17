/**
 * 漫剧工厂 · 角色库卡片墙 + 设定卡三视图预览
 * 设定卡图底部为 FRONT/SIDE/BACK；上方为人像与文案。
 */
import { useMemo, useState } from "react";
import {
  getManhuaCharacterById,
  getManhuaCharacterPreviewUrl,
  listManhuaCharactersByGender,
  type ManhuaCharacterGender,
  type ManhuaCharacterTemplate,
} from "@shared/manhuaCharacterAssetLibrary";

type Props = {
  femaleId: string;
  maleId: string;
  femaleAutoApplied?: boolean;
  maleAutoApplied?: boolean;
  disabled?: boolean;
  onSelectFemale: (id: string) => void;
  onSelectMale: (id: string) => void;
  onClearManual?: () => void;
  reasonZh?: string;
};

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
  const ring = accent === "cyan" ? "border-cyan-400/50" : "border-amber-400/50";
  const tag = accent === "cyan" ? "bg-cyan-500/15 text-cyan-100 border-cyan-400/35" : "bg-amber-500/15 text-amber-100 border-amber-400/35";

  return (
    <div className={`rounded-xl border ${ring} bg-black/40 overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-white">{character.nameZh}</h4>
            {autoApplied ? (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${tag}`}>已自动套用</span>
            ) : (
              <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/55">已选中</span>
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
        </div>
      </div>

      {url ? (
        <>
          {/* 人像区：取设定卡上半 */}
          <div className={`relative mt-2 mx-3 overflow-hidden rounded-lg border border-white/10 bg-black/50 ${compact ? "h-36" : "h-44"}`}>
            <img
              src={url}
              alt={`${character.nameZh} 人像`}
              className="absolute inset-0 h-[165%] w-full object-cover object-top"
              loading="lazy"
            />
          </div>
          {/* 三视图：取设定卡下半 FRONT / SIDE / BACK */}
          <div className="mx-3 mt-2 mb-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-white/45">
              <span>三视图 · 正 / 侧 / 背</span>
              <span className="text-white/30">来自设定卡</span>
            </div>
            <div className={`relative overflow-hidden rounded-lg border border-white/10 bg-black/60 ${compact ? "h-28" : "h-32"}`}>
              <img
                src={url}
                alt={`${character.nameZh} 三视图`}
                className="absolute inset-0 h-[240%] w-full object-cover object-bottom"
                loading="lazy"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-3 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 text-center text-[9px] font-semibold tracking-wide text-white/80">
                <span>正面</span>
                <span>侧面</span>
                <span>背面</span>
              </div>
            </div>
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
  const url = getManhuaCharacterPreviewUrl(character.id);
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
        className={`w-full overflow-hidden rounded-xl border bg-black/35 text-left transition disabled:opacity-45 ${border}`}
      >
        <div className="relative h-28 overflow-hidden bg-black/50">
          {url ? (
            <img
              src={url}
              alt={character.nameZh}
              className="absolute inset-0 h-[160%] w-full object-cover object-top"
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

      {hover && url ? (
        <div className="pointer-events-none absolute left-1/2 top-0 z-30 w-56 -translate-x-1/2 -translate-y-[92%] rounded-xl border border-white/20 bg-[#0c081c]/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-1 text-[10px] font-semibold text-white/70">悬停预览妆造 · 三视图</div>
          <div className="relative h-24 overflow-hidden rounded-lg border border-white/10">
            <img
              src={url}
              alt=""
              className="absolute inset-0 h-[240%] w-full object-cover object-bottom"
            />
            <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 bg-black/55 py-0.5 text-center text-[8px] text-white/85">
              <span>正</span>
              <span>侧</span>
              <span>背</span>
            </div>
          </div>
          <div className="mt-1 truncate text-[10px] text-white/55">{character.nameZh} · {character.jobZh}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function ManhuaCharacterGallery({
  femaleId,
  maleId,
  femaleAutoApplied,
  maleAutoApplied,
  disabled,
  onSelectFemale,
  onSelectMale,
  onClearManual,
  reasonZh,
}: Props) {
  const [libraryTab, setLibraryTab] = useState<ManhuaCharacterGender>("female");
  const females = useMemo(() => listManhuaCharactersByGender("female"), []);
  const males = useMemo(() => listManhuaCharactersByGender("male"), []);
  const selectedFemale = femaleId ? getManhuaCharacterById(femaleId) : null;
  const selectedMale = maleId ? getManhuaCharacterById(maleId) : null;
  const focus = libraryTab === "female" ? selectedFemale : selectedMale;
  const focusAuto = libraryTab === "female" ? femaleAutoApplied : maleAutoApplied;
  const focusAccent: "cyan" | "amber" = libraryTab === "female" ? "cyan" : "amber";
  const pool = libraryTab === "female" ? females : males;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-white/90">② 角色卡 · 库预览</div>
          <p className="mt-0.5 text-[10px] leading-snug text-white/45">
            怎么用：1) 题材自动套用 2) 悬停看三视图妆造 3) 点选更换（女主青 / 男主琥珀）4) 已选注入角色卡节点
          </p>
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
      {reasonZh ? (
        <p className="mt-2 text-[10px] leading-snug text-emerald-200/75">{reasonZh}</p>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          {focus ? (
            <CharacterSheetPreview
              character={focus}
              accent={focusAccent}
              autoApplied={focusAuto}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 px-3 py-10 text-center text-[11px] text-white/40">
              尚未选择{libraryTab === "female" ? "女主" : "男主"}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || !focus}
              onClick={() => {
                if (libraryTab === "female") onSelectFemale("");
                else onSelectMale("");
              }}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/75 disabled:opacity-40"
            >
              清除当前
            </button>
            <span className="self-center text-[10px] text-white/35">
              「同版式生成新人」稍后接入生图
            </span>
          </div>
        </div>

        <div>
          <div className="mb-2 inline-flex rounded-lg border border-white/10 bg-black/40 p-0.5">
            <button
              type="button"
              onClick={() => setLibraryTab("female")}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold ${
                libraryTab === "female" ? "bg-cyan-500/25 text-cyan-100" : "text-white/55"
              }`}
            >
              女主
            </button>
            <button
              type="button"
              onClick={() => setLibraryTab("male")}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold ${
                libraryTab === "male" ? "bg-amber-500/25 text-amber-100" : "text-white/55"
              }`}
            >
              男主
            </button>
          </div>
          <div className="text-[10px] text-white/40 mb-2">从角色库更换 · 悬停预览三视图</div>
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {pool.map((c) => (
              <LibraryCard
                key={c.id}
                character={c}
                selected={(libraryTab === "female" ? femaleId : maleId) === c.id}
                accent={libraryTab === "female" ? "cyan" : "amber"}
                disabled={disabled}
                onSelect={() => {
                  if (libraryTab === "female") onSelectFemale(c.id);
                  else onSelectMale(c.id);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 双人摘要：另一性别当前选择 */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 px-2.5 py-2 text-[11px] text-cyan-100/80">
          女主：{selectedFemale ? `${selectedFemale.nameZh} · ${selectedFemale.temperamentTags.slice(0, 2).join("·")}` : "未选"}
          {femaleAutoApplied ? " ·自动" : ""}
        </div>
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-100/80">
          男主：{selectedMale ? `${selectedMale.nameZh} · ${selectedMale.temperamentTags.slice(0, 2).join("·")}` : "未选"}
          {maleAutoApplied ? " ·自动" : ""}
        </div>
      </div>
    </div>
  );
}

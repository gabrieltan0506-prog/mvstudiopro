/**
 * 漫剧资产墙：复用人物库预览 + 场景模板（仅已落盘封面）+ 示范空镜/道具。
 * 未生成封面的模板不展示占位，避免「待生成」招挑刺。
 */
import { useMemo, useState } from "react";
import {
  getManhuaCharacterById,
  getManhuaCharacterDisplayName,
  getManhuaCharacterPreviewUrl,
  listManhuaCharactersByLifeStage,
} from "@shared/manhuaCharacterAssetLibrary";
import {
  MANHUA_SCENE_GENRE_LABEL_ZH,
  listManhuaScenes,
  type ManhuaSceneGenre,
  type ManhuaSceneTemplate,
} from "@shared/manhuaSceneAssetLibrary";
import {
  MANHUA_CONTENT_LANE_LABEL_ZH,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssets,
  listManhuaDemoAssetsForSceneTemplate,
  recommendManhuaContentLanesFromTopic,
} from "@shared/manhuaScenePropDemoCatalog";
import ManhuaScenePropDemoStrip from "@/components/ManhuaScenePropDemoStrip";

function CharChip({
  id,
  selected,
  artStyleId,
  onSelect,
}: {
  id: string;
  selected?: boolean;
  artStyleId?: string;
  onSelect?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const c = getManhuaCharacterById(id);
  const url = getManhuaCharacterPreviewUrl(id, { artStyleId: artStyleId || "photoreal" });
  const name = getManhuaCharacterDisplayName(id, { artStyleId: artStyleId || "photoreal" }) || id;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      className={`w-[4.25rem] shrink-0 overflow-hidden rounded-lg border text-left transition ${
        selected
          ? "border-cyan-400/70 bg-cyan-500/10"
          : "border-white/10 bg-black/35 hover:border-white/25"
      } disabled:cursor-default`}
      title={name}
    >
      <div className="relative h-14 bg-black/50">
        {url && !broken ? (
          <img
            src={url}
            alt=""
            className="absolute inset-0 h-full w-[180%] max-w-none object-cover object-[14%_18%]"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] text-white/35">无图</div>
        )}
      </div>
      <div className="truncate px-1 py-1 text-[10px] text-white/80">{name}</div>
      <div className="truncate px-1 pb-1 text-[9px] text-white/35">{c?.jobZh || "角色"}</div>
    </button>
  );
}

function SceneChip({
  scene,
  selected,
  genreMatch,
  demoUrl,
  onSelect,
}: {
  scene: ManhuaSceneTemplate;
  selected?: boolean;
  /** 当前剧种匹配：高亮但不隐藏 */
  genreMatch?: boolean;
  demoUrl?: string;
  onSelect: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-[5.5rem] shrink-0 overflow-hidden rounded-lg border text-left transition ${
        selected
          ? "border-emerald-400/70 bg-emerald-500/10"
          : genreMatch
            ? "border-amber-400/45 bg-amber-500/10 hover:border-amber-300/55"
            : "border-white/10 bg-black/35 hover:border-white/25"
      }`}
      title={scene.promptZh}
    >
      <div className="relative h-14 bg-black/50">
        {demoUrl && !broken ? (
          <img
            src={demoUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : null}
        {genreMatch && !selected ? (
          <span className="absolute left-0.5 top-0.5 rounded bg-amber-500/80 px-0.5 text-[8px] text-black/90">
            剧种
          </span>
        ) : null}
      </div>
      <div className="truncate px-1 py-1 text-[10px] font-medium text-white/85">{scene.nameZh}</div>
      <div className="truncate px-1 pb-1 text-[9px] text-white/35">
        {scene.genres.map((g) => MANHUA_SCENE_GENRE_LABEL_ZH[g]).join("/")}
      </div>
    </button>
  );
}

export default function ManhuaAssetWall({
  femaleId,
  maleId,
  sceneId,
  propIds,
  topic,
  genreId,
  artStyleId,
  disabled,
  onSelectScene,
  onSelectFemale,
  onSelectMale,
  onToggleProp,
}: {
  femaleId?: string;
  maleId?: string;
  sceneId?: string;
  propIds?: string[];
  topic?: string;
  genreId?: string;
  artStyleId?: string;
  disabled?: boolean;
  onSelectScene?: (sceneId: string) => void;
  onSelectFemale?: (id: string) => void;
  onSelectMale?: (id: string) => void;
  onToggleProp?: (propId: string) => void;
}) {
  const [tab, setTab] = useState<"leads" | "support" | "scenes">("scenes");
  const lanes = useMemo(() => recommendManhuaContentLanesFromTopic(topic), [topic]);

  const adultF = useMemo(() => listManhuaCharactersByLifeStage("adult").filter((c) => c.gender === "female").slice(0, 8), []);
  const adultM = useMemo(() => listManhuaCharactersByLifeStage("adult").filter((c) => c.gender === "male").slice(0, 8), []);
  const elders = useMemo(() => listManhuaCharactersByLifeStage("elder").slice(0, 8), []);
  const children = useMemo(() => listManhuaCharactersByLifeStage("child").slice(0, 8), []);

  const activeGenre = useMemo(() => {
    const g = String(genreId || "").trim() as ManhuaSceneGenre;
    return g && g in MANHUA_SCENE_GENRE_LABEL_ZH ? g : undefined;
  }, [genreId]);

  /** 仅展示已落盘封面的场景模板；未生成的不占位、不写「待生成」 */
  const demoByScene = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of listManhuaScenes()) {
      for (const d of listManhuaDemoAssetsForSceneTemplate(s.id)) {
        const url = getManhuaDemoAssetPublicUrl(d.id);
        if (url) {
          map.set(s.id, url);
          break;
        }
      }
    }
    return map;
  }, []);

  const scenes = useMemo(() => {
    const list = listManhuaScenes().filter((s) => demoByScene.has(s.id));
    return [...list].sort((a, b) => {
      const matchA = activeGenre ? a.genres.includes(activeGenre) : false;
      const matchB = activeGenre ? b.genres.includes(activeGenre) : false;
      if (matchA !== matchB) return matchA ? -1 : 1;
      return a.no - b.no;
    });
  }, [activeGenre, demoByScene]);

  const libraryTotal = listManhuaScenes().length;
  const shownCount = scenes.length;
  const catalogReadyCount = listManhuaDemoAssets().filter((a) => getManhuaDemoAssetPublicUrl(a.id)).length;
  const pinnedPropCount = propIds?.length ?? 0;

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-3 md:p-4 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white/90">资产墙</div>
          <p className="mt-0.5 text-[11px] leading-5 text-white/45">
            复用人物库设定卡 + 场景模板（仅显示已有封面）+ 示范空镜/道具。点场景写主场景；点道具可锁定外形锚点（最多
            4）。
          </p>
          <p className="mt-1 text-[10px] leading-4 text-white/35">
            示范封面为平台文生空镜，非剧照、非用户上传；成片请勿复用未授权 IP 造型。
          </p>
        </div>
        <div className="text-[10px] text-white/35">
          场景封面 {shownCount}/{libraryTotal} · 示范就绪 {catalogReadyCount} · 已点道具 {pinnedPropCount}
          {lanes.length
            ? ` · 题材赛道 ${lanes.map((l) => MANHUA_CONTENT_LANE_LABEL_ZH[l]).join("·")}`
            : ""}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {(
          [
            ["scenes", `场景库（${shownCount}）`],
            ["leads", "男女主预览"],
            ["support", "老人/儿童"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md border px-2 py-0.5 text-[10px] ${
              tab === id
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                : "border-white/10 text-white/50 hover:border-white/25"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "leads" ? (
        <div className="mt-3 space-y-2">
          <div>
            <div className="mb-1 text-[10px] text-white/40">女主（库图复用）</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {adultF.map((c) => (
                <CharChip
                  key={c.id}
                  id={c.id}
                  artStyleId={artStyleId}
                  selected={femaleId === c.id}
                  onSelect={onSelectFemale ? () => onSelectFemale(c.id) : undefined}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] text-white/40">男主（库图复用）</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {adultM.map((c) => (
                <CharChip
                  key={c.id}
                  id={c.id}
                  artStyleId={artStyleId}
                  selected={maleId === c.id}
                  onSelect={onSelectMale ? () => onSelectMale(c.id) : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "support" ? (
        <div className="mt-3 space-y-2">
          <div>
            <div className="mb-1 text-[10px] text-white/40">老人配角</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {elders.map((c) => (
                <CharChip
                  key={c.id}
                  id={c.id}
                  artStyleId="photoreal"
                  selected={femaleId === c.id || maleId === c.id}
                  onSelect={
                    c.gender === "female"
                      ? onSelectFemale
                        ? () => onSelectFemale(c.id)
                        : undefined
                      : onSelectMale
                        ? () => onSelectMale(c.id)
                        : undefined
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] text-white/40">剧用儿童</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {children.map((c) => (
                <CharChip
                  key={c.id}
                  id={c.id}
                  artStyleId="photoreal"
                  selected={femaleId === c.id || maleId === c.id}
                  onSelect={
                    c.gender === "female"
                      ? onSelectFemale
                        ? () => onSelectFemale(c.id)
                        : undefined
                      : onSelectMale
                        ? () => onSelectMale(c.id)
                        : undefined
                  }
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "scenes" ? (
        <div className="mt-3">
          <div className="mb-1 text-[10px] text-white/40">
            场景模板（仅已有封面 {shownCount}/{libraryTotal}）
            {activeGenre ? ` · 「${MANHUA_SCENE_GENRE_LABEL_ZH[activeGenre]}」匹配靠前` : ""}
            ；无封面不展示
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {scenes.length ? (
              scenes.map((s) => (
                <SceneChip
                  key={s.id}
                  scene={s}
                  selected={sceneId === s.id}
                  genreMatch={Boolean(activeGenre && s.genres.includes(activeGenre))}
                  demoUrl={demoByScene.get(s.id)}
                  onSelect={() => onSelectScene?.(s.id)}
                />
              ))
            ) : (
              <p className="text-[10px] text-white/35">暂无已落盘场景封面</p>
            )}
          </div>
          <ManhuaScenePropDemoStrip
            sceneTemplateId={sceneId}
            topic={topic}
            genreId={genreId}
            selectedPropIds={propIds}
            disabled={disabled}
            onApplySceneTemplate={onSelectScene}
            onToggleProp={onToggleProp}
          />
        </div>
      ) : null}
    </div>
  );
}

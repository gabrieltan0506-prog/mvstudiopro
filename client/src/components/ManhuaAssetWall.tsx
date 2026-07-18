/**
 * 漫剧资产墙：复用现成人物库预览 + 20 场景文案库 + 已落盘场景/道具示范图。
 * 点击场景写入工厂 sceneId；点击道具写入工厂 propIds（圣经/节拍/静帧锚点）。
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
  demoUrl,
  onSelect,
}: {
  scene: ManhuaSceneTemplate;
  selected?: boolean;
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
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[9px] leading-tight text-white/40">
            文案库
            <br />
            {String(scene.no).padStart(2, "0")}
          </div>
        )}
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

  const scenes = useMemo(() => {
    const genre = genreId as ManhuaSceneGenre | undefined;
    const list = listManhuaScenes(genre ? { genre } : undefined);
    // 有示范图的场景靠前
    return [...list].sort((a, b) => {
      const da = listManhuaDemoAssetsForSceneTemplate(a.id).some((x) => getManhuaDemoAssetPublicUrl(x.id));
      const db = listManhuaDemoAssetsForSceneTemplate(b.id).some((x) => getManhuaDemoAssetPublicUrl(x.id));
      if (da === db) return a.no - b.no;
      return da ? -1 : 1;
    });
  }, [genreId]);

  const demoByScene = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of scenes) {
      const demos = listManhuaDemoAssetsForSceneTemplate(s.id);
      for (const d of demos) {
        const url = getManhuaDemoAssetPublicUrl(d.id);
        if (url) {
          map.set(s.id, url);
          break;
        }
      }
    }
    // 无 sceneTemplateId 绑定的示范图：不挂到 01–20，留给下方 strip
    return map;
  }, [scenes]);

  const catalogCount = listManhuaDemoAssets().length;
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
            复用人物库设定卡 + 20 场景文案模板 + 示范空镜/道具（有图优先）。点场景写主场景；点道具可锁定外形锚点（最多 4）。
          </p>
        </div>
        <div className="text-[10px] text-white/35">
          目录 {catalogCount} · 已点道具 {pinnedPropCount} · 题材赛道{" "}
          {lanes.map((l) => MANHUA_CONTENT_LANE_LABEL_ZH[l]).join("·") || "—"}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {(
          [
            ["scenes", "场景库 01–20"],
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
            场景模板（有示范图靠前；无图仍可点选文案库）
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {scenes.map((s) => (
              <SceneChip
                key={s.id}
                scene={s}
                selected={sceneId === s.id}
                demoUrl={demoByScene.get(s.id)}
                onSelect={() => onSelectScene?.(s.id)}
              />
            ))}
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

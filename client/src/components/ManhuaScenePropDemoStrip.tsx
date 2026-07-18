/**
 * 场景/道具示范图轻量预览（有落盘才显示缩略图；无图仍可看文案锚点）。
 */
import { useMemo, useState } from "react";
import {
  MANHUA_CONTENT_LANE_LABEL_ZH,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssets,
  listManhuaDemoAssetsForSceneTemplate,
  listManhuaDemoPropsForLane,
  contentLanesForSceneGenre,
  recommendManhuaContentLanesFromTopic,
  type ManhuaContentLane,
  type ManhuaDemoAsset,
} from "@shared/manhuaScenePropDemoCatalog";
import type { ManhuaSceneGenre } from "@shared/manhuaSceneAssetLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";

function DemoThumb({
  asset,
  active,
  onClick,
}: {
  asset: ManhuaDemoAsset;
  active?: boolean;
  onClick?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const url = getManhuaDemoAssetPublicUrl(asset.id);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${asset.nameZh} · ${MANHUA_CONTENT_LANE_LABEL_ZH[asset.lane]}`}
      className={`w-[4.5rem] shrink-0 overflow-hidden rounded-lg border text-left transition ${
        active
          ? "border-emerald-400/70 bg-emerald-500/10"
          : "border-white/10 bg-black/35 hover:border-white/25"
      }`}
    >
      <div className="relative h-14 bg-black/50">
        {url && !broken ? (
          <img
            src={url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[9px] leading-tight text-white/35">
            {asset.kind === "scene" ? "场景" : "道具"}
            <br />
            待生成
          </div>
        )}
      </div>
      <div className="px-1 py-1">
        <div className="truncate text-[10px] font-medium text-white/85">{asset.nameZh}</div>
        <div className="truncate text-[9px] text-white/40">
          {MANHUA_CONTENT_LANE_LABEL_ZH[asset.lane]}
        </div>
      </div>
    </button>
  );
}

export default function ManhuaScenePropDemoStrip({
  sceneTemplateId,
  topic,
  genreId,
  selectedPropIds,
  disabled,
  onApplySceneTemplate,
  onToggleProp,
}: {
  sceneTemplateId?: string;
  topic?: string;
  genreId?: string;
  selectedPropIds?: string[];
  disabled?: boolean;
  /** 点示范空镜且绑定了 scene_XX 时，写入工厂主场景 */
  onApplySceneTemplate?: (sceneTemplateId: string) => void;
  /** 点道具：写入/取消工厂点选锚点 */
  onToggleProp?: (propId: string) => void;
}) {
  const [laneFilter, setLaneFilter] = useState<ManhuaContentLane | "">("");
  const [focusId, setFocusId] = useState<string>("");
  const selectedProps = selectedPropIds || [];

  const recommendedLanes = useMemo(() => {
    const fromTopic = recommendManhuaContentLanesFromTopic(topic);
    const scene = getManhuaSceneTemplate(sceneTemplateId);
    const genre = (genreId || scene?.genres[0]) as ManhuaSceneGenre | undefined;
    const fromGenre = contentLanesForSceneGenre(genre);
    // 题材命中优先，再用剧种补齐
    const merged: ManhuaContentLane[] = [];
    for (const lane of [...fromTopic, ...fromGenre]) {
      if (!merged.includes(lane)) merged.push(lane);
    }
    return merged.slice(0, 4);
  }, [topic, sceneTemplateId, genreId]);

  const sceneDemos = useMemo(() => {
    const linked = listManhuaDemoAssetsForSceneTemplate(sceneTemplateId);
    if (linked.length) return linked.slice(0, 4);
    const lanes = laneFilter ? [laneFilter] : recommendedLanes.slice(0, 3);
    return listManhuaDemoAssets({ kind: "scene", lane: lanes }).slice(0, 4);
  }, [sceneTemplateId, laneFilter, recommendedLanes]);

  const propDemos = useMemo(() => {
    const lanes = (laneFilter ? [laneFilter] : recommendedLanes).slice(0, 3);
    const out: ManhuaDemoAsset[] = [];
    for (const lane of lanes) {
      for (const p of listManhuaDemoPropsForLane(lane)) {
        if (out.length >= 6) break;
        if (!out.some((x) => x.id === p.id)) out.push(p);
      }
      if (out.length >= 6) break;
    }
    return out;
  }, [laneFilter, recommendedLanes]);

  const focus = useMemo(
    () => listManhuaDemoAssets().find((a) => a.id === focusId) || null,
    [focusId],
  );

  const chipLanes: ManhuaContentLane[] = [
    "ancient",
    "xianxia",
    "xuanhuan",
    "revenge",
    "romance",
    "intrigue",
    "business",
  ];

  return (
    <div
      className={`mt-3 rounded-xl border border-white/8 bg-black/25 p-2.5 ${
        disabled ? "pointer-events-none opacity-45" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] font-medium text-white/70">场景 / 道具示范库</div>
        <div className="text-[10px] text-white/35">有图可预览 · 无图显示待生成</div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setLaneFilter("")}
          className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
            !laneFilter
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
              : "border-white/10 text-white/50 hover:border-white/25"
          }`}
        >
          跟题材
        </button>
        {chipLanes.map((lane) => (
          <button
            key={lane}
            type="button"
            onClick={() => setLaneFilter(lane)}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
              laneFilter === lane
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                : "border-white/10 text-white/50 hover:border-white/25"
            }`}
          >
            {MANHUA_CONTENT_LANE_LABEL_ZH[lane]}
          </button>
        ))}
      </div>

      {sceneDemos.length ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] text-white/40">场景空镜</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {sceneDemos.map((a) => (
              <DemoThumb
                key={a.id}
                asset={a}
                active={focusId === a.id}
                onClick={() => {
                  setFocusId(a.id === focusId ? "" : a.id);
                  if (a.sceneTemplateId && onApplySceneTemplate) {
                    onApplySceneTemplate(a.sceneTemplateId);
                  }
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {propDemos.length ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] text-white/40">道具特写</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {propDemos.map((a) => (
              <DemoThumb
                key={a.id}
                asset={a}
                active={focusId === a.id || selectedProps.includes(a.id)}
                onClick={() => {
                  setFocusId(a.id === focusId ? "" : a.id);
                  onToggleProp?.(a.id);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {focus ? (
        <div className="mt-2 flex items-start gap-2">
          <p className="min-w-0 flex-1 line-clamp-3 text-[10px] leading-snug text-white/55">
            {focus.nameZh}：{focus.promptZh}
            {focus.overseasHintZh ? ` · ${focus.overseasHintZh}` : ""}
            {focus.kind === "prop" && selectedProps.includes(focus.id) ? " · 已写入工厂" : ""}
          </p>
          <button
            type="button"
            className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10"
            onClick={() => {
              const text = [
                focus.nameZh,
                MANHUA_CONTENT_LANE_LABEL_ZH[focus.lane],
                focus.promptZh,
                focus.overseasHintZh || "",
              ]
                .filter(Boolean)
                .join("\n");
              void navigator.clipboard?.writeText(text);
            }}
          >
            复制锚点
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-white/35">
          点空镜写主场景（绑定 scene_XX 时）；点道具锁定外形锚点（再点取消）。权谋 / 商战偏海外可读符号。
        </p>
      )}
    </div>
  );
}

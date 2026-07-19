/**
 * 造型区缩略条：角色 / 古风原型 / 场景道具芯片
 */
import { getManhuaCharacterById, getManhuaCharacterPreviewUrl } from "@shared/manhuaCharacterAssetLibrary";
import {
  getAncientArchetypeById,
  getAncientArchetypePreviewUrl,
} from "@shared/manhuaAncientArchetypeLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";
import { getManhuaDemoAsset } from "@shared/manhuaScenePropDemoCatalog";

type Props = {
  characterIds: string[];
  ancientArchetypeIds: string[];
  sceneId?: string;
  propIds: string[];
  writerConfirmed: boolean;
  artStyleLabelZh?: string;
  onOpenCharacters: () => void;
  onOpenAssets: () => void;
};

export default function ManhuaCastStrip({
  characterIds,
  ancientArchetypeIds,
  sceneId,
  propIds,
  writerConfirmed,
  artStyleLabelZh,
  onOpenCharacters,
  onOpenAssets,
}: Props) {
  const hasPeople = characterIds.length > 0 || ancientArchetypeIds.length > 0;
  const scene = sceneId ? getManhuaSceneTemplate(sceneId) : null;

  return (
    <div
      id="manhua-cast-zone"
      className="mt-4 max-w-6xl scroll-mt-44 rounded-2xl border border-cyan-400/12 bg-gradient-to-r from-[#0c1520]/90 to-[#0a0e18]/60 px-3 py-3 md:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/88">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400/90 text-[11px] font-bold text-black">
              3–4
            </span>
            造型 · 角色卡
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {writerConfirmed
              ? `已按剧本套造型 · 角色 ${characterIds.length || "—"} · 古风原型 ${ancientArchetypeIds.length || "—"} · ${artStyleLabelZh || "画风"}`
              : "确认编剧后自动套角色/服装/道具；可点角色库微调面孔"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onOpenCharacters}
            className="rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 hover:bg-cyan-500/25"
          >
            打开角色库
          </button>
          <button
            type="button"
            onClick={onOpenAssets}
            className="rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.08]"
          >
            打开资产墙
          </button>
        </div>
      </div>

      {hasPeople ? (
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5">
          {characterIds.map((id) => {
            const c = getManhuaCharacterById(id);
            if (!c) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={onOpenCharacters}
                className="w-[72px] shrink-0 overflow-hidden rounded-xl border border-white/12 bg-black/40 text-left hover:border-cyan-400/40"
                title={c.nameZh}
              >
                <img
                  src={getManhuaCharacterPreviewUrl(id)}
                  alt=""
                  className="aspect-[3/4] w-full object-cover object-top"
                  loading="lazy"
                />
                <div className="truncate px-1 py-0.5 text-[9px] text-white/70">{c.nameZh}</div>
              </button>
            );
          })}
          {ancientArchetypeIds.map((id) => {
            const a = getAncientArchetypeById(id);
            if (!a) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={onOpenCharacters}
                className="w-[72px] shrink-0 overflow-hidden rounded-xl border border-amber-400/25 bg-amber-500/10 text-left hover:border-amber-400/45"
                title={a.nameZh}
              >
                <img
                  src={getAncientArchetypePreviewUrl(id)}
                  alt=""
                  className="aspect-[3/4] w-full object-cover object-top"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="truncate px-1 py-0.5 text-[9px] text-amber-50/85">古风·{a.nameZh}</div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-white/35">
          {writerConfirmed
            ? "造型尚未露出缩略图时，点「打开角色库」微调。"
            : "确认编剧后，此处会出现已套角色缩略图。"}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {scene ? (
          <button
            type="button"
            onClick={onOpenAssets}
            className="rounded-md border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/65 hover:border-cyan-400/35"
          >
            场景 · {scene.nameZh}
          </button>
        ) : null}
        {propIds.slice(0, 4).map((pid) => {
          const p = getManhuaDemoAsset(pid);
          return (
            <button
              key={pid}
              type="button"
              onClick={onOpenAssets}
              className="rounded-md border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60 hover:border-cyan-400/35"
            >
              道具 · {p?.nameZh || pid}
            </button>
          );
        })}
      </div>
    </div>
  );
}

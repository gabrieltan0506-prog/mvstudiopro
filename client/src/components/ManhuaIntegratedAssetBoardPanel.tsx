/**
 * 一体参考板：角色 × 场景 × 道具快览（对标设定集布局，不生成真实拼图文件）。
 */
import { Layers } from "lucide-react";
import type { ManhuaIntegratedAssetBoard } from "@shared/manhuaIntegratedAssetBoard";

type Props = {
  board: ManhuaIntegratedAssetBoard;
  compact?: boolean;
  onCopyInjectSummary?: (text: string) => void;
};

export default function ManhuaIntegratedAssetBoardPanel({
  board,
  compact,
  onCopyInjectSummary,
}: Props) {
  return (
    <section
      data-manhua-panel="integrated-asset-board"
      className={`rounded-lg border border-amber-400/25 bg-gradient-to-b from-amber-500/[0.07] to-black/40 ${
        compact ? "p-2" : "p-2.5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 shrink-0 text-amber-200/90" />
          <span className="truncate text-[11px] font-semibold text-amber-50/90">
            {board.titleZh}
          </span>
        </div>
        {onCopyInjectSummary ? (
          <button
            type="button"
            onClick={() => onCopyInjectSummary(board.injectSummaryZh)}
            className="shrink-0 text-[9px] text-amber-100/70 underline-offset-2 hover:underline"
          >
            复制注入摘要
          </button>
        ) : null}
      </div>

      <div className={`mt-2 grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-[1.1fr_1fr]"}`}>
        <div className="overflow-hidden rounded-md border border-white/10 bg-black/50">
          {board.hero.imageUrl ? (
            <img
              src={board.hero.imageUrl}
              alt=""
              className="aspect-[3/4] w-full object-cover object-top"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center text-[10px] text-white/35">
              选角色后显示主图
            </div>
          )}
          <div className="border-t border-white/8 px-2 py-1.5">
            <div className="text-[11px] font-semibold text-white/90">{board.hero.titleZh}</div>
            <div className="text-[9px] text-white/45">
              {board.hero.subtitleZh || "叠场景同框自洽"}
              {board.hero.bodyZh ? ` · ${board.hero.bodyZh}` : ""}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div>
            <div className="text-[9px] font-semibold tracking-wide text-white/40">三视图提示</div>
            <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-white/55">
              {board.turnaroundHints.map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          </div>

          {board.scene ? (
            <div className="rounded-md border border-white/8 bg-black/35 px-2 py-1.5">
              <div className="text-[9px] font-semibold text-cyan-100/80">场景</div>
              <div className="mt-0.5 text-[10px] text-white/80">{board.scene.nameZh}</div>
              <div className="mt-0.5 line-clamp-2 text-[9px] text-white/45">
                {board.scene.coreElements.join(" · ")}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/12 px-2 py-1.5 text-[9px] text-white/35">
              未选场景 · 资产阶段补齐后出现
            </div>
          )}

          {board.props.length ? (
            <div>
              <div className="text-[9px] font-semibold tracking-wide text-white/40">
                道具 / 服装锚
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {board.props.slice(0, 6).map((p) => (
                  <div
                    key={p.id}
                    className="overflow-hidden rounded border border-white/10 bg-black/40"
                    title={p.nameZh}
                  >
                    {p.previewUrl ? (
                      <img
                        src={p.previewUrl}
                        alt=""
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center px-0.5 text-center text-[8px] text-white/40">
                        {p.nameZh.slice(0, 6)}
                      </div>
                    )}
                    <div className="truncate px-0.5 py-0.5 text-[8px] text-white/55">{p.nameZh}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {board.keywordsZh.length ? (
            <div className="flex flex-wrap gap-1">
              {board.keywordsZh.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[8px] text-white/50"
                >
                  {k}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {board.characters.length > 1 ? (
        <div className="mt-2 flex gap-1 overflow-x-auto">
          {board.characters.map((c) => (
            <div
              key={c.id}
              className="w-12 shrink-0 overflow-hidden rounded border border-white/10 bg-black/40"
            >
              {c.previewUrl ? (
                <img src={c.previewUrl} alt="" className="aspect-square w-full object-cover object-top" />
              ) : (
                <div className="aspect-square bg-white/5" />
              )}
              <div className="truncate px-0.5 py-0.5 text-[8px] text-white/60">{c.nameZh}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

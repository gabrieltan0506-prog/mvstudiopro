import type {
  ManhuaViralTemplateCard,
  ManhuaViralTemplateChangeReason,
  ManhuaViralTemplateOptimizeField,
  ManhuaViralTemplateOptimizeModel,
} from "@shared/manhuaViralTemplateBank";
import { formatManhuaTemplateNativeBeatZh } from "@/lib/manhuaTemplateNativeBeat";
import { X } from "lucide-react";
import {
  changedManhuaTemplateBeatIndexes,
  isManhuaTemplateFieldChanged,
} from "@/lib/manhuaTemplateOwnerDiff";

type ModelOption = {
  id: ManhuaViralTemplateOptimizeModel;
  labelZh: string;
  reasoningEffort: "medium" | "high" | "max";
};

type OptimizeResult = {
  original: ManhuaViralTemplateCard;
  proposal: ManhuaViralTemplateCard;
  changedFields: ManhuaViralTemplateOptimizeField[];
  reasons: ManhuaViralTemplateChangeReason[];
};

const FIELD_LABELS: Record<ManhuaViralTemplateOptimizeField, string> = {
  nameZh: "模板名称",
  laneZh: "赛道分类",
  classification: "多维特征",
  storyStructure: "故事骨架",
  summaryZh: "用途摘要",
  hook3sZh: "前三秒钩子",
  beatGrid: "节拍格",
  reusableZh: "可复用手法",
  genPromptHintZh: "生成要素",
  scenePoolHints: "场景池",
  castShape: "人物关系",
  densityHints: "内容密度",
};

function valueClass(changed: boolean): string {
  return changed
    ? "border-amber-300/35 bg-amber-400/10 text-amber-100"
    : "border-white/10 bg-black/20 text-white/70";
}

function TextValue({ value, changed }: { value: string; changed: boolean }) {
  return (
    <div className={`whitespace-pre-line rounded-lg border px-2.5 py-2 leading-5 ${valueClass(changed)}`}>
      {value || "—"}
    </div>
  );
}

function TemplateColumn({
  card,
  original,
  optimized,
}: {
  card: ManhuaViralTemplateCard;
  original?: ManhuaViralTemplateCard;
  optimized: boolean;
}) {
  const changed = (field: ManhuaViralTemplateOptimizeField) =>
    Boolean(optimized && original && isManhuaTemplateFieldChanged(original, card, field));
  const changedBeatIndexes = original
    ? new Set(changedManhuaTemplateBeatIndexes(original, card))
    : new Set<number>();
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[10px] text-white/40">模板名称</div>
        <TextValue value={card.nameZh} changed={changed("nameZh")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">赛道分类</div>
        <TextValue value={card.laneZh} changed={changed("laneZh")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">多维特征</div>
        <TextValue
          value={card.classification
            ? Object.values(card.classification).flat().join("、")
            : ""}
          changed={changed("classification")}
        />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">故事骨架</div>
        <TextValue
          value={card.storyStructure
            ? [
                `核心承诺：${card.storyStructure.corePromiseZh}`,
                `冲突引擎：${card.storyStructure.conflictEngineZh}`,
                `关系引擎：${card.storyStructure.relationshipEngineZh}`,
                `推进规律：${card.storyStructure.episodeProgressionZh.join("；")}`,
                `变化规则：${card.storyStructure.variationRulesZh.join("；")}`,
              ].join("\n")
            : ""}
          changed={changed("storyStructure")}
        />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">用途摘要</div>
        <TextValue value={card.summaryZh} changed={changed("summaryZh")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">前三秒钩子</div>
        <TextValue value={card.hook3sZh} changed={changed("hook3sZh")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">可复用手法</div>
        <TextValue value={card.reusableZh || ""} changed={changed("reusableZh")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">生成要素</div>
        <TextValue value={card.genPromptHintZh || ""} changed={changed("genPromptHintZh")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">节拍格</div>
        <div className="space-y-1.5">
          {card.beatGrid.map((beat, index) => {
            const beatChanged = optimized && changedBeatIndexes.has(index);
            return (
              <div
                key={`${beat.atSec}-${index}`}
                className={`rounded-lg border px-2.5 py-2 ${valueClass(beatChanged)}`}
              >
                <div className="font-semibold">{beat.atSec}s · {beat.conflictZh}</div>
                <div className="mt-0.5 opacity-80">{beat.visualZh}</div>
                {formatManhuaTemplateNativeBeatZh(beat) ? (
                  <div className="mt-1 text-[10px] leading-relaxed opacity-60">
                    {formatManhuaTemplateNativeBeatZh(beat)}
                  </div>
                ) : null}
              </div>
            );
          })}
          {optimized && original && original.beatGrid.length > card.beatGrid.length
            ? original.beatGrid.slice(card.beatGrid.length).map((beat, offset) => (
                <div
                  key={`removed-${card.beatGrid.length + offset}`}
                  className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-2.5 py-2 text-rose-100"
                >
                  已删除原第 {card.beatGrid.length + offset + 1} 拍：{beat.atSec}s · {beat.conflictZh}
                </div>
              ))
            : null}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">场景池</div>
        <TextValue value={card.scenePoolHints.join("、")} changed={changed("scenePoolHints")} />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">人物关系</div>
        <TextValue
          value={[
            `欲望：${card.castShape.leadDesireZh}`,
            `压力：${card.castShape.pressureZh}`,
            card.castShape.foilZh ? `对照：${card.castShape.foilZh}` : "",
          ].filter(Boolean).join("\n")}
          changed={changed("castShape")}
        />
      </div>
      <div>
        <div className="mb-1 text-[10px] text-white/40">内容密度</div>
        <TextValue
          value={`正文≥${card.densityHints.minBodyChars}字 · 对白≥${card.densityHints.minDialogueLines}句 · 场景≥${card.densityHints.minLocationHits}`}
          changed={changed("densityHints")}
        />
      </div>
    </div>
  );
}

export function ManhuaApprovedTemplateOwnerDrawer(props: {
  open: boolean;
  detail: ManhuaViralTemplateCard | null;
  detailLoading: boolean;
  models: ModelOption[];
  selectedModel: ManhuaViralTemplateOptimizeModel;
  promptZh: string;
  optimizePending: boolean;
  result: OptimizeResult | null;
  onClose: () => void;
  onModelChange: (model: ManhuaViralTemplateOptimizeModel) => void;
  onPromptChange: (value: string) => void;
  onOptimize: () => void;
}) {
  if (!props.open) return null;
  const original = props.result?.original || props.detail;
  const optimized = props.result?.proposal || null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" onMouseDown={props.onClose}>
      <aside
        aria-label="已批准模板详情与优化"
        className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col border-l border-emerald-300/20 bg-[#0b1010] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-emerald-50">已批准模板详情与优化</div>
            <p className="mt-1 text-[11px] text-white/45">
              完整模板仅站点拥有者可见。优化先生成待审修订，不会直接覆盖正式模板。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭模板详情"
            onClick={props.onClose}
            className="rounded-lg border border-white/10 p-2 text-white/55 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-white/10 px-5 py-4">
          <div className="grid gap-3 md:grid-cols-[260px_1fr_auto] md:items-end">
            <label className="block">
              <span className="text-[10px] font-semibold text-emerald-100/70">优化模型</span>
              <select
                value={props.selectedModel}
                onChange={(event) =>
                  props.onModelChange(event.target.value as ManhuaViralTemplateOptimizeModel)
                }
                className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-black/45 px-3 py-2 text-xs text-white outline-none"
              >
                {props.models.map((model) => (
                  <option key={model.id} value={model.id}>{model.labelZh}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-emerald-100/70">你的优化提示词</span>
              <textarea
                value={props.promptZh}
                onChange={(event) => props.onPromptChange(event.target.value)}
                rows={3}
                maxLength={2_000}
                placeholder="例如：加强前三秒穿越钩子，保留原节奏骨架，并让人物动机更明确。"
                className="mt-1 w-full resize-y rounded-lg border border-emerald-300/20 bg-black/45 px-3 py-2 text-xs leading-5 text-white placeholder:text-white/25 outline-none"
              />
            </label>
            <button
              type="button"
              disabled={props.optimizePending || props.promptZh.trim().length < 2 || !props.detail}
              onClick={props.onOptimize}
              className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-4 py-2.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {props.optimizePending ? "正在生成待审修订…" : "按提示词优化"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-amber-100/55">
            点击会产生一次真实模型调用；失败不会写入模板库，也不会自动重试。
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {props.detailLoading || !original ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-xs text-white/45">
              正在读取正式模板…
            </div>
          ) : optimized ? (
            <>
              <div className="mb-4 grid gap-3 rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3 md:grid-cols-2">
                <div>
                  <div className="text-[10px] font-semibold text-white/45">原正式模板</div>
                  <div className="mt-1 text-xs text-white/75">{original.nameZh}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-amber-100/70">待审优化稿</div>
                  <div className="mt-1 text-xs text-amber-100">黄色文字表示与原模板不同</div>
                </div>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <TemplateColumn card={original} optimized={false} />
                <TemplateColumn card={optimized} original={original} optimized />
              </div>
              <div className="mt-6 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.06] p-4">
                <div className="text-xs font-semibold text-cyan-50">优化原因</div>
                <div className="mt-2 space-y-2">
                  {(props.result?.reasons || []).map((reason) => (
                    <div key={reason.field} className="rounded-lg border border-cyan-200/15 bg-black/20 px-3 py-2 text-[11px] leading-5 text-cyan-50/80">
                      <span className="font-semibold text-cyan-100">{FIELD_LABELS[reason.field]}：</span>
                      {reason.reasonZh}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-cyan-50/50">
                  修订已进入待批准列表；批准后才会替换正式模板，原版会先归档。
                </p>
              </div>
            </>
          ) : (
            <TemplateColumn card={original} optimized={false} />
          )}
        </div>
      </aside>
    </div>
  );
}

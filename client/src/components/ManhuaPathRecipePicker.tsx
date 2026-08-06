/**
 * 运镜配方选择器：路径配方 + 动作配方（预设文本，无手绘）。
 * 手动划线画板已废除——描述式配方由大模型解读，不再靠用户手绘轨迹。
 */
import { useMemo } from "react";
import {
  listPathCameraRecipes,
  type ManhuaPathCameraRecipe,
} from "@shared/manhuaPathCameraRecipeBank";
import {
  listActionCameraRecipes,
  type ManhuaActionCameraRecipe,
} from "@shared/manhuaActionCameraRecipeBank";

type Props = {
  pathRecipeId?: string;
  actionRecipeId?: string;
  onPathRecipeIdChange?: (id: string) => void;
  onActionRecipeIdChange?: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
};

export default function ManhuaPathRecipePicker({
  pathRecipeId,
  actionRecipeId,
  onPathRecipeIdChange,
  onActionRecipeIdChange,
  disabled,
  compact = false,
}: Props) {
  const recipes = useMemo(() => listPathCameraRecipes(), []);
  const actionRecipes = useMemo(() => listActionCameraRecipes(), []);

  return (
    <div
      data-manhua-path-recipe-picker={compact ? "compact" : "full"}
      className={`space-y-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/[0.06] ${
        compact ? "p-2" : "p-2.5"
      }`}
    >
      <label className="text-[11px] font-medium text-cyan-100/90">运镜配方（预设，可留空）</label>
      <div className="flex flex-wrap gap-1.5">
        <select
          value={pathRecipeId || ""}
          disabled={disabled}
          onChange={(e) => onPathRecipeIdChange?.(e.target.value)}
          className="max-w-[10.5rem] rounded-md border border-cyan-400/30 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
        >
          <option value="">路径配方</option>
          {recipes.map((r: ManhuaPathCameraRecipe) => (
            <option key={r.id} value={r.id}>
              {String(r.no).padStart(2, "0")} {r.nameZh}
            </option>
          ))}
        </select>
        <select
          value={actionRecipeId || ""}
          disabled={disabled}
          onChange={(e) => onActionRecipeIdChange?.(e.target.value)}
          className="max-w-[10.5rem] rounded-md border border-rose-400/35 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
        >
          <option value="">动作配方</option>
          {actionRecipes.map((r: ManhuaActionCameraRecipe) => (
            <option key={r.id} value={r.id}>
              {String(r.no).padStart(2, "0")} {r.nameZh}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[10px] leading-snug text-white/45">
        描述式配方直接进导戏单，由模型解读运镜与动作；不选则按剧本时间轴推进。
      </p>
    </div>
  );
}

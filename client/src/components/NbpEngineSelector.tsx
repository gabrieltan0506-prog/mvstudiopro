/**
 * NBP 引擎选择器组件
 * 
 * 用于分镜页面和虚拟偶像页面，让用户选择图片生成引擎：
 * - Forge AI（免费，含水印）
 * - NBP 2K（5 Credits/张，Pro+ 可用）
 * - NBP 4K（9 Credits/张，Enterprise 可用）
 */
import { Sparkles, MonitorPlay, Tv2, Lock, Star, CheckCircle } from "lucide-react";

export type EngineOption = "forge" | "nbp_2k" | "nbp_4k";

interface EngineInfo {
  id: EngineOption;
  label: string;
  desc: string;
  cost: string;
  icon: React.ElementType;
  color: string;
  available: boolean;
  reason?: string;
}

export interface NbpEngineSelectorProps {
  selected?: any;
  onSelect?: any;
  plan?: string;
  creditsAvailable?: number;
  selectedValue?: any;
  onValueChange?: any;
  userPlan?: string;
  feature?: string;
  [key: string]: any;
}

export function NbpEngineSelector({
  selected,
  onSelect,
  plan,
  creditsAvailable,
  compact = false,
  isAdmin = false,
}: NbpEngineSelectorProps) {
  // 管理员拥有所有引擎的完整权限
  const effectivePlan = isAdmin ? "enterprise" : plan;
  const effectiveCredits = isAdmin ? 99999 : creditsAvailable;
  const engines: EngineInfo[] = [
    {
      id: "forge",
      label: "Forge AI",
      desc: "免费生成，含水印",
      cost: "免费",
      icon: Sparkles,
      color: "#30D158",
      available: true,
    },
    {
      id: "nbp_2k",
      label: "NBP 2K",
      desc: "高清 2K，" + (isAdmin ? "管理员免费" : effectivePlan === "free" ? "需升级" : effectivePlan === "pro" ? "含水印" : "无水印"),
      cost: isAdmin ? "免费" : "5 Cr/张",
      icon: MonitorPlay,
      color: "#64D2FF",
      available: isAdmin || (effectivePlan !== "free" && (effectiveCredits ?? 0) >= 5),
      reason:
        effectivePlan === "free"
          ? "升级到 Pro 方案即可使用"
          : (effectiveCredits ?? 0) < 5
          ? "Credits 不足，请充值"
          : undefined,
    },
    {
      id: "nbp_4k",
      label: "NBP 4K",
      desc: "超高清 4K，" + (isAdmin ? "管理员免费" : effectivePlan === "enterprise" ? "无水印" : "需升级"),
      cost: isAdmin ? "免费" : "9 Cr/张",
      icon: Tv2,
      color: "#FFD60A",
      available: isAdmin || (effectivePlan === "enterprise" && (effectiveCredits ?? 0) >= 9),
      reason:
        effectivePlan !== "enterprise"
          ? "升级到 Enterprise 方案即可使用"
          : (effectiveCredits ?? 0) < 9
          ? "Credits 不足，请充值"
          : undefined,
    },
  ];

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-[#9BA1A6]">图片引擎</span>
        <div className="flex gap-2">
          {engines.map((eng) => {
            const isSelected = selected === eng.id;
            const disabled = !eng.available;
            return (
              <button
                key={eng.id}
                onClick={() => !disabled && onSelect(eng.id)}
                disabled={disabled}
                style={isSelected ? { backgroundColor: eng.color + "30", borderColor: eng.color } : {}}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#2C2C2E] bg-[#1C1C1E] disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <span
                  style={isSelected ? { color: eng.color } : {}}
                  className={`text-xs font-medium text-[#9BA1A6] ${isSelected && 'font-bold'} disabled:text-[#555]`}
                >
                  {eng.label}
                </span>
                {isSelected && (
                  <span style={{ color: eng.color }} className="text-[11px] font-semibold">{eng.cost}</span>
                )}
                {disabled && (
                  <Lock size={10} className="text-[#555] ml-0.5" />
                )}
              </button>
            );
          })}
        </div>
        {/* Credits 余额 */}
        <div className="flex items-center gap-1">
          <Star size={14} className="text-yellow-400" />
          <span className="text-xs text-[#9BA1A6]">可用 Credits: {creditsAvailable}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[15px] font-bold text-[#ECEDEE]">选择图片生成引擎</p>
        <div className="flex items-center gap-1 bg-yellow-400/10 px-2.5 py-1 rounded-full">
          <Star size={14} className="text-yellow-400" />
          <span className="text-xs font-bold text-yellow-400">{creditsAvailable}</span>
        </div>
      </div>

      {engines.map((eng) => {
        const isSelected = selected === eng.id;
        const disabled = !eng.available;
        const Icon = eng.icon;

        return (
          <button
            key={eng.id}
            onClick={() => !disabled && onSelect(eng.id)}
            disabled={disabled}
            style={isSelected ? { borderColor: eng.color, backgroundColor: eng.color + "10" } : {}}
            className="flex items-center justify-between bg-[#1C1C1E] rounded-xl p-3.5 border-[1.5px] border-[#2C2C2E] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center flex-1 gap-3">
              <div style={{ backgroundColor: eng.color + "20" }} className="w-10 h-10 rounded-lg flex items-center justify-center">
                <Icon size={20} style={{ color: disabled ? "#555" : eng.color }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center">
                  <span className={`text-[15px] font-bold text-[#ECEDEE] ${disabled && 'text-[#555]'}`}>
                    {eng.label}
                  </span>
                  {disabled && (
                    <Lock size={14} className="text-[#555] ml-1" />
                  )}
                </div>
                <p className={`text-xs text-[#9BA1A6] mt-0.5 ${disabled && 'text-[#444]'}`}>
                  {disabled && eng.reason ? eng.reason : eng.desc}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span style={{ color: disabled ? "#555" : eng.color }} className="text-xs font-bold">
                {eng.cost}
              </span>
              {isSelected && (
                <CheckCircle size={20} style={{ color: eng.color }} />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

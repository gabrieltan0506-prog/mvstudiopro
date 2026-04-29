/**
 * 企业专属 IP 基因库 · 靛青色拦截弹窗（共享组件）
 *
 * 设计目标：B 端任何重算力推演任务（PlatformPage 平台分析、GodView 一键深潜）
 * 启动前必须先注入 5 个战略字段，否则推演会跑偏成大众视角的"小生意建议"。
 *
 * 数据存储：window.localStorage["ipProfile.v1"]，仅本机存档，跟用户绑定。
 * 后端 deepResearch.launch / mvAnalysis.* 接收 ipProfile 字段后注入 [全局战略预设] 段。
 */
import React from "react";
import { toast } from "sonner";

export type IpProfile = {
  industry: string;
  advantage: string;
  audience: string;
  taboos: string;
  flagship: string;
};

export const EMPTY_IP_PROFILE: IpProfile = {
  industry: "",
  advantage: "",
  audience: "",
  taboos: "",
  flagship: "",
};

const IP_PROFILE_LS_KEY = "ipProfile.v1";

/** 从 localStorage 读取 ipProfile（SSR 友好，永远返回有效对象） */
export function readIpProfile(): IpProfile {
  if (typeof window === "undefined") return { ...EMPTY_IP_PROFILE };
  try {
    const raw = window.localStorage.getItem(IP_PROFILE_LS_KEY);
    if (!raw) return { ...EMPTY_IP_PROFILE };
    const parsed = JSON.parse(raw);
    return {
      industry: typeof parsed?.industry === "string" ? parsed.industry : "",
      advantage: typeof parsed?.advantage === "string" ? parsed.advantage : "",
      audience: typeof parsed?.audience === "string" ? parsed.audience : "",
      taboos: typeof parsed?.taboos === "string" ? parsed.taboos : "",
      flagship: typeof parsed?.flagship === "string" ? parsed.flagship : "",
    };
  } catch {
    return { ...EMPTY_IP_PROFILE };
  }
}

export function writeIpProfile(p: IpProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IP_PROFILE_LS_KEY, JSON.stringify(p));
  } catch {}
}

/** 关键四要素是否齐备：industry / advantage / audience / flagship；taboos 选填 */
export function isIpProfileReady(p: IpProfile): boolean {
  return (
    !!p.industry && p.industry.trim().length >= 2 &&
    !!p.advantage && p.advantage.trim().length >= 2 &&
    !!p.audience && p.audience.trim().length >= 2 &&
    !!p.flagship && p.flagship.trim().length >= 2
  );
}

interface Props {
  open: boolean;
  value: IpProfile;
  onChange: (next: IpProfile) => void;
  onClose: () => void;
  onSaved?: (saved: IpProfile) => void;
}

export const IpProfileModal: React.FC<Props> = ({ open, value, onChange, onClose, onSaved }) => {
  if (!open) return null;
  const handleSave = () => {
    const required = ["industry", "advantage", "audience", "flagship"] as const;
    const missing = required.filter((k) => !value[k] || value[k].trim().length < 2);
    if (missing.length > 0) {
      toast.error("请至少完整填写：行业身份 / 核心优势 / 目标受众 / 高客单旗舰交付");
      return;
    }
    writeIpProfile(value);
    toast.success("IP 基因已存档，可继续推演");
    onSaved?.(value);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
      <div className="w-full max-w-md rounded-[24px] border border-[#6366F1]/55 bg-[linear-gradient(160deg,#1E1B4B_0%,#312E81_60%,#1E1B4B_100%)] p-7 shadow-[0_24px_80px_rgba(99,102,241,0.35)]">
        <div className="text-xl font-black text-[#A5B4FC] mb-2">载入企业专属 IP 基因</div>
        <div className="text-xs text-[#C7D2FE] mb-6 leading-5">
          启动战略推演前，请先设定您的护城河与高客单锚点。
          <span className="ml-1 text-[#FCD34D]">数据将注入战略推演链，仅本机存档。</span>
        </div>
        <div className="space-y-4">
          {(["industry", "advantage", "audience"] as const).map((field) => (
            <div key={field}>
              <label className="text-[11px] uppercase tracking-[0.18em] text-[#A5B4FC] mb-1 block">
                {field === "industry" ? "行业身份" : field === "advantage" ? "核心优势" : "目标受众"}
              </label>
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#818CF8]/70 focus:bg-white/10 transition"
                value={value[field]}
                onChange={(e) => onChange({ ...value, [field]: e.target.value })}
                placeholder={
                  field === "industry"
                    ? "例：医美轻医疗 / 高净值私董会 / 跨境电商"
                    : field === "advantage"
                    ? "例：哈佛医师背书、十年临床、独家配方"
                    : "例：35-55 岁高净值女性、企业一号位"
                }
              />
            </div>
          ))}
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-[#F0ABFC] mb-1 block">品牌禁忌</label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-[#F0ABFC]/70 focus:bg-white/10 transition"
              value={value.taboos}
              onChange={(e) => onChange({ ...value, taboos: e.target.value })}
              placeholder="例如：绝不提降价促销 / 不接广告投放"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-[#FCD34D] mb-1 block">企业高客单旗舰交付</label>
            <input
              className="w-full rounded-xl border border-[#FCD34D]/30 bg-[rgba(252,211,77,0.05)] px-4 py-3 text-sm text-[#FCD34D] outline-none focus:border-[#FCD34D] transition"
              value={value.flagship}
              onChange={(e) => onChange({ ...value, flagship: e.target.value })}
              placeholder="例如：5 万/次私人顾问、2 万高端闭门营"
            />
          </div>
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 hover:bg-white/10 transition"
            >
              稍后
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-xl bg-[linear-gradient(135deg,#4F46E5,#6366F1_55%,#8B5CF6)] py-3.5 text-sm font-bold text-white shadow-[0_10px_30px_rgba(99,102,241,0.45)] hover:brightness-110 transition"
            >
              保存基因并启动引擎
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IpProfileModal;

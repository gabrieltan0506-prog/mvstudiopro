import { AlertTriangle, ArrowRight, Crown, MessageCircle, Search } from "lucide-react";
import { Link } from "wouter";
import type { PlatformBasicConversionScript } from "@shared/platformConversionScripts";
import {
  TRUST_DOOR_BADGE,
  conversionScriptLooksGeneric,
} from "@shared/platformConversionScripts";

type Props = {
  scripts: PlatformBasicConversionScript[];
  isLoading?: boolean;
  personaHint?: string;
};

function trustDoorStyle(focus: string): { label: string; color: string } {
  const key = Object.keys(TRUST_DOOR_BADGE).find((k) => focus.includes(k));
  return key ? TRUST_DOOR_BADGE[key]! : { label: focus || "四有", color: "#fb923c" };
}

export default function PlatformConversionScriptsPanel({ scripts, isLoading, personaHint }: Props) {
  return (
    <div className="rounded-[24px] border border-[#ff6b2b]/25 bg-[rgba(255,100,30,0.06)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MessageCircle className="h-4 w-4 text-[#ff9966]" />
            各平台基础成交话术
            <span className="rounded-full border border-[#ff6b2b]/40 bg-[rgba(255,100,30,0.12)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#ff9966]">
              千人千面
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-[#c9c0e6]">
            基于你的人设与 Stage 2 选题定制，禁止套话模板。以下为各平台<strong className="text-[#fdba74]">基础承接话术</strong>；多轮异议处理、深度保障体系请用下方 Deep Research 深潜。
          </p>
          {personaHint ? (
            <p className="mt-1 text-[11px] text-[#8cefff]/80">人设锚点：{personaHint}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {isLoading ? (
          <div className="col-span-2 flex h-28 animate-pulse items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#8cefff]/60">
            正在生成各平台千人千面成交话术…
          </div>
        ) : scripts.length === 0 ? (
          <div className="col-span-2 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[#c9c0e6]">
            完成 Stage 2 后将按抖音 / 快手 / 小红书 / B站 各生成一条专属基础话术（须含你的职业、交付与痛点细节）。
          </div>
        ) : (
          scripts.map((row) => {
            const door = trustDoorStyle(row.trustDoorFocus);
            const generic = conversionScriptLooksGeneric(row.basicClosingScript);
            return (
              <div
                key={`${row.platform}-${row.platformLabel}`}
                className="rounded-2xl border border-white/10 bg-[rgba(18,13,43,0.85)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-white">{row.platformLabel}</div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ color: door.color, border: `1px solid ${door.color}55`, background: `${door.color}18` }}
                  >
                    {door.label}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-[#9ddcff]">目标人群 · {row.targetAudience}</div>
                {row.audiencePain ? (
                  <div className="mt-1 text-[11px] leading-5 text-[#d3caef]/90">
                    潜在表达：{row.audiencePain}
                  </div>
                ) : null}
                <div className="mt-3 rounded-xl border border-[#ff6b2b]/20 bg-[rgba(255,100,30,0.08)] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#ff9966]">{row.usageScene}</div>
                  <p className="mt-2 text-sm leading-7 text-white whitespace-pre-wrap">{row.basicClosingScript}</p>
                  {generic ? (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-400/90">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      检测到套话倾向，建议重跑分析或使用 Deep Research 深潜改写
                    </p>
                  ) : null}
                </div>
                {row.personalAnchor ? (
                  <div className="mt-2 text-[11px] leading-5 text-[#8cefff]/75">专属锚点：{row.personalAnchor}</div>
                ) : null}
                {row.lightGuarantee ? (
                  <div className="mt-2 rounded-lg border border-[#4ade80]/25 bg-[rgba(74,222,128,0.08)] px-3 py-2 text-xs leading-6 text-[#bbf7d0]">
                    轻保障：{row.lightGuarantee}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Link
          href="/research"
          className="group flex h-full flex-col rounded-2xl border border-[#f97316]/35 bg-[rgba(249,115,22,0.08)] p-4 transition hover:border-[#fb923c]/60 no-underline"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-[#fb923c]">
            <Search className="h-4 w-4" />
            Deep Research Pro · 竞品四有信任
            <ArrowRight className="ml-auto h-4 w-4 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          </div>
          <p className="mt-2 text-xs leading-6 text-[#d3caef]">
            约 30 秒 · 粘贴竞品文案，快速得到表面/潜在表达、四道门审计与共鸣钩子，优化你的成交话术切口（60 点/次）。
          </p>
        </Link>
        <Link
          href="/godview"
          className="group flex h-full flex-col rounded-2xl border border-[#a8761b]/35 bg-[rgba(168,118,27,0.1)] p-4 transition hover:border-[#d4a017]/55 no-underline"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-[#f5d78e]">
            <Crown className="h-4 w-4" />
            Deep Research Max · 上帝视角
            <ArrowRight className="ml-auto h-4 w-4 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
          </div>
          <p className="mt-2 text-xs leading-6 text-[#d3caef]">
            Agent 深潜 · 用户洞察三步（归类→挖潜在→写钩子）、四道门完整信任旅程与预先布置保障体系（计划→审批→深潜）。
          </p>
        </Link>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-[#8cefff]/70">
        完整图文说明见仓库文档 <code className="text-[#fdba74]">docs/DEEP_RESEARCH_PRO_MAX_GUIDE.md</code>
      </p>
    </div>
  );
}

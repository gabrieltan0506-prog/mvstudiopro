import React, { useState } from "react";
import { Link } from "wouter";
import { isSeedance25Launched } from "@shared/seedance25Access";

/**
 * 功能直达区（2026-08-12 重构）：旧版按「五台引擎」各摆一张卡，同一功能被拆进
 * 多张引擎卡里重复出现——用户拍板定性为旧 agent 的「虚假繁荣」。
 * 新版按功能归类：一件事一张卡，引擎收进下拉；下拉切换的是真实跳转目标与说明，
 * 「去生成」直达对应工作台（反空壳：选择必须驱动跳转，不带无人消费的参数）。
 *
 * 引擎名对外展示是用户 2026-08-05 的显式例外指令（零技术泄漏规则的豁免点）。
 */

type EngineOption = {
  /** 下拉里显示：档位 · 引擎名 */
  label: string;
  /** 选中后卡片下方的一句说明 */
  desc: string;
  /** 「去生成」跳转目标（全部为既有真实入口） */
  href: string;
};

type FunctionEntry = {
  title: string;
  tagline: string;
  options: EngineOption[];
  badge?: string;
};

const FUNCTIONS: FunctionEntry[] = [
  {
    title: "图文知识卡",
    tagline: "把一本九万字的书，读成一叠能直接发的卡片。",
    options: [
      {
        label: "精细档 · GPT-5.6 Sol",
        desc: "输出最全，长文档提炼首选",
        href: "/platform?mode=create&tab=copy",
      },
      {
        label: "均衡档 · Kimi K3",
        desc: "速度与密度的折中档",
        href: "/platform?mode=create&tab=copy",
      },
      {
        label: "轻量档 · Qwen 3.8 Max",
        desc: "单价最低，出稿最快",
        href: "/platform?mode=create&tab=copy",
      },
    ],
  },
  {
    title: "选题与全案文案",
    tagline: "趋势看板、20 条爆款选题、逐镜拆片表，一口气交付。",
    options: [
      {
        label: "稳定档 · Kimi K3",
        desc: "趋势、选题、六维全案与顾问问答主力",
        href: "/platform?mode=create",
      },
      {
        label: "轻快档 · Qwen 3.8 Max",
        desc: "扩写更快更省，赶热点用它",
        href: "/platform?mode=create",
      },
    ],
  },
  {
    title: "视频成片",
    tagline: "文生 / 图生 / 多模态参考 / 编辑 / 延长，五种模式。",
    options: [
      {
        label: "Seedance 2.5 · 单段 30 秒",
        desc: "原生声画同步，漫剧一集四段直接加长",
        href: "/canvas",
      },
      {
        label: "MiniMax H3 · 2K 直出",
        desc: "固定 15 秒，屏内文字与品牌牌面最稳",
        href: "/canvas",
      },
      {
        label: "创作台 · 单图起片",
        desc: "一张图一步出 2K 成片",
        href: "/creative",
      },
    ],
  },
  {
    title: "素材深度拆解",
    tagline: "对标视频逐帧分析、总结与战略推演。",
    options: [
      {
        label: "深度档 · GPT-5.6 Sol",
        desc: "逐帧视觉分析，出可执行策略",
        href: "/creator-growth-camp",
      },
    ],
  },
];

function FunctionCard({ entry }: { entry: FunctionEntry }) {
  const [sel, setSel] = useState(0);
  const active = entry.options[sel]!;
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[17px] font-bold text-white">{entry.title}</h3>
        {entry.badge ? (
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            {entry.badge}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">{entry.tagline}</p>

      <div className="mt-4 flex flex-col gap-2">
        {entry.options.length > 1 ? (
          <select
            value={sel}
            onChange={(e) => setSel(Number(e.target.value) || 0)}
            aria-label={`${entry.title}引擎选择`}
            className="w-full rounded-xl border border-white/12 bg-black/45 px-3 py-2 text-[13px] text-white/85 outline-none transition-colors hover:border-white/25 focus:border-white/35"
          >
            {entry.options.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/70">
            {active.label}
          </div>
        )}
        <p className="min-h-[2.2em] text-[11.5px] leading-relaxed text-white/45">{active.desc}</p>
      </div>

      <Link
        href={active.href}
        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2 text-[13px] font-semibold text-white/90 no-underline transition-colors hover:border-white/30 hover:bg-white/[0.1] hover:text-white"
      >
        去生成 <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

export default function HomeModelShowcase() {
  const launched = isSeedance25Launched();
  return (
    <section className="mx-auto w-full max-w-[1240px] px-5 py-14">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/60">
          功能直达 · 引擎任选
        </span>
        <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-white sm:text-[34px]">
          先选要做的事，引擎一个下拉搞定
        </h2>
        <p className="mx-auto mt-3 max-w-[640px] text-[13px] leading-relaxed text-white/55 sm:text-sm">
          四件事各管一段：卡片选功能、下拉挑引擎、一键进工作台。
          {launched ? " Seedance 2.5 已正式接入成片链路。" : ""}
        </p>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FUNCTIONS.map((f) => (
          <FunctionCard key={f.title} entry={f} />
        ))}
      </div>
    </section>
  );
}

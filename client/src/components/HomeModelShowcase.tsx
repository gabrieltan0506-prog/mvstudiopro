import React from "react";
import { Link } from "wouter";
import {
  SEEDANCE_25_LAUNCH_DATE_LABEL_ZH,
  isSeedance25Launched,
} from "@shared/seedance25Access";

/**
 * 首页「顶级引擎」宣传区。
 *
 * 用户 2026-08-05 明文要求对外宣传在用的模型与对应页面功能，并为每个模型配站内链接。
 * 这是前台零技术泄漏规则（不对普通用户露模型名）的显式例外，依据为用户当轮明文指令。
 *
 * 口径以代码事实为准：创作顾问与全案文案实际由 Kimi K3 驱动，不写成 GPT-5.6；
 * 知识卡三档（精细/均衡/轻量）用户可自选。
 */

type EngineEntry = {
  name: string;
  tagline: string;
  /** 该模型驱动的功能 → 站内路由 */
  uses: Array<{ href: string; label: string; desc: string }>;
  badge?: string;
};

const ENGINES: EngineEntry[] = [
  {
    name: "GPT-5.6 Sol",
    tagline: "把一本九万字的书，读成一叠能看的卡片",
    uses: [
      {
        href: "/platform",
        label: "图文知识卡片 · 精细档",
        desc: "上传文档或图片，自动提炼成多页横版知识卡",
      },
      {
        href: "/creator-growth-camp",
        label: "素材深度拆解",
        desc: "对标视频逐帧视觉分析、总结与战略推演",
      },
    ],
  },
  {
    name: "Kimi K3",
    tagline: "从趋势看板一路写到六维全案，一口气交付",
    uses: [
      {
        href: "/platform",
        label: "趋势看板与全案文案",
        desc: "平台趋势、选题推荐、六维全案、趋势报表、动效 PPT",
      },
      { href: "/platform", label: "创作顾问问答", desc: "站内顾问对话与深度追问" },
      {
        href: "/canvas",
        label: "创作画布 · 文案主力",
        desc: "文本节点主力档，漫剧编剧室连载扩写与运镜润色",
      },
    ],
  },
  {
    name: "Qwen 3.8 Max",
    tagline: "专治等不起：更低成本，更快出稿",
    uses: [
      {
        href: "/platform",
        label: "图文知识卡片 · 轻量档",
        desc: "同一入口的低成本档位，精细／均衡／轻量三档任选",
      },
    ],
  },
  {
    name: "Seedance 2.5",
    tagline: "单段最长 30 秒，一集四段，成片直接加长",
    badge: `${SEEDANCE_25_LAUNCH_DATE_LABEL_ZH}上线`,
    uses: [
      {
        href: "/canvas",
        label: "成片·加长",
        desc: "新生成／延长／局部重拍／复刻／画质提升／擦字幕 六种模式",
      },
      {
        href: "/canvas",
        label: "漫剧编剧室 · 四段成片",
        desc: "4 段 × 约 30 秒，约 120 秒一集",
      },
    ],
  },
  {
    name: "MiniMax H3",
    // 「唯一出 2K」已不成立：Seedance 标准档现在可选到 4K，改说它的实际强项
    tagline: "2K 直出，字牌不糊：屏内文字与品牌牌面最稳的一档",
    uses: [
      {
        href: "/canvas",
        label: "成片·H3（2K）",
        desc: "固定 15 秒，多图参考 + 运镜/动作/对白，屏内字与品牌牌面更稳",
      },
      {
        href: "/creative",
        label: "创作台 · 图生视频",
        desc: "单图起片，一步出 2K 成片",
      },
    ],
  },
];

export default function HomeModelShowcase() {
  const launched = isSeedance25Launched();

  return (
    <section className="mx-auto w-full max-w-[1240px] px-5 py-14">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/60">
          顶级引擎 · 一站开工
        </span>
        <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-white sm:text-[34px]">
          五台顶级引擎，接在同一条流水线上
        </h2>
        <p className="mx-auto mt-3 max-w-[640px] text-[13px] leading-relaxed text-white/55 sm:text-sm">
          选题、文案、静帧、成片，不用再换五个工具。每台引擎负责它最擅长的那一段。
        </p>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        {ENGINES.map((engine) => (
          <div
            key={engine.name}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-bold text-white">{engine.name}</h3>
              {engine.badge ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    launched
                      ? "bg-emerald-400/15 text-emerald-300"
                      : "bg-amber-400/15 text-amber-300"
                  }`}
                >
                  {launched ? "已上线" : engine.badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">{engine.tagline}</p>

            <ul className="mt-4 space-y-2">
              {engine.uses.map((use) => (
                <li key={`${engine.name}-${use.label}`}>
                  <Link
                    href={use.href}
                    className="group flex flex-col rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2.5 transition-colors hover:border-white/18 hover:bg-white/[0.06]"
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white/85 group-hover:text-white">
                      {use.label}
                      <span aria-hidden className="text-white/30 group-hover:text-white/60">
                        →
                      </span>
                    </span>
                    <span className="mt-0.5 text-[11.5px] leading-relaxed text-white/45">
                      {use.desc}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

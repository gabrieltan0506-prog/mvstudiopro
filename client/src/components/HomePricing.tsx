import React from "react";
import { Link } from "wouter";
import { CREDIT_COSTS } from "@shared/plans";

/**
 * 首页定价区（2026-08-12 用户拍板重写）：置顶、展开、明码标价——
 * 「我们是商业网站，不是搞慈善的」。价目一律取现行真实扣点：平台创作直接读
 * CREDIT_COSTS 单一真源；成片/超分/照片为站内已公开的拍板档位。以站内实际扣点为准。
 */

type PriceRow = { name: string; price: string; note?: string };
type PriceGroup = { title: string; accent: string; rows: PriceRow[] };

const GROUPS: PriceGroup[] = [
  {
    title: "视频成片",
    accent: "#8cefff",
    rows: [
      { name: "4K 成片 · 单条", price: "688 积分", note: "限时价" },
      { name: "2K 成片 · 单条", price: "388 积分", note: "限时价" },
      { name: "漫剧整集（4 段 × 约 30s）", price: "688 积分", note: "172 / 段" },
    ],
  },
  {
    title: "高清放大（按秒计费）",
    accent: "#c4b5fd",
    rows: [
      { name: "视频超分 2K", price: "2 积分 / 秒", note: "不足 5 秒按 5 秒；自由画布单条 ×1.1" },
      { name: "视频超分 4K", price: "4 积分 / 秒", note: "单任务最长 600 秒；自由画布单条 ×1.1" },
      { name: "照片放大 2× / 4×", price: "15 / 35 积分" },
    ],
  },
  {
    title: "平台创作",
    accent: "#6ee7b7",
    rows: [
      {
        name: "爆款选题 20 条",
        price: `${CREDIT_COSTS.platformTopicShortlist + 14 * CREDIT_COSTS.platformTopicShortlistExtra} 积分`,
        note: "含评分排序",
      },
      {
        name: "正式文案扩写（含逐镜拆片表）",
        price: `${CREDIT_COSTS.platformTopicExpand} 积分 / 条`,
        note: "失败自动退款",
      },
      { name: "2×4 / 3×4 编导分镜图", price: `${CREDIT_COSTS.platformStoryboardSheet} / ${CREDIT_COSTS.platformStoryboardSheet3x4} 积分` },
      { name: "图文知识卡（4K）", price: "30 积分 / 页", note: "轻量档 24 / 页" },
      { name: "深度优化文案", price: `${CREDIT_COSTS.platformOptimizeCustomCopy} 积分` },
    ],
  },
  {
    title: "照片工具",
    accent: "#ff9fe0",
    rows: [
      { name: "老照片修复上色", price: "10 积分" },
      { name: "照片动画 5s / 10s / 15s", price: "40 / 79 / 118 积分", note: "720p；1080p +20%" },
    ],
  },
];

export default function HomePricing() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/60">
            定价 · 明码标价
          </span>
          <h2 className="mt-3 text-[26px] font-extrabold leading-tight text-white sm:text-[32px]">
            按件计费，用多少付多少
          </h2>
          <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-white/55">
            所有价目即为站内实际扣点，生成失败的任务自动退回积分。优惠档位重算期间，以下即现行价。
          </p>
        </div>
        <Link
          href="/pricing"
          className="shrink-0 rounded-full border border-white/20 bg-white/[0.06] px-6 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:border-white/35 hover:bg-white/[0.1]"
        >
          去充值 →
        </Link>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {GROUPS.map((g) => (
          <div
            key={g.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20"
          >
            <h3 className="text-[15px] font-bold" style={{ color: g.accent }}>
              {g.title}
            </h3>
            <ul className="mt-3 space-y-2.5">
              {g.rows.map((r) => (
                <li key={r.name} className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                  <span className="min-w-0 text-[12.5px] leading-snug text-white/70">
                    {r.name}
                    {r.note ? <span className="ml-1 text-[10.5px] text-white/35">（{r.note}）</span> : null}
                  </span>
                  <span className="shrink-0 text-[13px] font-bold text-white">{r.price}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

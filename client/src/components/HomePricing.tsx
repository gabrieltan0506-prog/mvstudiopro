import React from "react";
import { Link } from "wouter";

/**
 * 首页定价条：优惠重算期间不摆整版占位卡（一个板块只为说「还没好」是在道歉不是在设计），
 * 收成一行通告条——信息一句讲完，入口保留，不打断页面叙事。正式价目上线后再恢复卡片。
 */
export default function HomePricing() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 sm:rounded-full">
        <span className="text-sm font-bold text-white">定价</span>
        <span className="min-w-[14rem] flex-1 text-[13px] text-white/55">
          积分包与优惠档位按真实消耗重算中，正式价目上线前以站内扣点说明为准
        </span>
        <Link
          href="/pricing"
          className="shrink-0 rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/85 no-underline hover:border-white/35 hover:text-white"
        >
          查看充值页
        </Link>
      </div>
    </section>
  );
}

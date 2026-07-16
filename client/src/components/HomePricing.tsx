import React from "react";
import { Link } from "wouter";

/**
 * 首页定价区：优惠策略重算期间不展示具体价目，避免误导。
 * 正式价目表更新后由产品拍板再恢复卡片。
 */
export default function HomePricing() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pb-4 pt-9">
      <h2 className="text-2xl font-black text-white">定价</h2>
      <div className="mt-4 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6">
        <p className="text-lg font-bold tracking-tight text-white">定价优惠更新中</p>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          积分包与优惠档位正在按真实消耗重算。充值入口暂保留，正式价目上线前请以站内扣点说明为准。
        </p>
        <Link
          href="/pricing"
          className="mt-5 inline-block rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/85 no-underline hover:border-white/35 hover:text-white"
        >
          查看充值页（更新中）
        </Link>
      </div>
    </section>
  );
}

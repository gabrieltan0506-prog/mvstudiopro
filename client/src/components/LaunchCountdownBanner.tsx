import React from "react";
import { PartyPopper, ArrowRight, Clapperboard } from "lucide-react";
import { Link } from "wouter";
import { SEEDANCE_25_LAUNCHED_LABEL_ZH } from "@shared/seedance25Access";

/**
 * 首页 Seedance 2.5 正式上线宣传区。
 *
 * 倒计时已下线；沿用既有上线文案，样片统一在 HomeHero 展示。
 * 本处按用户明文授权对外写出引擎名，属前台零技术泄漏规则的显式例外。
 */

export function LaunchCountdownBanner() {
  return (
    <section className="border-b border-emerald-300/15 bg-[radial-gradient(circle_at_20%_10%,rgba(16,185,129,0.17),transparent_34%),linear-gradient(135deg,#070a10,#111126_58%,#170b25)] px-5 py-8 sm:py-11">
      <div className="mx-auto grid w-full max-w-[1120px] items-center gap-7">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-200">
            <PartyPopper size={14} className="text-yellow-300" /> 正式上线
          </div>
          <h2 className="mt-4 text-3xl font-black leading-tight text-white sm:text-4xl">
            {SEEDANCE_25_LAUNCHED_LABEL_ZH}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-white/58">
            单段最长 30 秒，原生声画同步。文生视频、图生视频、多模态参考、视频编辑与视频延长，已经接入漫剧工厂和创作画布。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-white/65">
            {["文生视频", "图生视频", "多模态参考", "视频编辑", "视频延长"].map(label => (
              <span key={label} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
                {label}
              </span>
            ))}
          </div>
          <Link
            href="/canvas"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:brightness-110"
          >
            <Clapperboard className="h-4 w-4" /> 进入漫剧工厂与画布
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

import React from "react";
import HomeNavbar from "../components/HomeNavbar";
import HomeHero from "../components/HomeHero";
import HomeCursorReveal from "../components/HomeCursorReveal";
import HomeScrollVideo from "../components/HomeScrollVideo";
import HomePricing from "../components/HomePricing";
import HomeMyWorks from "../components/HomeMyWorks";
import HomeRedeemCode from "../components/HomeRedeemCode";
import HomeInviteApply from "../components/HomeInviteApply";
import SampleReportDownload from "../components/SampleReportDownload";

/**
 * 营销首页（方案 A）：导航 + Hero + V3 动效段 + 定价占位 + 试读 + 我的作品；
 * 兑换/邀请收在页底次要区。
 */
export default function HomePage() {
  return (
    <div className="relative min-h-dvh bg-[#0a0915]">
      <div
        className="relative z-[1] min-h-dvh"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.14), transparent 55%), #0a0915",
        }}
      >
        <HomeNavbar />
        <HomeHero />
        <HomeCursorReveal />
        <HomeScrollVideo />

        <HomePricing />

        <SampleReportDownload />

        <HomeMyWorks />

        <section className="mx-auto w-full max-w-[720px] px-5 pb-16 pt-6">
          <details className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 open:pb-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-white/70 marker:content-none [&::-webkit-details-marker]:hidden">
              邀请码兑换 / 申请内测
              <span className="ml-2 text-xs font-normal text-white/40">可选 · 点击展开</span>
            </summary>
            <div className="mt-4 space-y-4 border-t border-white/8 pt-4">
              <div id="redeem-invite" style={{ scrollMarginTop: 80 }} />
              <HomeRedeemCode />
              <HomeInviteApply />
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

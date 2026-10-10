import React from "react";
import HomeNavbar from "../components/HomeNavbar";
import HomePresentationShowcase from "../components/HomePresentationShowcase";
import HomeHero from "../components/HomeHero";
import HomePricing from "../components/HomePricing";
import HomeMyWorks from "../components/HomeMyWorks";
import HomeRedeemCode from "../components/HomeRedeemCode";
import HomeInviteApply from "../components/HomeInviteApply";
import HomeEducation from "../components/HomeEducation";
import HomeFeedback from "../components/HomeFeedback";
import HomeBlogShowcase from "../components/HomeBlogShowcase";
import { LaunchCountdownBanner } from "../components/LaunchCountdownBanner";
import HomePlatformHighlights from "../components/HomePlatformHighlights";
import HomeFileConversion from "../components/HomeFileConversion";
import HomeCodeMotion from "../components/code-motion/HomeCodeMotion";
import HomePhotoTools from "../components/HomePhotoTools";
import "../styles/homeProduct.css";

/**
 * 营销首页（方案 A）：导航 + Hero + V3 动效段 + 定价占位 + 试读 + 我的作品；
 * 兑换/邀请收在页底次要区。
 */
export default function HomePage() {
  return (
    <div data-home-theme="warm" className="home-product relative min-h-dvh">
      <div className="home-product-content relative z-[1] min-h-dvh">
        <HomeNavbar />
        <HomeHero />
        <LaunchCountdownBanner />
        <HomePresentationShowcase />
        {/* 定价置顶（用户 2026-08-12：商业网站先谈钱）；试读样刊区整区下架，换 /blog 实测封面直达生成 */}
        <HomePricing />
        <HomeCodeMotion />
        <HomePhotoTools />
        <HomeFileConversion />
        <HomePlatformHighlights />
        <HomeBlogShowcase />

        <HomeMyWorks />

        <HomeEducation />

        <HomeFeedback />

        <section className="mx-auto w-full max-w-[720px] px-5 pb-16 pt-6">
          <details className="rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] px-4 py-3 open:pb-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--hp-muted)] marker:content-none [&::-webkit-details-marker]:hidden">
              邀请码兑换 / 申请内测
              <span className="ml-2 text-xs font-normal text-[var(--hp-muted)]">可选 · 点击展开</span>
            </summary>
            <div className="mt-4 space-y-4 border-t border-[var(--hp-line)] pt-4">
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

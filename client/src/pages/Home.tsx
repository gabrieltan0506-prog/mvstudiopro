import React from "react";
import HomeNavbar from "../components/HomeNavbar";
import HomeNoticeBar from "../components/HomeNoticeBar";
import HomeHero from "../components/HomeHero";
import HomeRemixStrip from "../components/HomeRemixStrip";
import HomeTools from "../components/HomeTools";
import HomeShowcase from "../components/HomeShowcase";
import HomePricing from "../components/HomePricing";
import HomeEducation from "../components/HomeEducation";
import HomeFeedback from "../components/HomeFeedback";
import HomeMyWorks from "../components/HomeMyWorks";
import HomeRedeemCode from "../components/HomeRedeemCode";
import HomeInviteApply from "../components/HomeInviteApply";
import HomeChangelog from "../components/HomeChangelog";

// 以下 section 在正式版開放前暫時隱藏
// import HomeWorkflow from "../components/HomeWorkflow";
// import HomeCreatorEco from "../components/HomeCreatorEco";
// import HomePlans from "../components/HomePlans";

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top center, rgba(255,79,179,0.12), transparent 18%), radial-gradient(circle at 0% 0%, rgba(139,92,246,0.18), transparent 24%), radial-gradient(circle at 100% 40%, rgba(59,130,246,0.10), transparent 20%), linear-gradient(180deg,#0a0814 0%, #0a0d1f 40%, #090915 100%)",
      }}
    >
      <HomeNavbar />

      <HomeNoticeBar />

      <HomeRedeemCode />

      <HomeInviteApply />

      <HomeHero />

      <HomeChangelog />

      <HomeRemixStrip />

      <HomeTools />

      <HomeShowcase />

      <HomePricing />

      <HomeEducation />

      <HomeMyWorks />

      <HomeFeedback />

      {/* 内测阶段暂时隐藏，正式版再开放 */}
      {/* <HomeWorkflow /> */}
      {/* <HomeCreatorEco /> */}
      {/* <HomePlans /> */}

      <div style={{ height: 60 }} />
    </div>
  );
}

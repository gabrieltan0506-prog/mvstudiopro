import React from "react";
import HomeNavbar from "../components/HomeNavbar";
import HomeNoticeBar from "../components/HomeNoticeBar";
import HomeHero from "../components/HomeHero";
import HomeRemixStrip from "../components/HomeRemixStrip";
import HomeShowcase from "../components/HomeShowcase";
import HomePricing from "../components/HomePricing";
import HomeEducation from "../components/HomeEducation";
import HomeFeedback from "../components/HomeFeedback";
import HomeMyWorks from "../components/HomeMyWorks";
import HomeRedeemCode from "../components/HomeRedeemCode";
import HomeInviteApply from "../components/HomeInviteApply";
import HomeFeatureCarousel from "../components/HomeFeatureCarousel";
import SampleReportDownload from "../components/SampleReportDownload";
import WorkAmbientPanel from "../components/WorkAmbientPanel";
import { AmbientSceneProvider } from "../components/AmbientSceneProvider";
import GlobalAmbientBackdrop from "../components/GlobalAmbientBackdrop";

// 以下 section 在正式版开放前暂时隐藏
// import HomeWorkflow from "../components/HomeWorkflow";
// import HomeCreatorEco from "../components/HomeCreatorEco";
// import HomePlans from "../components/HomePlans";

export default function HomePage() {
  return (
    <AmbientSceneProvider>
      <div className="relative" style={{ minHeight: "100dvh" }}>
        <GlobalAmbientBackdrop />
        <div
          className="relative z-[1]"
          style={{
            minHeight: "100dvh",
            background:
              "radial-gradient(circle at top center, rgba(255,79,179,0.12), transparent 18%), radial-gradient(circle at 0% 0%, rgba(139,92,246,0.18), transparent 24%), radial-gradient(circle at 100% 40%, rgba(59,130,246,0.10), transparent 20%), linear-gradient(180deg,#0a0814 0%, #0a0d1f 40%, #090915 100%)",
          }}
        >
      <HomeNavbar />

      <HomeNoticeBar />

      <HomeHero />

      {/* 全頁底圖與下列卡片区共用 Context：時段（顯示時區）× 天氣輪播 Unsplash；路況（Gemini）、國內/國際新聞 */}
      <div className="mx-auto w-full max-w-[1240px] px-5 pb-2">
        <WorkAmbientPanel />
      </div>

      {/* 试读样本 · 紧贴 Hero 正下方（黄金视觉位，让访客一滚屏就能下载） */}
      <SampleReportDownload />

      {/* 核心功能介绍 + 更新日志（试读完看平台能做什么） */}
      <HomeFeatureCarousel />

      {/* 工具与作品（沉浸式浏览） */}
      <HomeRemixStrip />

      <HomeShowcase />

      <HomeMyWorks />

      {/* 定价与转化（看完功能再做决策） */}
      <HomePricing />

      {/* 企业定制（HomeEnterpriseAgentCard）产品未收尾前不展示入口 */}

      {/* 兑换邀请码 / 申请邀请码（推到决策点之后）；锚点供更新日志等入口跳转 */}
      <div id="redeem-invite" style={{ scrollMarginTop: 80 }} />
      <HomeRedeemCode />

      <HomeInviteApply />

      <HomeEducation />

      <HomeFeedback />

      {/* 内测阶段暂时隐藏，正式版再开放 */}
      {/* <HomeWorkflow /> */}
      {/* <HomeCreatorEco /> */}
      {/* <HomePlans /> */}

      <div style={{ height: 60 }} />
        </div>
      </div>
    </AmbientSceneProvider>
  );
}

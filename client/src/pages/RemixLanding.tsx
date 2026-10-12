import MVAnalysisPage from "./MVAnalysis";

/** 复用原有分析与计费链，登录后不再跳走。 */
export default function RemixLanding() {
  return <MVAnalysisPage remixWorkspace />;
}

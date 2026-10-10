const TRPC_LONG_HTTP_LINK_PATHS = new Set([
  "mvAnalysis.getGrowthSnapshot",
  "mvAnalysis.getPlatformDashboard",
  /** 同步全案 Stage2（冒烟/部分入口）；与入队路径同级长耗时，须打 Fly 避免 Vercel 反代超时 */
  "mvAnalysis.getPlatformContent",
  "mvAnalysis.generatePlatformTopicShortlist",
  "mvAnalysis.enqueuePlatformContentJob",
  "mvAnalysis.enqueueGenerateTopicImage",
  "mvAnalysis.enqueueTopicCoverAndCompositeBundle",
  "mvAnalysis.generatePlatformCompositeSheet",
  "mvAnalysis.generateTopicImage",
  "mvAnalysis.generateAllPlatformTopicImages",
  "mvAnalysis.askPlatformFollowUp",
  "mvAnalysis.createPlatformQAJob",
  "mvAnalysis.downloadPlatformPdf",
  "mvAnalysis.generateDecisionIntelligenceReport",
  "mvAnalysis.generateDecisionIntelTopicExecutionCopy",
  "mvAnalysis.optimizeCustomCopy",
  "mvAnalysis.expandManhuaWriterPack",
  "mvAnalysis.trialManhuaWriterTemplate",
  "mvAnalysis.optimizeManhuaEpisodes",
  "mvAnalysis.generateHtmlPptOutline",
  "mvAnalysis.suggestHtmlPptThemes",
  "mvAnalysis.patchHtmlPptPage",
  "mvAnalysis.generateHtmlPptSlideImage",
  "mvAnalysis.askPlatformSkillQa",
  "mvAnalysis.confirmPlatformSkillQaImage",
  "mvAnalysis.getVideoUploadSignedUrl",
  /** 0908 实弹：75 分钟 15 片报告渲染要一两分钟，走 Vercel 反代必超时；直连 Fly */
  "manhuaViralTemplate.renderEpisodeReport",
  // 批准含锁与全库校验/GCS写入，和报告导出同走鉴权Fly，避免反代错误页。
  "manhuaViralTemplate.approve",
  // 学习进度与导入区同走已鉴权的 Fly，避免一边直连更新、一边被反代拦截。
  "manhuaViralTemplate.listProposals",
  "manhuaViralTemplate.getProposalDetail",
  "manhuaViralTemplate.getSeriesLearnSnapshot",
  "manhuaViralTemplate.listApprovedPrivate",
  /** 图片编辑 / 专用超分均可能运行数分钟，必须绕过 Vercel 同步请求时限。 */
  "homePhotoTools.restoreOldPhoto",
  "vertexImage.upscale",
  "usage.checkFeatureAccess",
  "ambient.dashboardLive",
  "ambient.dashboardNews",
  "ambient.hybridDashboard",
  "ambient.mascotCareMessage",
  /** 云端草稿 payload 偏大，走 Fly，避免 www→Vercel 反代回 HTML 导致 JSON 解析失败 */
  "manhuaCloudDraft.get",
  "manhuaCloudDraft.upsert",
  /** 0916 阿菁 A-pose 真跑：绑骨 5 秒轮询走 www 被 Vercel 质询回 HTML → 编辑器报 Unexpected token '<' 停住；同 #1483 学习任务口径直连 Fly */
  "manhuaAutoRig.submit",
  "manhuaAutoRig.get",
  "manhuaAutoRig.list",
  "manhuaAutoRig.adopt",
  "manhuaAutoRig.restore",
]);

export function useLongTrpcHttpLink(op: { path: string }) {
  return op.path.startsWith("codeMotion.") || op.path.startsWith("codeMotionProduction.") || op.path.startsWith("fileConversion.") || TRPC_LONG_HTTP_LINK_PATHS.has(op.path);
}

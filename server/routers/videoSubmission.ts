/**
 * 爆款视频奖励 + 平台授权系统
 *
 * 完整流程：
 * 1. 用户完成实名认证
 * 2. 用户上传视频 + 平台发布链接 + 后台数据截屏
 * 3. 用户勾选平台授权协议
 * 4. AI 自动审核：
 *    a. 多模态读取数据截屏（提取播放量、点赞、评论、分享）
 *    b. 验证视频链接格式（抖音/视频号/小红书/B站）
 *    c. 去重检测（contentFingerprint）
 *    d. 爆款评分（0-100）
 * 5. 自动发放 Credits：
 *    - 80-89 分 → 30 Credits
 *    - 90-100 分 → 80 Credits
 *    - <80 分 → 0 Credits
 * 6. 获奖视频：平台可无偿展示和二次开发，无需告知原作者
 *
 * 上传条件：
 * - 必须已完成实名认证
 * - 必须已在至少一个平台（抖音/视频号/小红书/B站）发布
 * - 必须提供后台数据截屏 + 视频发布链接
 * - 同一视频多平台分发只计算一次
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { getDb } from "../db";
import { addCredits } from "../credits";
import {
  userVerifications,
  videoSubmissions,
  videoPlatformLinks,
  users,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { analyzeVideoMultiFrame, validateDuration, type MultiFrameResult, type ProgressCallback, type ScoringStrategy } from "../videoAnalysis";

// ─── 进度追踪（内存中，用于轮询） ─────────────────
const analysisProgress = new Map<number, {
  stage: string;
  progress: number;
  detail: string;
  frameAnalyses?: Array<{ frameIndex: number; timestamp: number; imageUrl: string }>;
  completed: boolean;
  error?: string;
}>();

// ─── 平台 URL 正则验证 ──────────────────────────────
const PLATFORM_URL_PATTERNS: Record<string, RegExp[]> = {
  douyin: [
    /douyin\.com/i,
    /v\.douyin\.com/i,
    /iesdouyin\.com/i,
  ],
  weixin_channels: [
    /channels\.weixin\.qq\.com/i,
    /finder\.video\.qq\.com/i,
    /mp\.weixin\.qq\.com/i,
    /weixin\.qq\.com/i,
  ],
  xiaohongshu: [
    /xiaohongshu\.com/i,
    /xhslink\.com/i,
    /xhs\.cn/i,
  ],
  bilibili: [
    /bilibili\.com/i,
    /b23\.tv/i,
    /bili\.com/i,
  ],
};

function validatePlatformUrl(platform: string, url: string): boolean {
  const patterns = PLATFORM_URL_PATTERNS[platform];
  if (!patterns) return false;
  return patterns.some((p) => p.test(url));
}

// ─── AI 读取数据截屏 ──────────────────────────────────
async function aiReadDataScreenshot(screenshotUrl: string): Promise<{
  playCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  confidence: number;
  rawText: string;
  isSuspicious: boolean;
  suspiciousReason?: string;
}> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一个专业的社交媒体数据分析师。请分析这张平台后台数据截屏，提取以下关键指针：
1. 播放量/观看量
2. 点赞数
3. 评论数
4. 分享/转发数

同时判断截屏是否有造假嫌疑（PS 痕迹、数据异常、截屏格式不符等）。

请以 JSON 格式返回：
{
  "playCount": 数字（播放量，如果无法识别则为 0），
  "likeCount": 数字（点赞数），
  "commentCount": 数字（评论数），
  "shareCount": 数字（分享数），
  "confidence": 0-1 之间的数字（识别置信度），
  "rawText": "截屏中识别到的原始文本",
  "isSuspicious": true/false（是否有造假嫌疑），
  "suspiciousReason": "造假嫌疑原因（如果有的话）"
}

注意：
- 数字可能包含「万」「w」「k」等单位，请转换为实际数字
- 例如 "1.2万" = 12000, "3.5w" = 35000, "10k" = 10000
- 如果截屏模糊或无法识别，confidence 设为低值
- 如果数据比例明显不合理（如播放量 100 但点赞 10 万），标记为可疑`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "请分析这张平台后台数据截屏，提取关键指针：" },
            {
              type: "image_url",
              image_url: { url: screenshotUrl, detail: "high" },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content as string);
    return {
      playCount: Number(result.playCount) || 0,
      likeCount: Number(result.likeCount) || 0,
      commentCount: Number(result.commentCount) || 0,
      shareCount: Number(result.shareCount) || 0,
      confidence: Number(result.confidence) || 0,
      rawText: String(result.rawText || ""),
      isSuspicious: Boolean(result.isSuspicious),
      suspiciousReason: result.suspiciousReason || undefined,
    };
  } catch (error) {
    console.error("[VideoSubmission] AI screenshot analysis failed:", error);
    return {
      playCount: 0,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      confidence: 0,
      rawText: "",
      isSuspicious: true,
      suspiciousReason: "AI 分析失败，需人工复审",
    };
  }
}

// ─── AI 爆款评分 ──────────────────────────────────────
interface ScoreInput {
  title: string;
  description: string;
  platformData: Array<{
    platform: string;
    playCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
  }>;
  platformCount: number;
}

async function aiViralScore(input: ScoreInput): Promise<{
  totalScore: number;
  dimensions: {
    playVolume: { score: number; weight: number; detail: string };
    engagement: { score: number; weight: number; detail: string };
    contentQuality: { score: number; weight: number; detail: string };
    distribution: { score: number; weight: number; detail: string };
  };
  summary: string;
  highlights: string[];
  improvements: string[];
}> {
  // 计算聚合数据
  const totalPlays = input.platformData.reduce((s, p) => s + p.playCount, 0);
  const totalLikes = input.platformData.reduce((s, p) => s + p.likeCount, 0);
  const totalComments = input.platformData.reduce((s, p) => s + p.commentCount, 0);
  const totalShares = input.platformData.reduce((s, p) => s + p.shareCount, 0);

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位资深的短视频运营专家和数据分析师。请根据视频的多平台数据表现，给出爆款评分（0-100 分）。

## 评分维度和权重

### 1. 播放量级别（30% 权重）
- 90-100 分：总播放量 > 100 万
- 80-89 分：总播放量 50 万 - 100 万
- 70-79 分：总播放量 10 万 - 50 万
- 60-69 分：总播放量 5 万 - 10 万
- 50-59 分：总播放量 1 万 - 5 万
- 40-49 分：总播放量 5000 - 1 万
- 30-39 分：总播放量 1000 - 5000
- 20-29 分：总播放量 < 1000

### 2. 交互率（25% 权重）
交互率 = (点赞 + 评论 + 分享) / 播放量
- 90-100 分：交互率 > 15%
- 80-89 分：交互率 10% - 15%
- 70-79 分：交互率 5% - 10%
- 60-69 分：交互率 3% - 5%
- 50-59 分：交互率 1% - 3%
- 40 分以下：交互率 < 1%

### 3. 内容质量（25% 权重）
根据标题、描述和数据比例综合判断：
- 点赞/播放比（反映内容吸引力）
- 评论/播放比（反映内容话题性）
- 分享/播放比（反映内容传播力）
- 标题和描述的专业度

### 4. 平台分发广度（20% 权重）
- 90-100 分：4 个平台都有发布
- 80-89 分：3 个平台
- 60-79 分：2 个平台
- 40-59 分：1 个平台

## 输出 JSON 格式
{
  "totalScore": 总分（0-100），
  "dimensions": {
    "playVolume": { "score": 分数, "weight": 0.30, "detail": "说明" },
    "engagement": { "score": 分数, "weight": 0.25, "detail": "说明" },
    "contentQuality": { "score": 分数, "weight": 0.25, "detail": "说明" },
    "distribution": { "score": 分数, "weight": 0.20, "detail": "说明" }
  },
  "summary": "整体评价（2-3 句话）",
  "highlights": ["亮点1", "亮点2"],
  "improvements": ["改进建议1", "改进建议2"]
}`,
      },
      {
        role: "user",
        content: `请评估以下视频的爆款潜力：

标题：${input.title}
描述：${input.description || "无"}

多平台数据：
${input.platformData
  .map(
    (p) =>
      `- ${p.platform}: 播放量 ${p.playCount}, 点赞 ${p.likeCount}, 评论 ${p.commentCount}, 分享 ${p.shareCount}`
  )
  .join("\n")}

聚合数据：
- 总播放量：${totalPlays}
- 总点赞数：${totalLikes}
- 总评论数：${totalComments}
- 总分享数：${totalShares}
- 交互率：${totalPlays > 0 ? (((totalLikes + totalComments + totalShares) / totalPlays) * 100).toFixed(2) : 0}%
- 发布平台数：${input.platformCount}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(response.choices[0].message.content as string);

  return {
    totalScore: Math.min(100, Math.max(0, Math.round(Number(result.totalScore) || 0))),
    dimensions: result.dimensions,
    summary: result.summary || "",
    highlights: result.highlights || [],
    improvements: result.improvements || [],
  };
}

// ─── 计算 Credits 奖励 ──────────────────────────────
function calculateReward(score: number): number {
  if (score >= 90) return 80;
  if (score >= 80) return 30;
  return 0;
}

// ─── Router ──────────────────────────────────────────
export const videoSubmissionRouter = router({
  // ═══════════════════════════════════════════════════
  // 实名认证相关
  // ═══════════════════════════════════════════════════

  /** 获取用户实名认证状态 */
  getVerificationStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { verified: false, status: null };

    const userId = ctx.user.id;
    const rows = await db
      .select()
      .from(userVerifications)
      .where(eq(userVerifications.userId, userId))
      .limit(1);

    if (rows.length === 0) return { verified: false, status: null };

    return {
      verified: rows[0].status === "approved",
      status: rows[0].status,
      realName: rows[0].realName,
      submittedAt: rows[0].createdAt,
      reviewedAt: rows[0].reviewedAt,
      adminNotes: rows[0].status === "rejected" ? rows[0].adminNotes : undefined,
    };
  }),

  /** 提交实名认证 */
  submitVerification: protectedProcedure
    .input(
      z.object({
        realName: z.string().min(2, "请输入真实姓名"),
        idNumber: z.string().min(15, "请输入有效的身份证号码"),
        idFrontUrl: z.string().url("请上传身份证正面照片"),
        idBackUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const userId = ctx.user.id;

      // 检查是否已提交
      const existing = await db
        .select()
        .from(userVerifications)
        .where(eq(userVerifications.userId, userId))
        .limit(1);

      if (existing.length > 0 && existing[0].status === "approved") {
        return { success: false, error: "您已完成实名认证" };
      }

      // 身份证号码脱敏（只保留后 4 位）
      const masked = "****" + input.idNumber.slice(-4);

      if (existing.length > 0) {
        // 更新已有记录
        await db
          .update(userVerifications)
          .set({
            realName: input.realName,
            idNumberMasked: masked,
            idFrontUrl: input.idFrontUrl,
            idBackUrl: input.idBackUrl || null,
            status: "pending",
            adminNotes: null,
            reviewedAt: null,
          })
          .where(eq(userVerifications.userId, userId));
      } else {
        await db.insert(userVerifications).values({
          userId,
          realName: input.realName,
          idNumberMasked: masked,
          idFrontUrl: input.idFrontUrl,
          idBackUrl: input.idBackUrl || null,
          status: "pending",
        });
      }

      // AI 自动审核身份证照片
      try {
        const aiResult = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一个身份验证审核员。请查看这张身份证照片，判断：
1. 是否为有效的身份证照片（不是截屏、不是 PS）
2. 照片是否清晰可辨
3. 是否能看到姓名和部分证件号码

请以 JSON 格式返回：
{
  "isValid": true/false,
  "confidence": 0-1,
  "reason": "判断原因"
}`,
            },
            {
              role: "user",
              content: [
                { type: "text", text: "请验证这张身份证照片的真实性：" },
                {
                  type: "image_url",
                  image_url: { url: input.idFrontUrl, detail: "high" },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        });

        const aiVerify = JSON.parse(aiResult.choices[0].message.content as string);

        if (aiVerify.isValid && aiVerify.confidence > 0.7) {
          // AI 判定有效，自动通过
          await db
            .update(userVerifications)
            .set({
              status: "approved",
              reviewedAt: new Date(),
              adminNotes: `AI 自动审核通过（置信度: ${(aiVerify.confidence * 100).toFixed(0)}%）`,
            })
            .where(eq(userVerifications.userId, userId));

          return { success: true, autoApproved: true };
        } else {
          // AI 判定不确定，转人工
          await db
            .update(userVerifications)
            .set({
              adminNotes: `AI 审核结果: ${aiVerify.reason}（置信度: ${(aiVerify.confidence * 100).toFixed(0)}%），需人工复审`,
            })
            .where(eq(userVerifications.userId, userId));

          return { success: true, autoApproved: false, message: "已提交，等待审核" };
        }
      } catch {
        // AI 审核失败，转人工
        return { success: true, autoApproved: false, message: "已提交，等待审核" };
      }
    }),

  // ═══════════════════════════════════════════════════
  // 视频上传 + AI 自动审核 + Credits 自动发放
  // ═══════════════════════════════════════════════════

  /** 提交视频（含平台链接和数据截屏） */
  submitVideo: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, "请输入视频标题").max(255),
        description: z.string().optional(),
        videoUrl: z.string().url("请上传视频文档"),
        thumbnailUrl: z.string().url().optional(),
        category: z.string().optional(),
        /** 平台发布记录（至少一个） */
        platformLinks: z
          .array(
            z.object({
              platform: z.enum(["douyin", "weixin_channels", "xiaohongshu", "bilibili"]),
              videoLink: z.string().url("请输入有效的视频链接"),
              dataScreenshotUrl: z.string().url("请上传后台数据截屏"),
            })
          )
          .min(1, "至少需要在一个平台发布"),
        /** 必须同意平台授权协议 */
        licenseAgreed: z.boolean().refine((v) => v === true, {
          message: "必须同意平台授权协议才能提交",
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const userId = ctx.user.id;

      // ── 1. 验证实名认证 ──────────────────────────
      const verification = await db
        .select()
        .from(userVerifications)
        .where(
          and(
            eq(userVerifications.userId, userId),
            eq(userVerifications.status, "approved")
          )
        )
        .limit(1);

      if (verification.length === 0) {
        return {
          success: false,
          error: "请先完成实名认证后再上传视频",
          errorCode: "NOT_VERIFIED",
        };
      }

      // ── 2. 验证平台链接格式 ─────────────────────
      for (const link of input.platformLinks) {
        if (!validatePlatformUrl(link.platform, link.videoLink)) {
          const platformNames: Record<string, string> = {
            douyin: "抖音",
            weixin_channels: "视频号",
            xiaohongshu: "小红书",
            bilibili: "B站",
          };
          return {
            success: false,
            error: `「${platformNames[link.platform]}」的视频链接格式不正确，请提供正确的平台链接`,
            errorCode: "INVALID_LINK",
          };
        }
      }

      // ── 3. 去重检测 ─────────────────────────────
      // 基于视频 URL 生成指纹
      const fingerprint = crypto
        .createHash("sha256")
        .update(input.videoUrl)
        .digest("hex")
        .substring(0, 64);

      const duplicates = await db
        .select()
        .from(videoSubmissions)
        .where(eq(videoSubmissions.contentFingerprint, fingerprint))
        .limit(1);

      if (duplicates.length > 0) {
        return {
          success: false,
          error: "此视频已提交过，同一视频多平台分发只计算一次",
          errorCode: "DUPLICATE",
        };
      }

      // ── 4. 创建视频记录 ─────────────────────────
      const insertResult = await db.insert(videoSubmissions).values({
        userId,
        title: input.title,
        description: input.description || null,
        videoUrl: input.videoUrl,
        thumbnailUrl: input.thumbnailUrl || null,
        category: input.category || null,
        contentFingerprint: fingerprint,
        scoreStatus: "scoring",
        licenseAgreed: 1,
        licenseVersion: "1.0",
        licenseAgreedAt: new Date(),
      });

      const videoId = insertResult[0].insertId;

      // ── 5. AI 分析所有平台数据截屏 ──────────────
      const platformResults: Array<{
        platform: string;
        playCount: number;
        likeCount: number;
        commentCount: number;
        shareCount: number;
        isSuspicious: boolean;
        suspiciousReason?: string;
      }> = [];

      let hasSuspicious = false;

      for (const link of input.platformLinks) {
        // AI 读取数据截屏
        const aiData = await aiReadDataScreenshot(link.dataScreenshotUrl);

        if (aiData.isSuspicious) {
          hasSuspicious = true;
        }

        // 保存平台记录
        await db.insert(videoPlatformLinks).values({
          videoSubmissionId: videoId,
          platform: link.platform,
          videoLink: link.videoLink,
          dataScreenshotUrl: link.dataScreenshotUrl,
          playCount: aiData.playCount,
          likeCount: aiData.likeCount,
          commentCount: aiData.commentCount,
          shareCount: aiData.shareCount,
          verifyStatus: aiData.isSuspicious ? "pending" : "verified",
          verifyNotes: aiData.isSuspicious
            ? `AI 检测到可疑: ${aiData.suspiciousReason}`
            : `AI 自动验证（置信度: ${(aiData.confidence * 100).toFixed(0)}%）`,
        });

        platformResults.push({
          platform: link.platform,
          playCount: aiData.playCount,
          likeCount: aiData.likeCount,
          commentCount: aiData.commentCount,
          shareCount: aiData.shareCount,
          isSuspicious: aiData.isSuspicious,
          suspiciousReason: aiData.suspiciousReason,
        });
      }

      // ── 6. 如果有可疑数据，标记为待人工复审 ─────
      if (hasSuspicious) {
        await db
          .update(videoSubmissions)
          .set({
            scoreStatus: "pending",
            adminNotes: "AI 检测到数据截屏可疑，需人工复审",
          })
          .where(eq(videoSubmissions.id, videoId));

        return {
          success: true,
          videoId,
          status: "pending_review",
          message: "视频已提交，部分数据需要人工复审，请耐心等待",
          platformResults,
        };
      }

      // ── 7. 多帧视频分析 + AI 爆款评分（异步运行） ─────
      // 初始化进度追踪
      analysisProgress.set(videoId, {
        stage: "queued",
        progress: 0,
        detail: "视频已提交，准备开始分析...",
        completed: false,
      });

      // 异步运行多帧分析（不阻塞返回）
      (async () => {
        try {
          const progressCb: ProgressCallback = (stage, progress, detail) => {
            const current = analysisProgress.get(videoId);
            const frameData = current?.frameAnalyses || [];
            analysisProgress.set(videoId, {
              stage,
              progress,
              detail: detail || "",
              frameAnalyses: frameData,
              completed: false,
            });
          };

          // 多帧分析（根据视频时长动态决定抽帧数和去除策略）
          const multiFrameResult = await analyzeVideoMultiFrame(
            input.videoUrl,
            (stage, progress, detail) => {
              progressCb(stage, progress, detail);
              // 记录已分析的帧图片
              if (stage === "analyzing") {
                const current = analysisProgress.get(videoId);
                if (current && multiFrameResult) {
                  // Will be updated after completion
                }
              }
            }
          );

          // 更新进度：帧分析完成，开始数据评分
          analysisProgress.set(videoId, {
            stage: "data_scoring",
            progress: 50,
            detail: "视觉分析完成，正在结合平台数据计算最终评分...",
            frameAnalyses: multiFrameResult.frameAnalyses.map(f => ({
              frameIndex: f.frameIndex,
              timestamp: f.timestamp,
              imageUrl: f.imageUrl,
            })),
            completed: false,
          });

          // 平台数据评分
          const dataScoreResult = await aiViralScore({
            title: input.title,
            description: input.description || "",
            platformData: platformResults,
            platformCount: input.platformLinks.length,
          });

          // 综合评分：视觉分析 40% + 平台数据 60%
          const visualWeight = 0.40;
          const dataWeight = 0.60;
          const finalScore = Math.min(100, Math.max(0, Math.round(
            multiFrameResult.overallVisualScore * visualWeight +
            dataScoreResult.totalScore * dataWeight
          )));

          // 合并评分详情
          const combinedDetails = {
            finalScore,
            visualAnalysis: {
              score: multiFrameResult.overallVisualScore,
              weight: visualWeight,
              dimensions: multiFrameResult.dimensionScores,
              frameCount: multiFrameResult.extractedFrames,
              scoringStrategy: multiFrameResult.scoringStrategy,
              videoDuration: multiFrameResult.videoDuration,
              summary: multiFrameResult.summary,
              highlights: multiFrameResult.highlights,
              improvements: multiFrameResult.improvements,
              frameAnalyses: multiFrameResult.frameAnalyses,
            },
            dataAnalysis: {
              score: dataScoreResult.totalScore,
              weight: dataWeight,
              dimensions: dataScoreResult.dimensions,
              summary: dataScoreResult.summary,
              highlights: dataScoreResult.highlights,
              improvements: dataScoreResult.improvements,
            },
          };

          // 计算奖励
          const reward = calculateReward(finalScore);

          // 更新数据库
          await db
            .update(videoSubmissions)
            .set({
              viralScore: finalScore,
              scoreDetails: JSON.stringify(combinedDetails),
              scoreStatus: "scored",
              creditsRewarded: reward,
              rewardedAt: reward > 0 ? new Date() : null,
              showcaseStatus: reward > 0 ? "showcased" : "private",
            })
            .where(eq(videoSubmissions.id, videoId));

          // 发放 Credits
          if (reward > 0) {
            await addCredits(userId, reward, "bonus");
          }

          // 标记完成
          const strat = multiFrameResult.scoringStrategy;
          analysisProgress.set(videoId, {
            stage: "completed",
            progress: 100,
            detail: reward > 0
              ? `恭喜！您的视频获得 ${finalScore} 分，获得 ${reward} Credits 奖励！（抽取${strat.totalExtracted}帧，去除最低${strat.droppedCount}帧，以${strat.scoringFrames}帧均分计算）`
              : `您的视频获得 ${finalScore} 分。80 分以上可获得 Credits 奖励，继续加油！（抽取${strat.totalExtracted}帧，去除最低${strat.droppedCount}帧，以${strat.scoringFrames}帧均分计算）`,
            frameAnalyses: multiFrameResult.frameAnalyses.map(f => ({
              frameIndex: f.frameIndex,
              timestamp: f.timestamp,
              imageUrl: f.imageUrl,
              dropped: f.dropped,
              frameScore: f.frameScore,
            })),
            completed: true,
          });

          // 5 分钟后清理进度数据
          setTimeout(() => analysisProgress.delete(videoId), 5 * 60 * 1000);

        } catch (error) {
          console.error(`[VideoSubmission] Multi-frame analysis failed for video ${videoId}:`, error);
          analysisProgress.set(videoId, {
            stage: "error",
            progress: 0,
            detail: "分析过程中出现错误，已转为人工复审",
            completed: true,
            error: String(error),
          });

          // 标记为待人工复审
          await db
            .update(videoSubmissions)
            .set({
              scoreStatus: "pending",
              adminNotes: `多帧分析失败: ${String(error)}`,
            })
            .where(eq(videoSubmissions.id, videoId));
        }
      })();

      // 立即返回，前端通过轮询获取进度
      return {
        success: true,
        videoId,
        status: "analyzing",
        message: "视频已提交，AI 正在进行多帧深度分析（10-12 帧），请稍候...",
        platformResults,
      };
    }),

  /** 获取分析进度（轮询用） */
  getAnalysisProgress: protectedProcedure
    .input(z.object({ videoId: z.number() }))
    .query(async ({ ctx, input }) => {
      // 先查内存中的进度
      const memProgress = analysisProgress.get(input.videoId);
      if (memProgress) {
        return memProgress;
      }

      // 如果内存中没有，查数据库
      const db = await getDb();
      if (!db) return { stage: "unknown", progress: 0, detail: "", completed: false };

      const video = await db
        .select()
        .from(videoSubmissions)
        .where(
          and(
            eq(videoSubmissions.id, input.videoId),
            eq(videoSubmissions.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (video.length === 0) {
        return { stage: "not_found", progress: 0, detail: "视频不存在", completed: true, error: "not_found" };
      }

      const v = video[0];
      if (v.scoreStatus === "scored") {
        const details = v.scoreDetails ? JSON.parse(v.scoreDetails as string) : null;
        return {
          stage: "completed",
          progress: 100,
          detail: v.creditsRewarded && v.creditsRewarded > 0
            ? `恭喜！您的视频获得 ${v.viralScore} 分，获得 ${v.creditsRewarded} Credits 奖励！`
            : `您的视频获得 ${v.viralScore} 分。80 分以上可获得 Credits 奖励，继续加油！`,
          completed: true,
          score: v.viralScore,
          creditsRewarded: v.creditsRewarded,
          scoreDetails: details,
          frameAnalyses: details?.visualAnalysis?.frameAnalyses?.map((f: any) => ({
            frameIndex: f.frameIndex,
            timestamp: f.timestamp,
            imageUrl: f.imageUrl,
          })) || [],
        };
      }

      if (v.scoreStatus === "pending") {
        return {
          stage: "pending_review",
          progress: 0,
          detail: v.adminNotes || "需要人工复审",
          completed: true,
        };
      }

      return {
        stage: "scoring",
        progress: 30,
        detail: "正在分析中...",
        completed: false,
      };
    }),

  // ═══════════════════════════════════════════════════
  // 查找相关
  // ═══════════════════════════════════════════════════

  /** 获取用户的视频列表 */
  getMyVideos: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { videos: [], total: 0 };

      const userId = ctx.user.id;

      const videos = await db
        .select()
        .from(videoSubmissions)
        .where(eq(videoSubmissions.userId, userId))
        .orderBy(desc(videoSubmissions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(videoSubmissions)
        .where(eq(videoSubmissions.userId, userId));

      // 获取每个视频的平台链接
      const videosWithLinks = await Promise.all(
        videos.map(async (v) => {
          const links = await db
            .select()
            .from(videoPlatformLinks)
            .where(eq(videoPlatformLinks.videoSubmissionId, v.id));
          return { ...v, platformLinks: links };
        })
      );

      return {
        videos: videosWithLinks,
        total: countResult[0]?.count ?? 0,
      };
    }),

  /** 获取单个视频详情 */
  getVideoDetail: protectedProcedure
    .input(z.object({ videoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const video = await db
        .select()
        .from(videoSubmissions)
        .where(
          and(
            eq(videoSubmissions.id, input.videoId),
            eq(videoSubmissions.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (video.length === 0) return null;

      const links = await db
        .select()
        .from(videoPlatformLinks)
        .where(eq(videoPlatformLinks.videoSubmissionId, input.videoId));

      return { ...video[0], platformLinks: links };
    }),

  // ═══════════════════════════════════════════════════
  // 平台展厅（公开展示获奖视频）
  // ═══════════════════════════════════════════════════

  /** 获取展厅视频（公开） */
  getShowcaseVideos: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
        sortBy: z.enum(["score", "latest", "views"]).default("score"),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { videos: [], total: 0 };

      const orderByMap = {
        score: desc(videoSubmissions.viralScore),
        latest: desc(videoSubmissions.createdAt),
        views: desc(videoSubmissions.viewCount),
      };

      const videos = await db
        .select({
          id: videoSubmissions.id,
          title: videoSubmissions.title,
          description: videoSubmissions.description,
          thumbnailUrl: videoSubmissions.thumbnailUrl,
          viralScore: videoSubmissions.viralScore,
          viewCount: videoSubmissions.viewCount,
          likeCount: videoSubmissions.likeCount,
          createdAt: videoSubmissions.createdAt,
          userId: videoSubmissions.userId,
        })
        .from(videoSubmissions)
        .where(eq(videoSubmissions.showcaseStatus, "showcased"))
        .orderBy(orderByMap[input.sortBy])
        .limit(input.limit)
        .offset(input.offset);

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(videoSubmissions)
        .where(eq(videoSubmissions.showcaseStatus, "showcased"));

      // 获取用户名
      const videosWithUser = await Promise.all(
        videos.map(async (v) => {
          const user = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, v.userId))
            .limit(1);
          return {
            ...v,
            userName: user[0]?.name || "匿名用户",
          };
        })
      );

      return {
        videos: videosWithUser,
        total: countResult[0]?.count ?? 0,
      };
    }),

  // ═══════════════════════════════════════════════════
  // 管理员功能
  // ═══════════════════════════════════════════════════

  /** 管理员：获取待审核的实名认证 */
  adminGetPendingVerifications: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");

    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select()
      .from(userVerifications)
      .where(eq(userVerifications.status, "pending"))
      .orderBy(desc(userVerifications.createdAt));

    return rows;
  }),

  /** 管理员：审核实名认证 */
  adminReviewVerification: protectedProcedure
    .input(
      z.object({
        verificationId: z.number(),
        action: z.enum(["approve", "reject"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(userVerifications)
        .set({
          status: input.action === "approve" ? "approved" : "rejected",
          reviewedAt: new Date(),
          adminNotes: input.notes || null,
        })
        .where(eq(userVerifications.id, input.verificationId));

      return { success: true };
    }),

  /** 管理员：获取待复审的视频 */
  adminGetPendingVideos: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");

    const db = await getDb();
    if (!db) return [];

    const videos = await db
      .select()
      .from(videoSubmissions)
      .where(eq(videoSubmissions.scoreStatus, "pending"))
      .orderBy(desc(videoSubmissions.createdAt));

    const videosWithLinks = await Promise.all(
      videos.map(async (v) => {
        const links = await db
          .select()
          .from(videoPlatformLinks)
          .where(eq(videoPlatformLinks.videoSubmissionId, v.id));
        const user = await db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, v.userId))
          .limit(1);
        return { ...v, platformLinks: links, user: user[0] || null };
      })
    );

    return videosWithLinks;
  }),

  /** 管理员：手动评分并发放 Credits */
  adminScoreVideo: protectedProcedure
    .input(
      z.object({
        videoId: z.number(),
        score: z.number().min(0).max(100),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const video = await db
        .select()
        .from(videoSubmissions)
        .where(eq(videoSubmissions.id, input.videoId))
        .limit(1);

      if (video.length === 0) throw new Error("Video not found");

      const reward = calculateReward(input.score);

      await db
        .update(videoSubmissions)
        .set({
          viralScore: input.score,
          scoreStatus: "scored",
          creditsRewarded: reward,
          rewardedAt: reward > 0 ? new Date() : null,
          showcaseStatus: reward > 0 ? "showcased" : "private",
          adminNotes: input.notes || `管理员手动评分: ${input.score} 分`,
        })
        .where(eq(videoSubmissions.id, input.videoId));

      // 发放 Credits
      if (reward > 0) {
        await addCredits(video[0].userId, reward, "bonus");
      }

      return {
        success: true,
        score: input.score,
        reward,
        message: reward > 0
          ? `已评分 ${input.score} 分，发放 ${reward} Credits`
          : `已评分 ${input.score} 分，未达奖励门槛`,
      };
    }),

  /** 上传文档（视频、截屏、身份证照片等） */
  uploadFile: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
        folder: z.enum(["id-photos", "data-screenshots", "videos", "thumbnails"]),
      })
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("mp4") ? "mp4" : "jpg";
      const filename = `${input.folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { url } = await storagePut(filename, buffer, input.mimeType);
      return { url };
    }),

  /** 获取授权协议文本 */
  getLicenseAgreement: protectedProcedure.query(() => {
    return {
      version: "1.0",
      title: "MV Studio Pro 爆款视频奖励计划 — 平台授权协议",
      content: `
## MV Studio Pro 爆款视频奖励计划 — 平台授权协议

### 一、奖励规则

1. 用户上传的视频经 AI 评分后，根据分数获得 Credits 奖励：
   - **80-89 分**：奖励 **30 Credits**
   - **90-100 分**：奖励 **80 Credits**
   - **80 分以下**：无奖励

### 二、上传条件

1. 用户必须已完成 **实名认证**
2. 视频必须已在以下至少一个平台发布：**抖音、视频号、小红书、B站**
3. 必须提供 **平台后台数据截屏**（播放量、点赞数等）
4. 必须提供 **视频发布链接**
5. 同一视频在多平台分发，**仅计算一次**

### 三、平台授权条款

**当用户的视频获得 Credits 奖励（即评分达到 80 分及以上）后：**

1. 用户授予 MV Studio Pro 平台对该视频的 **非独家、永久、全球范围** 的使用权
2. 平台有权 **无偿展示** 该视频（包括但不限于平台展厅、推广页面、社交媒体等）
3. 平台有权对该视频进行 **二次开发**（包括但不限于剪辑、配音、添加特效、制作教学素材等）
4. 上述展示和二次开发 **无需另行告知原作者**
5. 原作者仍保留视频的 **原始著作权**，可继续在其他平台使用

### 四、数据真实性

1. 用户保证上传的数据截屏和视频链接 **真实有效**
2. 如发现数据造假，平台有权 **撤销奖励** 并追回已发放的 Credits
3. 严重造假行为将导致 **帐号封禁**

### 五、其他

1. 本协议自用户勾选同意之日起生效
2. MV Studio Pro 保留对本协议的最终解释权
3. 如有争议，以中华人民共和国法律为准
      `.trim(),
      lastUpdated: "2026-02-18",
    };
  }),
});

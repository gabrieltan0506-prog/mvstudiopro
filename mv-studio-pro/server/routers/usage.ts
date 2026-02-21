import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  checkUsageLimit,
  incrementUsageCount,
  hasActiveStudentSubscription,
  getOrCreateUsageTracking,
  getStudentSubscriptionByUserId,
} from "../db-extended";
import { STUDENT_PLANS } from "../plans";

// Re-export incrementUsageCount for use in other routers
export { incrementUsageCount };

export const usageRouter = router({
  // Check if user can use a feature (based on free tier limits or active subscription)
  checkFeatureAccess: protectedProcedure
    .input(
      z.object({
        featureType: z.enum(["storyboard", "analysis", "avatar", "idol3D", "videoGeneration"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // ─── 管理员无限使用权限 ───────────────────────
      if (ctx.user.role === "admin") {
        return {
          allowed: true,
          reason: "admin_unlimited",
          currentCount: 0,
          limit: -1,
          requiresPayment: false,
        };
      }

      // Check for expired trial first (block new creation, allow viewing)
      const expiredTrialSub = await getStudentSubscriptionByUserId(userId);
      if (expiredTrialSub && expiredTrialSub.subscriptionType === "trial" && expiredTrialSub.endDate) {
        const now = new Date();
        if (now > expiredTrialSub.endDate) {
          return {
            allowed: false,
            reason: "trial_expired",
            currentCount: 0,
            limit: 0,
            requiresPayment: true,
            isTrial: true,
            trialExpired: true,
            planName: "student_trial",
          };
        }
      }

      // Check if user has active student subscription (with plan-based limits)
      const hasSubscription = await hasActiveStudentSubscription(userId);
      if (hasSubscription) {
        const sub = await getStudentSubscriptionByUserId(userId);
        const isTrial = sub?.subscriptionType === "trial";
        const planKey = isTrial
          ? "student_trial"
          : sub?.subscriptionType === "halfYear"
            ? "student_6months"
            : "student_1year";
        const planLimits = STUDENT_PLANS[planKey].limits;

        // Map feature type to plan limit field
        const limitMap: Record<string, number> = {
          analysis: planLimits.mvAnalysis,
          storyboard: planLimits.storyboard,
          avatar: planLimits.idolGeneration,
          idol3D: planLimits.idol3D,
          videoGeneration: planLimits.videoGeneration,
        };
        const featureLimit = limitMap[input.featureType] ?? 0;

        // -1 means unlimited
        if (featureLimit === -1) {
          return {
            allowed: true,
            reason: "student_subscription",
            currentCount: 0,
            limit: -1,
            requiresPayment: false,
            isTrial,
            planName: planKey,
          };
        }

        // 0 means not available on this plan
        if (featureLimit === 0) {
          return {
            allowed: false,
            reason: "student_plan_limit",
            currentCount: 0,
            limit: 0,
            requiresPayment: true,
            isTrial,
            planName: planKey,
          };
        }

        // Check usage against plan limit
        const usage = await getOrCreateUsageTracking(userId, input.featureType as any);
        const currentCount = usage.usageCount ?? 0;
        if (currentCount < featureLimit) {
          return {
            allowed: true,
            reason: "student_subscription",
            currentCount,
            limit: featureLimit,
            requiresPayment: false,
            isTrial,
            planName: planKey,
          };
        }

        return {
          allowed: false,
          reason: "student_plan_exceeded",
          currentCount,
          limit: featureLimit,
          requiresPayment: true,
          isTrial,
          planName: planKey,
        };
      }

      // ─── idol3D 仅限 Pro 以上方案 ────────────────
      if (input.featureType === "idol3D") {
        // idol3D 不在免费额度中，需要 Pro 以上方案
        return {
          allowed: false,
          reason: "pro_required",
          currentCount: 0,
          limit: 0,
          requiresPayment: true,
        };
      }

      // Check free tier limits
      const usageCheck = await checkUsageLimit(userId, input.featureType);

      if (usageCheck.allowed) {
        return {
          allowed: true,
          reason: "free_tier",
          currentCount: usageCheck.currentCount,
          limit: usageCheck.limit,
          requiresPayment: false,
        };
      }

      // User has exceeded free tier and needs to pay
      return {
        allowed: false,
        reason: "exceeded_free_tier",
        currentCount: usageCheck.currentCount,
        limit: usageCheck.limit,
        requiresPayment: true,
      };
    }),

  // Record feature usage (called after successful generation)
  recordUsage: protectedProcedure
    .input(
      z.object({
        featureType: z.enum(["storyboard", "analysis", "avatar", "idol3D", "videoGeneration"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // 管理员不记录使用次数
      if (ctx.user.role === "admin") {
        return {
          success: true,
          message: "Usage recorded (admin unlimited)",
          newCount: 0,
        };
      }

      // Check if user has active student subscription - still record usage for limit tracking
      const hasSubscription = await hasActiveStudentSubscription(userId);
      if (hasSubscription) {
        // Student plans now have limits, so we DO increment usage
        const newCount = await incrementUsageCount(userId, input.featureType as "storyboard" | "analysis" | "avatar");
        return {
          success: true,
          message: "Usage recorded (student subscription)",
          newCount,
        };
      }

      // idol3D 不走免费额度系统
      if (input.featureType === "idol3D") {
        return { success: true, message: "Usage recorded (idol3D)", newCount: 0 };
      }

      // Increment usage count
      const newCount = await incrementUsageCount(userId, input.featureType as "storyboard" | "analysis" | "avatar");

      return {
        success: true,
        message: "Usage recorded",
        newCount,
      };
    }),

  // Get current usage stats for all features
  getUsageStats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    // ─── 管理员显示无限 ────────────────────────────
    if (ctx.user.role === "admin") {
      return {
        hasSubscription: true,
        isAdmin: true,
        features: {
          storyboard: { currentCount: 0, limit: -1, remaining: -1 },
          analysis: { currentCount: 0, limit: -1, remaining: -1 },
          avatar: { currentCount: 0, limit: -1, remaining: -1 },
          idol3D: { currentCount: 0, limit: -1, remaining: -1 },
          videoGeneration: { currentCount: 0, limit: -1, remaining: -1 },
        },
      };
    }

    // Check if user has active student subscription
    const hasSubscription = await hasActiveStudentSubscription(userId);

    // Also check for expired trial (to show view-only mode)
    if (!hasSubscription) {
      const expiredSub = await getStudentSubscriptionByUserId(userId);
      if (expiredSub && expiredSub.subscriptionType === "trial" && expiredSub.endDate) {
        const now = new Date();
        if (now > expiredSub.endDate) {
          // Trial expired - return data with trialExpired flag for view-only mode
          return {
            hasSubscription: false,
            isAdmin: false,
            isTrial: true,
            trialExpired: true,
            trialEndDate: expiredSub.endDate.toISOString(),
            studentPlan: "student_trial",
            features: {
              storyboard: { currentCount: 0, limit: 0, remaining: 0 },
              analysis: { currentCount: 0, limit: 0, remaining: 0 },
              avatar: { currentCount: 0, limit: 0, remaining: 0 },
              idol3D: { currentCount: 0, limit: 0, remaining: 0 },
              videoGeneration: { currentCount: 0, limit: 0, remaining: 0 },
            },
          };
        }
      }
    }

    if (hasSubscription) {
      const sub = await getStudentSubscriptionByUserId(userId);
      const planKey = sub?.subscriptionType === "trial"
        ? "student_trial"
        : sub?.subscriptionType === "halfYear"
          ? "student_6months"
          : "student_1year";
      const planLimits = STUDENT_PLANS[planKey].limits;
      const planConfig = STUDENT_PLANS[planKey];

      const storyboard = await getOrCreateUsageTracking(userId, "storyboard");
      const analysis = await getOrCreateUsageTracking(userId, "analysis");
      const avatar = await getOrCreateUsageTracking(userId, "avatar");

      return {
        hasSubscription: true,
        isAdmin: false,
        isTrial: sub?.subscriptionType === "trial",
        trialEndDate: sub?.subscriptionType === "trial" ? sub?.endDate?.toISOString() : undefined,
        maxVideoResolution: planConfig.restrictions?.maxVideoResolution,
        studentPlan: planKey,
        features: {
          storyboard: {
            currentCount: storyboard.usageCount ?? 0,
            limit: planLimits.storyboard,
            remaining: planLimits.storyboard === -1 ? -1 : Math.max(0, planLimits.storyboard - (storyboard.usageCount ?? 0)),
          },
          analysis: {
            currentCount: analysis.usageCount ?? 0,
            limit: planLimits.mvAnalysis,
            remaining: planLimits.mvAnalysis === -1 ? -1 : Math.max(0, planLimits.mvAnalysis - (analysis.usageCount ?? 0)),
          },
          avatar: {
            currentCount: avatar.usageCount ?? 0,
            limit: planLimits.idolGeneration,
            remaining: planLimits.idolGeneration === -1 ? -1 : Math.max(0, planLimits.idolGeneration - (avatar.usageCount ?? 0)),
          },
          idol3D: {
            currentCount: 0,
            limit: planLimits.idol3D,
            remaining: planLimits.idol3D,
          },
          videoGeneration: {
            currentCount: 0,
            limit: planLimits.videoGeneration,
            remaining: planLimits.videoGeneration,
          },
        },
      };
    }

    // Get usage for each feature
    const storyboard = await getOrCreateUsageTracking(userId, "storyboard");
    const analysis = await getOrCreateUsageTracking(userId, "analysis");
    const avatar = await getOrCreateUsageTracking(userId, "avatar");

    const limits = {
      storyboard: 1,
      analysis: 2,
      avatar: 3,
    };

    return {
      hasSubscription: false,
      isAdmin: false,
      features: {
        storyboard: {
          currentCount: storyboard.usageCount ?? 0,
          limit: limits.storyboard,
          remaining: Math.max(0, limits.storyboard - (storyboard.usageCount ?? 0)),
        },
        analysis: {
          currentCount: analysis.usageCount ?? 0,
          limit: limits.analysis,
          remaining: Math.max(0, limits.analysis - (analysis.usageCount ?? 0)),
        },
        avatar: {
          currentCount: avatar.usageCount ?? 0,
          limit: limits.avatar,
          remaining: Math.max(0, limits.avatar - (avatar.usageCount ?? 0)),
        },
        idol3D: {
          currentCount: 0,
          limit: 0,
          remaining: 0,
        },
        videoGeneration: {
          currentCount: 0,
          limit: 0,
          remaining: 0,
        },
      },
    };
  }),
});

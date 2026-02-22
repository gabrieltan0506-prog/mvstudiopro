import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createOrUpdateStudentVerification,
  getStudentVerificationByUserId,
  updateStudentVerificationStatus,
  createStudentSubscription,
  getStudentSubscriptionByUserId,
  hasActiveStudentSubscription,
  updateStudentSubscriptionStatus,
  deleteStudentSubscription,
  createOrUpdateContentUsageAgreement,
  getContentUsageAgreementByUserId,
  createPaymentTransaction,
} from "../db-extended";

// Generate a 6-digit verification code
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send email verification code (mock implementation)
async function sendEmail(email: string, code: string): Promise<boolean> {
  // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
  console.log(`[Email] Sending verification code ${code} to ${email}`);
  return true;
}

export const studentRouter = router({
  // Submit student verification
  submitVerification: protectedProcedure
    .input(
      z.object({
        studentIdImageUrl: z.string().url("请上传有效的学生证图片"),
        schoolEmail: z.string().email("请输入有效的学校邮箱"),
        educationLevel: z.enum(["elementary", "middle", "high", "university"]),
        schoolName: z.string().min(1, "请输入学校名称"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Check if already verified
      const existing = await getStudentVerificationByUserId(userId);
      if (existing && existing.verificationStatus === "approved") {
        throw new Error("您已通过学生身份验证");
      }

      // Generate email verification code
      const code = generateVerificationCode();
      const expiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Save verification record
      await createOrUpdateStudentVerification({
        userId,
        studentIdImageUrl: input.studentIdImageUrl,
        schoolEmail: input.schoolEmail,
        schoolEmailVerified: false,
        verificationCode: code,
        verificationExpiry: expiry,
        educationLevel: input.educationLevel,
        schoolName: input.schoolName,
        verificationStatus: "pending",
      });

      // Send verification email
      const sent = await sendEmail(input.schoolEmail, code);

      if (!sent) {
        throw new Error("发送验证邮件失败，请稍后再试");
      }

      return {
        success: true,
        message: "验证申请已提交，请查收学校邮箱中的验证码",
        expiresIn: 1800, // seconds
      };
    }),

  // Verify school email with code
  verifySchoolEmail: protectedProcedure
    .input(
      z.object({
        code: z.string().length(6, "验证码必须为 6 位数字"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const verification = await getStudentVerificationByUserId(userId);
      if (!verification) {
        throw new Error("未找到验证记录，请先提交学生身份验证");
      }

      if (verification.schoolEmailVerified) {
        return {
          success: true,
          message: "学校邮箱已验证",
        };
      }

      // Check verification code
      if (verification.verificationCode !== input.code) {
        throw new Error("验证码错误");
      }

      // Check expiry
      if (verification.verificationExpiry && new Date() > verification.verificationExpiry) {
        throw new Error("验证码已过期，请重新发送");
      }

      // Mark email as verified - need to preserve existing fields
      await createOrUpdateStudentVerification({
        ...verification,
        schoolEmailVerified: true,
        verificationStatus: "pending", // Still needs admin approval
      });

      return {
        success: true,
        message: "学校邮箱验证成功，等待管理员审核学生证",
      };
    }),

  // Get student verification status
  getVerificationStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const verification = await getStudentVerificationByUserId(userId);

    if (!verification) {
      return {
        hasVerification: false,
        status: null,
        schoolEmail: null,
        educationLevel: null,
        schoolName: null,
        rejectionReason: null,
      };
    }

    return {
      hasVerification: true,
      status: verification.verificationStatus,
      schoolEmail: verification.schoolEmail,
      schoolEmailVerified: verification.schoolEmailVerified,
      educationLevel: verification.educationLevel,
      schoolName: verification.schoolName,
      rejectionReason: verification.rejectionReason,
      verifiedAt: verification.verifiedAt?.toISOString() ?? null,
    };
  }),

  // Start free trial (2-day, no payment required, only once per user)
  startTrial: protectedProcedure
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;

      // Check if student verification is approved
      const verification = await getStudentVerificationByUserId(userId);
      if (!verification || verification.verificationStatus !== "approved") {
        throw new Error("请先完成学生身份验证并等待审核通过");
      }

      // Check if already had any subscription (trial or paid)
      const existing = await getStudentSubscriptionByUserId(userId);
      if (existing) {
        throw new Error("您已使用过试用或已有订阅，无法再次试用");
      }

      // Create 2-day trial
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + 2);

      await createStudentSubscription({
        userId,
        subscriptionType: "trial",
        status: "active",
        startDate: now,
        endDate,
        price: "0.00",
        paymentMethod: "free_trial",
        paymentId: `trial_${userId}_${Date.now()}`,
      });

      return {
        success: true,
        message: "試用已開始，您有 2 天體驗期",
        startDate: now.toISOString(),
        endDate: endDate.toISOString(),
      };
    }),

  // Create student subscription (after payment)
  createSubscription: protectedProcedure
    .input(
      z.object({
        subscriptionType: z.enum(["halfYear", "fullYear"]),
        paymentMethod: z.string(),
        paymentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Check if student verification is approved
      const verification = await getStudentVerificationByUserId(userId);
      if (!verification || verification.verificationStatus !== "approved") {
        throw new Error("请先完成学生身份验证并等待审核通过");
      }

      // Check if user has expired trial - allow upgrade
      const existingSub = await getStudentSubscriptionByUserId(userId);
      if (existingSub && existingSub.subscriptionType !== "trial") {
        const hasActive = await hasActiveStudentSubscription(userId);
        if (hasActive) {
          throw new Error("您已有有效的学生订阅");
        }
      }
      // If existing is a trial (active or expired), delete it to allow new subscription
      // (userId is unique constraint, so we must delete before inserting)
      if (existingSub && existingSub.subscriptionType === "trial") {
        await deleteStudentSubscription(userId);
      }

      // Calculate dates and price
      const now = new Date();
      const startDate = now;
      const endDate = new Date(now);
      const price = input.subscriptionType === "halfYear" ? 20 : 38;

      if (input.subscriptionType === "halfYear") {
        endDate.setMonth(endDate.getMonth() + 6);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }

      // Create subscription
      await createStudentSubscription({
        userId,
        subscriptionType: input.subscriptionType,
        status: "active",
        startDate,
        endDate,
        price: price.toString(),
        paymentMethod: input.paymentMethod,
        paymentId: input.paymentId,
      });

      // Record payment transaction
      await createPaymentTransaction({
        userId,
        transactionType: "student_subscription",
        amount: price.toString(),
        currency: "USD",
        paymentMethod: input.paymentMethod,
        paymentId: input.paymentId,
        status: "completed",
        metadata: JSON.stringify({
          subscriptionType: input.subscriptionType,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      });

      return {
        success: true,
        message: "学生订阅创建成功",
        subscriptionType: input.subscriptionType,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        price,
      };
    }),

  // Get subscription status
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const subscription = await getStudentSubscriptionByUserId(userId);

    if (!subscription) {
      return {
        hasSubscription: false,
        status: null,
        subscriptionType: null,
        startDate: null,
        endDate: null,
        price: null,
      };
    }

    const isActive = await hasActiveStudentSubscription(userId);

    return {
      hasSubscription: true,
      isActive,
      status: subscription.status,
      subscriptionType: subscription.subscriptionType,
      startDate: subscription.startDate?.toISOString() ?? null,
      endDate: subscription.endDate?.toISOString() ?? null,
      price: subscription.price,
    };
  }),

  // Agree to content usage terms (required for student subscription)
  agreeToContentUsage: protectedProcedure
    .input(
      z.object({
        allowPlatformDisplay: z.boolean().default(true),
        allowMarketingUse: z.boolean().default(true),
        allowModelTraining: z.boolean().default(true),
        preferAnonymous: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      await createOrUpdateContentUsageAgreement({
        userId,
        agreedToTerms: true,
        agreedAt: new Date(),
        allowPlatformDisplay: input.allowPlatformDisplay,
        allowMarketingUse: input.allowMarketingUse,
        allowModelTraining: input.allowModelTraining,
        preferAnonymous: input.preferAnonymous,
      });

      return {
        success: true,
        message: "已同意内容使用协议",
      };
    }),

  // Get content usage agreement status
  getContentUsageAgreement: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const agreement = await getContentUsageAgreementByUserId(userId);

    if (!agreement) {
      return {
        hasAgreed: false,
        allowPlatformDisplay: true,
        allowMarketingUse: true,
        allowModelTraining: true,
        preferAnonymous: false,
        agreedAt: null,
      };
    }

    return {
      hasAgreed: agreement.agreedToTerms ?? false,
      allowPlatformDisplay: agreement.allowPlatformDisplay ?? true,
      allowMarketingUse: agreement.allowMarketingUse ?? true,
      allowModelTraining: agreement.allowModelTraining ?? true,
      preferAnonymous: agreement.preferAnonymous ?? false,
      agreedAt: agreement.agreedAt?.toISOString() ?? null,
    };
  }),
});

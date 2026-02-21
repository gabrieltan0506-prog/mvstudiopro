import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createOrUpdateUserPhone,
  getUserPhoneByUserId,
  getUserPhoneByPhoneNumber,
  verifyUserPhone,
} from "../db-extended";

// Generate a 6-digit verification code
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send SMS verification code (mock implementation - integrate with real SMS service)
async function sendSMS(phoneNumber: string, code: string): Promise<boolean> {
  // TODO: Integrate with SMS service (Twilio, Aliyun, Tencent Cloud, etc.)
  console.log(`[SMS] Sending verification code ${code} to ${phoneNumber}`);
  
  // For development, always return success
  // In production, implement real SMS sending logic
  return true;
}

export const phoneRouter = router({
  // Send verification code to phone number
  sendVerificationCode: protectedProcedure
    .input(
      z.object({
        phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Check if phone number is already used by another user
      const existingPhone = await getUserPhoneByPhoneNumber(input.phoneNumber);
      if (existingPhone && existingPhone.userId !== userId) {
        throw new Error("此手机号码已被其他帐号使用");
      }

      // Generate verification code
      const code = generateVerificationCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Save to database
      await createOrUpdateUserPhone({
        userId,
        phoneNumber: input.phoneNumber,
        verified: false,
        verificationCode: code,
        verificationExpiry: expiry,
      });

      // Send SMS
      const sent = await sendSMS(input.phoneNumber, code);

      if (!sent) {
        throw new Error("发送验证码失败，请稍后再试");
      }

      return {
        success: true,
        message: "验证码已发送",
        expiresIn: 600, // seconds
      };
    }),

  // Verify phone number with code
  verifyPhoneNumber: protectedProcedure
    .input(
      z.object({
        code: z.string().length(6, "验证码必须为 6 位数字"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Get user's phone record
      const phoneRecord = await getUserPhoneByUserId(userId);
      if (!phoneRecord) {
        throw new Error("未找到手机号码记录，请先发送验证码");
      }

      // Check if already verified
      if (phoneRecord.verified) {
        return {
          success: true,
          message: "手机号码已验证",
          phoneNumber: phoneRecord.phoneNumber,
        };
      }

      // Check verification code
      if (phoneRecord.verificationCode !== input.code) {
        throw new Error("验证码错误");
      }

      // Check expiry
      if (phoneRecord.verificationExpiry && new Date() > phoneRecord.verificationExpiry) {
        throw new Error("验证码已过期，请重新发送");
      }

      // Mark as verified
      await verifyUserPhone(userId);

      return {
        success: true,
        message: "手机号码验证成功",
        phoneNumber: phoneRecord.phoneNumber,
      };
    }),

  // Get current phone verification status
  getPhoneStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const phoneRecord = await getUserPhoneByUserId(userId);

    if (!phoneRecord) {
      return {
        hasPhone: false,
        verified: false,
        phoneNumber: null,
      };
    }

    return {
      hasPhone: true,
      verified: phoneRecord.verified ?? false,
      phoneNumber: phoneRecord.phoneNumber,
    };
  }),
});

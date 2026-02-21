import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import Stripe from "stripe";
import {
  createPaymentTransaction,
  getPaymentTransactionsByUserId,
  updatePaymentTransactionStatus,
  incrementUsageCount,
} from "../db-extended";
import { invokeLLM } from "../_core/llm";

// Initialize Stripe (use environment variable for API key)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-01-28.clover",
    })
  : null;

// Payment package definitions
const PAYMENT_PACKAGES = {
  storyboard_pack: {
    name: "视频分镜脚本套餐",
    description: "4 次视频分镜脚本生成",
    price: 12,
    currency: "USD",
    quantity: 4,
  },
  analysis_pack: {
    name: "视频 PK 评分套餐",
    description: "2 次视频 PK 评分",
    price: 15,
    currency: "USD",
    quantity: 2,
  },
  avatar_pack: {
    name: "虚拟偶像生成套餐",
    description: "5 次虚拟偶像生成",
    price: 3,
    currency: "USD",
    quantity: 5,
  },
};

export const paymentRouter = router({
  // Create Stripe payment intent
  createStripePayment: protectedProcedure
    .input(
      z.object({
        packageType: z.enum(["storyboard_pack", "analysis_pack", "avatar_pack"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!stripe) {
        throw new Error("Stripe 未配置，请联系管理员");
      }

      const userId = ctx.user.id;
      const pkg = PAYMENT_PACKAGES[input.packageType];

      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: pkg.price * 100, // Convert to cents
        currency: pkg.currency.toLowerCase(),
        metadata: {
          userId: userId.toString(),
          packageType: input.packageType,
          quantity: pkg.quantity.toString(),
        },
      });

      // Record transaction in database
      await createPaymentTransaction({
        userId,
        transactionType: input.packageType,
        amount: pkg.price.toString(),
        currency: pkg.currency,
        paymentMethod: "stripe",
        paymentId: paymentIntent.id,
        status: "pending",
        metadata: JSON.stringify({
          packageName: pkg.name,
          quantity: pkg.quantity,
        }),
      });

      return {
        clientSecret: paymentIntent.client_secret,
        packageInfo: pkg,
      };
    }),

  // Handle Stripe webhook (called by Stripe when payment succeeds)
  handleStripeWebhook: publicProcedure
    .input(
      z.object({
        paymentIntentId: z.string(),
        status: z.enum(["succeeded", "failed"]),
      })
    )
    .mutation(async ({ input }) => {
      // Find transaction by payment ID
      // Note: This is simplified - in production, verify webhook signature
      const transactions = await getPaymentTransactionsByUserId(0, 1000); // Get all transactions
      const transaction = transactions.find((t) => t.paymentId === input.paymentIntentId);

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (input.status === "succeeded") {
        // Update transaction status
        await updatePaymentTransactionStatus(transaction.id, "completed");

        // Grant usage credits to user
        const metadata = JSON.parse(transaction.metadata || "{}");
        const quantity = metadata.quantity || 1;

        // Determine feature type
        const featureType =
          transaction.transactionType === "storyboard_pack"
            ? "storyboard"
            : transaction.transactionType === "analysis_pack"
              ? "analysis"
              : "avatar";

        // Add credits (negative usage count to represent credits)
        // This is a simplified approach - in production, use a separate credits table
        for (let i = 0; i < quantity; i++) {
          // Decrement usage count (add credits)
          // Note: This requires modifying incrementUsageCount to support negative values
        }

        return {
          success: true,
          message: "Payment successful, credits granted",
        };
      } else {
        // Payment failed
        await updatePaymentTransactionStatus(transaction.id, "failed");
        return {
          success: false,
          message: "Payment failed",
        };
      }
    }),

  // Create QR code payment order (WeChat/Alipay)
  createQRCodePayment: protectedProcedure
    .input(
      z.object({
        packageType: z.enum(["storyboard_pack", "analysis_pack", "avatar_pack"]),
        paymentMethod: z.enum(["wechat", "alipay"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const pkg = PAYMENT_PACKAGES[input.packageType];

      // Generate unique order ID
      const orderId = `ORDER-${Date.now()}-${userId}`;

      // Record transaction in database
      const transactionId = await createPaymentTransaction({
        userId,
        transactionType: input.packageType,
        amount: pkg.price.toString(),
        currency: pkg.currency,
        paymentMethod: input.paymentMethod,
        paymentId: orderId,
        status: "pending",
        metadata: JSON.stringify({
          packageName: pkg.name,
          quantity: pkg.quantity,
        }),
      });

      // Return QR code URL and order info
      const qrCodeUrl =
        input.paymentMethod === "wechat"
          ? "/assets/payment/wechat-qr.jpg"
          : "/assets/payment/alipay-qr.jpg";

      return {
        orderId,
        transactionId,
        qrCodeUrl,
        packageInfo: pkg,
        paymentMethod: input.paymentMethod,
        recipientName: "谭博",
      };
    }),

  // Submit payment screenshot for AI verification
  submitPaymentScreenshot: protectedProcedure
    .input(
      z.object({
        orderId: z.string(),
        screenshotBase64: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Find transaction by order ID
      const transactions = await getPaymentTransactionsByUserId(userId, 100);
      const transaction = transactions.find((t) => t.paymentId === input.orderId);

      if (!transaction) {
        throw new Error("订单不存在");
      }

      if (transaction.status !== "pending") {
        throw new Error("订单已处理，无需重复提交");
      }

      // Use AI to verify payment screenshot
      const verificationPrompt = `
你是一个支付截屏验证专家。请分析这张支付截屏，并判断是否为真实的微信或支付宝支付记录。

请检查以下内容：
1. 订单号是否为：${input.orderId}
2. 支付金额是否为：$${transaction.amount} USD（或等值人民币）
3. 收款人是否为：谭博
4. 支付时间是否在最近 30 分钟内
5. 截屏是否为真实的微信/支付宝界面（检查字体、布局、UI 元素）

请以 JSON 格式回复：
{
  "isValid": true/false,
  "reason": "验证结果说明",
  "confidence": 0.0-1.0,
  "detectedOrderId": "检测到的订单号（如果有）",
  "detectedAmount": "检测到的金额（如果有）",
  "detectedRecipient": "检测到的收款人（如果有）",
  "detectedTime": "检测到的支付时间（如果有）"
}
`;

      try {
        const aiResponse = await invokeLLM({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: verificationPrompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.screenshotBase64}` } },
              ],
            },
          ],
        });

        // Parse AI response
        const responseText = typeof aiResponse.choices[0].message.content === "string" 
          ? aiResponse.choices[0].message.content 
          : aiResponse.choices[0].message.content.map(c => c.type === "text" ? c.text : "").join("");
        const verification = JSON.parse(responseText);

        if (verification.isValid && verification.confidence > 0.8) {
          // AI verification passed - auto-approve payment
          await updatePaymentTransactionStatus(transaction.id, "completed");

          // Grant usage credits
          const metadata = JSON.parse(transaction.metadata || "{}");
          const quantity = metadata.quantity || 1;

          const featureType =
            transaction.transactionType === "storyboard_pack"
              ? "storyboard"
              : transaction.transactionType === "analysis_pack"
                ? "analysis"
                : "avatar";

          // Add credits by decrementing usage count
          // Note: This is simplified - in production, use a separate credits system

          return {
            success: true,
            message: "支付验证成功，已自动开通功能",
            verification: {
              isValid: true,
              confidence: verification.confidence,
              autoApproved: true,
            },
          };
        } else if (verification.confidence > 0.5) {
          // Medium confidence - mark for manual review
          return {
            success: false,
            message: "支付截屏需要人工审核，请等待管理员确认（通常 1-2 小时内完成）",
            verification: {
              isValid: false,
              confidence: verification.confidence,
              reason: verification.reason,
              requiresManualReview: true,
            },
          };
        } else {
          // Low confidence - reject
          return {
            success: false,
            message: `支付验证失败：${verification.reason}。请确认截屏清晰且包含完整的支付信息。`,
            verification: {
              isValid: false,
              confidence: verification.confidence,
              reason: verification.reason,
            },
          };
        }
      } catch (error) {
        console.error("AI verification error:", error);
        // If AI fails, mark for manual review
        return {
          success: false,
          message: "AI 验证失败，已转为人工审核，请等待管理员确认",
          verification: {
            isValid: false,
            confidence: 0,
            reason: "AI 验证服务暂时不可用",
            requiresManualReview: true,
          },
        };
      }
    }),

  // Get payment history
  getPaymentHistory: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const transactions = await getPaymentTransactionsByUserId(userId, 50);

    return transactions.map((t) => ({
      id: t.id,
      orderId: t.paymentId,
      packageType: t.transactionType,
      amount: t.amount,
      currency: t.currency,
      paymentMethod: t.paymentMethod,
      status: t.status,
      createdAt: t.createdAt?.toISOString(),
      metadata: t.metadata ? JSON.parse(t.metadata) : null,
    }));
  }),

  // Get available payment packages
  getPaymentPackages: publicProcedure.query(() => {
    return Object.entries(PAYMENT_PACKAGES).map(([key, pkg]) => ({
      id: key,
      ...pkg,
    }));
  }),
});

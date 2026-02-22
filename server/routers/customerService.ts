/**
 * AI 客服助手路由
 * 
 * 功能：
 * 1. sendMessage — 用户发送消息，AI 自动回答（Gemini Flash）
 * 2. escalate — 转人工：发送 Email 通知管理员
 * 3. getHistory — 获取当前会话历史
 * 
 * AI 客服知识库涵盖：
 * - 平台功能介绍（分镜、偶像、视频、3D、音乐）
 * - Credits 定价和充值
 * - 常见问题（水印、导出、版权）
 * - 学生版方案
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { invokeLLM, type Message } from "../_core/llm";
import { notifyOwner } from "../_core/notification";

// ─── 内存会话存储（按 sessionId） ─────────────────────────
interface ChatSession {
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>;
  escalated: boolean;
  createdAt: number;
  lastActivity: number;
}

const sessions = new Map<string, ChatSession>();

// 会话过期时间：2 小时
const SESSION_TTL = 2 * 60 * 60 * 1000;

// 定期清理过期会话（每 30 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of Array.from(sessions.entries())) {
    if (now - session.lastActivity > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 30 * 60 * 1000);

function getOrCreateSession(sessionId: string): ChatSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      messages: [],
      escalated: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    sessions.set(sessionId, session);
  }
  session.lastActivity = Date.now();
  return session;
}

// ─── AI 客服系统 Prompt ──────────────────────────────────
const CUSTOMER_SERVICE_SYSTEM_PROMPT = `你是 MV Studio Pro 的 AI 客服助手「小M」。你的职责是帮助用户了解平台功能、解答使用问题、引导用户完成操作。

## 你的性格
- 友好、专业、耐心
- 回答简洁明了，不超过 200 字
- 使用简体中文
- 适当使用表情让对话更亲切

## 平台核心功能
1. **智能脚本与分镜生成** — 输入歌词/文案，AI 自动生成分镜脚本和分镜图
   - 免费版：Forge AI 生图（有水印），每次最多 10 张
   - 付费版：Nano Banana Pro 2K/4K 高清图（无水印），最多 30-70 张
   - AI 灵感助手：没灵感时，给三句话描述，AI 帮你写完整脚本

2. **虚拟偶像生成** — AI 生成 2D 虚拟偶像形象，可转 3D 模型
   - 免费版：Forge AI 生成
   - 付费版：NBP 2K/4K 高清生成
   - 3D 转换：使用 Trellis 引擎，支持 GLB/OBJ 导出

3. **视频 PK 评分** — 上传视频，AI 从多维度打分并给出改进建议

4. **Kling AI 工作室** — 专业视频生成
   - Omni Video 3.0：文生视频 / 图生视频
   - Motion Control 2.6：动作迁移
   - Lip-Sync：口型同步
   - Elements 3.0：角色元素管理

5. **3D Studio** — 2D 图片转 3D 模型（Rapid 闪电模式 / Pro 精雕模式）

6. **音乐生成**（开发中）— Suno V4/V4.5 AI 作曲

## Credits 定价
- 所有付费功能使用 Credits（积分）
- Credits 加值包：
  - 入门包：50 Credits = ¥35
  - 高端包：100 Credits = ¥68
  - 超值包：250 Credits = ¥168
  - 专业包：500 Credits = ¥328
- 主要功能消耗：
  - AI 灵感生成：5 Credits
  - NBP 2K 图片：5 Credits/张
  - NBP 4K 图片：9 Credits/张
  - Suno V4 音乐：12 Credits
  - 视频生成：50 Credits
  - Kling 视频：80 Credits
  - 偶像 3D 转换：30 Credits

## 学生版
- 学生试用版：免费 2 天
- 学生半年版：¥138
- 学生一年版：¥268

## 常见问题
- **水印**：免费版生成的图片和文档有水印，付费后无水印
- **导出**：支持 PDF 和 Word 格式导出分镜脚本
- **版权**：AI 生成内容的版权归属存在法律不确定性，平台定位为创作工具，版权问题由用户自行判断
- **下载**：所有生成的内容都可以下载保存到本地
- **支付**：目前支持 Stripe 支付（信用卡），后续将支持微信/支付宝

## 重要规则
1. 如果用户的问题你无法回答（如技术故障、退款、账号问题），请建议用户点击「转人工客服」按钮
2. 不要编造不存在的功能
3. 不要承诺具体的上线时间
4. 如果用户情绪激动或投诉，先安抚情绪，再建议转人工
5. 不要透露 API 成本或利润率等商业机密`;

// ─── 判断是否需要转人工 ──────────────────────────────────
const ESCALATION_KEYWORDS = [
  "退款", "退钱", "投诉", "bug", "故障", "崩溃", "打不开",
  "登不上", "账号", "密码", "被盗", "充值失败", "支付失败",
  "联系客服", "人工客服", "找人", "经理", "负责人",
];

function shouldSuggestEscalation(message: string): boolean {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── 路由定义 ─────────────────────────────────────────────
export const customerServiceRouter = router({
  /**
   * 发送消息给 AI 客服
   */
  sendMessage: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1).max(64),
      message: z.string().min(1).max(2000),
      userName: z.string().max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      const session = getOrCreateSession(input.sessionId);

      // 记录用户消息
      session.messages.push({
        role: "user",
        content: input.message,
        timestamp: Date.now(),
      });

      // 构建 LLM 消息历史（最近 20 条）
      const recentMessages = session.messages.slice(-20);
      const llmMessages: Message[] = [
        { role: "system", content: CUSTOMER_SERVICE_SYSTEM_PROMPT },
        ...recentMessages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      try {
        const result = await invokeLLM({
          messages: llmMessages,
          maxTokens: 1024,
        });

        const aiResponse = result.choices?.[0]?.message?.content;
        const responseText = typeof aiResponse === "string"
          ? aiResponse
          : Array.isArray(aiResponse)
            ? aiResponse.map(p => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
            : "抱歉，我暂时无法回答这个问题。请点击「转人工客服」获取帮助。";

        // 记录 AI 回复
        session.messages.push({
          role: "assistant",
          content: responseText,
          timestamp: Date.now(),
        });

        // 检查是否建议转人工
        const suggestEscalation = shouldSuggestEscalation(input.message);

        return {
          response: responseText,
          suggestEscalation,
          sessionId: input.sessionId,
        };
      } catch (error) {
        console.error("[CustomerService] LLM error:", error);

        const fallbackResponse = "抱歉，AI 助手暂时繁忙。请稍后再试，或点击「转人工客服」获取帮助。";
        session.messages.push({
          role: "assistant",
          content: fallbackResponse,
          timestamp: Date.now(),
        });

        return {
          response: fallbackResponse,
          suggestEscalation: true,
          sessionId: input.sessionId,
        };
      }
    }),

  /**
   * 转人工客服 — 发送 Email 通知管理员
   */
  escalate: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1).max(64),
      userName: z.string().max(100).optional(),
      userEmail: z.string().email().optional(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const session = getOrCreateSession(input.sessionId);
      session.escalated = true;

      // 整理对话历史
      const recentMessages = session.messages.slice(-10);
      const chatHistory = recentMessages
        .map(m => `[${m.role === "user" ? "用户" : "AI"}] ${m.content}`)
        .join("\n\n");

      const title = `🆘 MV Studio Pro 客服转人工 — ${input.userName || "匿名用户"}`;
      const content = [
        `## 客服转人工通知`,
        ``,
        `**用户名称：** ${input.userName || "未提供"}`,
        `**用户邮箱：** ${input.userEmail || "未提供"}`,
        `**转人工原因：** ${input.reason || "用户主动请求"}`,
        `**会话 ID：** ${input.sessionId}`,
        `**时间：** ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        ``,
        `---`,
        ``,
        `### 最近对话记录`,
        ``,
        chatHistory,
        ``,
        `---`,
        ``,
        `请尽快通过邮件联系用户处理。`,
      ].join("\n");

      try {
        // 使用 Manus 通知服务发送通知给项目 Owner
        const sent = await notifyOwner({ title, content });

        if (sent) {
          return {
            success: true,
            message: "已通知人工客服，我们会尽快通过邮件联系您。请留意您的邮箱。",
          };
        } else {
          return {
            success: false,
            message: "通知发送暂时失败，请直接发送邮件至 support@mvstudiopro.com 联系我们。",
          };
        }
      } catch (error) {
        console.error("[CustomerService] Escalation error:", error);
        return {
          success: false,
          message: "通知发送失败，请直接发送邮件至 support@mvstudiopro.com 联系我们。",
        };
      }
    }),

  /**
   * 提交联络表单 — 发送 Email 通知管理员
   */
  submitContactForm: publicProcedure
    .input(z.object({
      name: z.string().max(100).optional(),
      email: z.string().min(1).max(200),
      subject: z.string().max(100).default("其他"),
      content: z.string().min(1).max(5000),
    }))
    .mutation(async ({ input }) => {
      const title = `📩 MV Studio Pro 联络表单 — ${input.subject}`;
      const body = [
        `## 新的联络表单提交`,
        ``,
        `**称呼：** ${input.name || "未提供"}`,
        `**邮箱：** ${input.email}`,
        `**主题：** ${input.subject}`,
        `**时间：** ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        ``,
        `---`,
        ``,
        `### 内容`,
        ``,
        input.content,
        ``,
        `---`,
        ``,
        `请通过邮箱 ${input.email} 回复用户。`,
      ].join("\n");

      try {
        const sent = await notifyOwner({ title, content: body });
        if (sent) {
          return {
            success: true,
            message: "提交成功！我们会在 24 小时内通过邮件回复您。",
          };
        } else {
          return {
            success: false,
            message: "提交暂时失败，请直接发送邮件至 benjamintan0318@gmail.com 联系我们。",
          };
        }
      } catch (error) {
        console.error("[CustomerService] Contact form error:", error);
        return {
          success: false,
          message: "提交失败，请直接发送邮件至 benjamintan0318@gmail.com 联系我们。",
        };
      }
    }),

  /**
   * 获取会话历史
   */
  getHistory: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1).max(64),
    }))
    .query(({ input }) => {
      const session = sessions.get(input.sessionId);
      if (!session) {
        return { messages: [], escalated: false };
      }
      return {
        messages: session.messages,
        escalated: session.escalated,
      };
    }),
});

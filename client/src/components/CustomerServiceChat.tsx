// @ts-nocheck

/**
 * AI 客服助手聊天浮窗
 *
 * 功能：
 * - 右下角浮动按钮，点击展开聊天面板
 * - AI 自动回答（Gemini Flash）
 * - 「转人工客服」按钮（Mail 通知管理员）
 * - 欢迎语 + 快捷问题
 * - 深色主题，与 MV Studio Pro 风格一致
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Headset, X, Send, Loader2, User, Mail } from "lucide-react";

// ─── 类型 ─────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// ─── 常量 ─────────────────────────────────────────────────
const QUICK_QUESTIONS = [
  "平台有哪些功能？",
  "Credits 怎幺充值？",
  "如何生成虚拟偶像？",
  "视频生成要多少 Credits？",
  "有学生优惠吗？",
];

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "你好！我是小M，MV Studio Pro 的 AI 客服助手 👋\n\n有什幺可以帮到你的吗？你可以直接输入问题，或点击下方快捷按钮。",
  timestamp: Date.now(),
};

// ─── 生成唯一 Session ID ──────────────────────────────────
function generateSessionId(): string {
  return `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 主组件 ───────────────────────────────────────────────
export function CustomerServiceChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showEscalateForm, setShowEscalateForm] = useState(false);
  const [escalateEmail, setEscalateEmail] = useState("");
  const [escalateName, setEscalateName] = useState("");
  const [escalateReason, setEscalateReason] = useState("");
  const [sessionId] = useState(generateSessionId);
  const [hasUnread, setHasUnread] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // tRPC mutations
  const sendMessageMutation = trpc.community.addComment.useMutation();
  const escalateMutation = trpc.community.toggleLike.useMutation();

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 100);
  }, []);

  // 发送消息
  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text || inputText).trim();
    if (!messageText || isLoading) return;

    setInputText("");

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    scrollToBottom();
    setIsLoading(true);

    try {
      const result = await sendMessageMutation.mutateAsync({
        sessionId,
        message: messageText,
      });

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: "assistant",
        content: result.response,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);

      if (result.suggestEscalation) {
        const hintMsg: ChatMessage = {
          id: `hint_${Date.now()}`,
          role: "system",
          content: "如果以上回答未能解决您的问题，可以点击下方「转人工客服」按钮，我们会尽快通过邮件联系您。",
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, hintMsg]);
      }

      if (!isOpen) setHasUnread(true);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: "抱歉，网络出现问题，请稍后再试。",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [inputText, isLoading, sessionId, sendMessageMutation, scrollToBottom, isOpen]);

  // 转人工
  const handleEscalate = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await escalateMutation.mutateAsync({
        sessionId,
        userName: escalateName || undefined,
        userEmail: escalateEmail || undefined,
        reason: escalateReason || undefined,
      });

      const systemMsg: ChatMessage = {
        id: `escalate_${Date.now()}`,
        role: "system",
        content: result.success
          ? "✅ " + result.message
          : "⚠️ " + result.message,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, systemMsg]);
      setShowEscalateForm(false);
      setEscalateEmail("");
      setEscalateName("");
      setEscalateReason("");
    } catch {
      const errorMsg: ChatMessage = {
        id: `error_${Date.now()}`,
        role: "system",
        content: "⚠️ 通知发送失败，请直接发送邮件至 support@mvstudiopro.com",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [sessionId, escalateName, escalateEmail, escalateReason, escalateMutation, scrollToBottom]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setHasUnread(false);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setShowEscalateForm(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [isOpen, messages, scrollToBottom]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === "system") {
      return (
        <div className="flex justify-center py-1">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3.5 py-2 max-w-[90%]">
            <p className="text-sm text-orange-400 text-center leading-relaxed">{item.content}</p>
          </div>
        </div>
      );
    }

    const isUser = item.role === "user";
    return (
      <div className={`flex items-end gap-2 max-w-[88%] ${isUser ? "self-end" : "self-start"}`}>
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            <Headset className="w-4 h-4 text-orange-400" />
          </div>
        )}
        <div className={`px-3.5 py-2.5 rounded-2xl ${isUser ? "bg-orange-500 rounded-br-md" : "bg-zinc-800 rounded-bl-md"}`}>
          <p className={`text-sm leading-snug ${isUser ? "text-white" : "text-gray-50"}`}>
            {item.content}
          </p>
        </div>
      </div>
    );
  }, []);

  const quickQuestionButtons = useMemo(() => (
    <div className="pt-3 space-y-2">
      <p className="text-xs text-zinc-400 px-1">常见问题</p>
      <div className="flex flex-wrap gap-2">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            className="bg-orange-500/10 border border-orange-500/25 rounded-full px-3.5 py-2 text-xs text-orange-400 hover:bg-orange-500/20 transition-colors"
            onClick={() => handleSend(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  ), [handleSend]);

  return (
    <>
      {/* FAB */}
      <motion.div
        initial={{ scale: 0, y: 50 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 1 }}
        className="fixed bottom-20 right-5 z-50"
      >
        <button
          onClick={handleOpen}
          className="w-14 h-14 rounded-full bg-orange-500 flex items-center justify-center shadow-lg hover:bg-orange-600 transition-colors transform active:scale-90"
        >
          <Headset className="w-7 h-7 text-white" />
          {hasUnread && (
            <motion.div 
              className="absolute -top-1 -right-1"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 12 }}
            >
              <div className="w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-zinc-900" />
            </motion.div>
          )}
        </button>
      </motion.div>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center items-end"
            onClick={handleClose}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: "0%" }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="bg-[#0A0A0C] border-t border-zinc-800 rounded-t-2xl h-[90vh] max-h-[700px] w-full max-w-lg flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-zinc-800 bg-[#121214]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center">
                    <Headset className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-gray-50">小M · AI 客服</h2>
                    <p className="text-xs text-zinc-400 mt-0.5">通常即时回复</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-800/60 hover:bg-zinc-700 transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              {/* Messages */}
              <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => <div key={msg.id} item={msg} />)}
                {isLoading && messages[messages.length - 1]?.role === 'user' && (
                  <div className="flex items-end gap-2 self-start">
                    <div className="w-7 h-7 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                      <Headset className="w-4 h-4 text-orange-400" />
                    </div>
                    <div className="px-3.5 py-2.5 rounded-2xl bg-zinc-800 rounded-bl-md flex items-center gap-2">
                       <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                       <span className="text-sm text-zinc-400">小M正在思考...</span>
                    </div>
                  </div>
                )}
                {messages.length === 1 && quickQuestionButtons}
              </div>

              {/* Escalate Form */}
              {showEscalateForm ? (
                <div className="flex-shrink-0 p-4 border-t border-zinc-800 bg-[#121214] space-y-3">
                  <h3 className="text-base font-bold text-gray-50">转人工客服</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">请留下您的联系方式和问题，我们的支持团队会尽快通过邮件与您联系。</p>
                  <input type="text" placeholder="您的称呼 (选填)" value={escalateName} onChange={(e) => setEscalateName(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-gray-50 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500" />
                  <input type="email" placeholder="您的邮箱 (必填)" value={escalateEmail} onChange={(e) => setEscalateEmail(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-gray-50 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500" />
                  <textarea placeholder="请简要描述您遇到的问题... (选填)" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-gray-50 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 resize-none" />
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowEscalateForm(false)} className="flex-1 py-2.5 rounded-md bg-zinc-700 text-sm font-semibold text-zinc-300 hover:bg-zinc-600 transition-colors">取消</button>
                    <button onClick={handleEscalate} disabled={isLoading || !escalateEmail} className="flex-1 py-2.5 rounded-md bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 transition-colors disabled:bg-zinc-700 disabled:text-zinc-400 flex items-center justify-center gap-2">
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '提交'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Input Bar */
                <div className="flex-shrink-0 p-3 border-t border-zinc-800 bg-[#121214]">
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowEscalateForm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-orange-500/10 border border-orange-500/25 hover:bg-orange-500/20 transition-colors">
                            <User className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-xs font-semibold text-orange-400">转人工</span>
                        </button>
                        <a href="mailto:support@mvstudiopro.com" className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-sky-500/10 border border-sky-500/25 hover:bg-sky-500/20 transition-colors">
                            <Mail className="w-3.5 h-3.5 text-sky-400" />
                            <span className="text-xs font-semibold text-sky-400">邮件联系</span>
                        </a>
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                        <div className="flex-1 bg-zinc-800 rounded-full flex items-center px-4">
                            <input
                                type="text"
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                                placeholder="输入您的问题..."
                                className="flex-1 h-10 bg- text-sm text-gray-50 placeholder-zinc-500 focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={() => handleSend()}
                            disabled={!inputText.trim() || isLoading}
                            className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 transition-colors disabled:bg-zinc-700"
                        >
                            {isLoading && messages[messages.length - 1]?.role === 'user' ? (
                                <Loader2 className="h-5 w-5 animate-spin text-white" />
                            ) : (
                                <Send className="w-5 h-5 text-white" />
                            )}
                        </button>
                    </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// @ts-nocheck
/**
 * 聯絡我們頁面
 * 
 * 用戶可填寫姓名、郵箱、主題、內容，提交後通過 notifyOwner 通知管理員。
 * 從客服浮窗「聯絡我們」按鈕跳轉而來。
 */

import React, { useState, useCallback } from "react";
import { useLocation, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, Mail, Send, CheckCircle2, Loader2 } from "lucide-react";

type SubjectOption = {
  label: string;
  value: string;
};

const SUBJECT_OPTIONS: SubjectOption[] = [
  { label: "功能咨询", value: "功能咨询" },
  { label: "充值 / 支付问题", value: "充值/支付问题" },
  { label: "Bug 反馈", value: "Bug反馈" },
  { label: "合作洽谈", value: "合作洽谈" },
  { label: "其他", value: "其他" },
];

export default function Contact() {
  const navigate = useLocation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const submitMutation = trpc.community.submitContactForm.useMutation();

  const isValid = email.trim().length > 0 && content.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await submitMutation.mutateAsync({
        name: name.trim() || undefined,
        email: email.trim(),
        subject: subject || "其他",
        content: content.trim(),
      });

      if (result.success) {
        setIsSubmitted(true);
      } else {
        toast.error(result.message || "提交失败，请稍后再试");
      }
    } catch {
      toast.error("网络错误，请检查网络后重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, name, email, subject, content, submitMutation]);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  // 提交成功頁面
  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex flex-col items-center justify-center p-8 gap-3 text-center">
        <div className="mb-2">
          <CheckCircle2 size={64} className="text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-[#F7F4EF]">提交成功！</h1>
        <p className="text-base text-[#9B9691] leading-snug">
          感谢您的留言，我们会在 24 小时内通过邮件回复您。
        </p>
        <p className="text-sm font-semibold text-[#E8825E] mt-1">
          回复邮箱：{email}
        </p>
        <button
          className="bg-[#E8825E] rounded-xl px-8 py-3.5 mt-5 text-base font-bold text-white transition-opacity hover:opacity-80"
          onClick={handleBack}
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3">
          <button
            className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center transition-opacity hover:opacity-60"
            onClick={handleBack}
          >
            <ArrowLeft size={24} className="text-[#F7F4EF]" />
          </button>
          <h1 className="text-lg font-bold text-[#F7F4EF]">联络我们</h1>
          <div className="w-10" />
        </header>

        {/* Intro */}
        <section className="flex flex-col items-center px-6 pt-4 pb-6 gap-2 text-center">
          <div className="w-15 h-15 rounded-full bg-orange-500/10 flex items-center justify-center mb-1">
            <Mail size={32} className="text-[#E8825E]" />
          </div>
          <h2 className="text-2xl font-bold text-[#F7F4EF]">有什么可以帮到您？</h2>
          <p className="text-sm text-[#9B9691] leading-relaxed">
            填写以下表单，我们的团队会在 24 小时内通过邮件回复您。
          </p>
        </section>

        {/* Form */}
        <section className="px-5 flex flex-col gap-4.5">
          {/* 姓名 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-[#F7F4EF] pl-0.5">您的称呼</label>
            <input
              className="bg-[#1A1A1D] rounded-xl px-4 py-3 text-base text-[#F7F4EF] border-0.5 border-[#2A2A2E] placeholder-[#555] focus:ring-1 focus:ring-[#E8825E] focus:outline-none"
              placeholder="请输入您的姓名（选填）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              type="text"
            />
          </div>

          {/* 郵箱 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-[#F7F4EF] pl-0.5">
              邮箱地址 <span className="text-[#E8825E]">*</span>
            </label>
            <input
              className="bg-[#1A1A1D] rounded-xl px-4 py-3 text-base text-[#F7F4EF] border-0.5 border-[#2A2A2E] placeholder-[#555] focus:ring-1 focus:ring-[#E8825E] focus:outline-none"
              placeholder="请输入您的邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </div>

          {/* 主題選擇 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-[#F7F4EF] pl-0.5">咨询主题</label>
            <div className="flex flex-row flex-wrap gap-2">
              {SUBJECT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`px-3.5 py-2 rounded-full border-0.5 transition-colors ${ 
                    subject === opt.value 
                    ? "bg-orange-500/15 border-[#E8825E]" 
                    : "bg-[#1A1A1D] border-[#2A2A2E] hover:bg-white/5"
                  }`}
                  onClick={() => setSubject(opt.value)}
                >
                  <span className={`text-sm ${ 
                    subject === opt.value 
                    ? "text-[#E8825E] font-semibold" 
                    : "text-[#9B9691]"
                  }`}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 內容 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-[#F7F4EF] pl-0.5">
              详细内容 <span className="text-[#E8825E]">*</span>
            </label>
            <textarea
              className="bg-[#1A1A1D] rounded-xl px-4 py-3 text-base text-[#F7F4EF] border-0.5 border-[#2A2A2E] placeholder-[#555] focus:ring-1 focus:ring-[#E8825E] focus:outline-none"
              placeholder="请详细描述您的问题或需求..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
            />
          </div>

          {/* 提交按鈕 */}
          <button
            className={`flex flex-row items-center justify-center gap-2 rounded-2xl py-3.5 mt-1.5 transition-opacity ${ 
              isValid ? "bg-[#E8825E] hover:opacity-85" : "bg-[#2A2A2E] cursor-not-allowed"
            }`}
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 size={20} className="text-white animate-spin" />
            ) : (
              <>
                <Send size={18} className={isValid ? "text-white" : "text-[#666]"} />
                <span className={`text-base font-bold ${isValid ? "text-white" : "text-[#666]"}`}>
                  提交
                </span>
              </>
            )}
          </button>

          {/* 直接聯繫 */}
          <div className="flex flex-col items-center pt-3 gap-1">
            <p className="text-sm text-[#9B9691]">或直接发送邮件至</p>
            <p className="text-base text-[#E8825E] font-semibold">
              benjamintan0318@gmail.com
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

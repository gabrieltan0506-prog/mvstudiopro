// @ts-nocheck
"use client";

import { useState, useCallback } from "react";
import { trackFormSubmission, trpc } from '@/lib/trpc';
import { CheckCircle, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SUBJECT_OPTIONS = [
  "视频制作咨询",
  "虚拟偶像合作",
  "视觉特效定制",
  "发布策略规划",
  "商务合作",
  "其他",
];

interface FormData {
  name: string;
  email: string;
  phone: string;
  company: string;
  subject: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  email: "",
  phone: "",
  company: "",
  subject: "",
  message: "",
};

export function GuestbookSection() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);

  const submitMutation = trpc.guestbook.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setForm(INITIAL_FORM);
      // trackFormSubmission("guestbook");
      toast.success("感谢您的留言，我们会尽快与您联系。");
      setTimeout(() => setSubmitted(false), 5000);
    },
    onError: (error) => {
      toast.error(`提交失败：${error.message || "请稍后再试"}`);
    },
  });

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!form.name.trim()) {
      toast.warning("请输入您的姓名");
      return;
    }
    if (!form.subject) {
      toast.warning("请选择咨询主题");
      return;
    }
    if (!form.message.trim()) {
      toast.warning("请输入咨询内容");
      return;
    }

    submitMutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      subject: form.subject,
      message: form.message.trim(),
    });
  }, [form, submitMutation]);

  if (submitted) {
    return (
      <div className="flex flex-col items-center py-10 gap-3 text-center">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <h2 className="text-2xl font-bold text-[#F7F4EF]">感谢您的留言</h2>
        <p className="text-lg text-[#9B9691]">我们会尽快与您联系。</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-5">
      {/* Two-column row for Name + Mail */}
      <div className="flex flex-col md:flex-row md:gap-4 gap-5">
        <div className="flex flex-col gap-2 md:flex-1">
          <label className="text-sm font-semibold text-[#B8B4AF] tracking-[-0.1px]">
            姓名 <span className="text-red-500">*</span>
          </label>
          <input
            className="text-base text-[#F7F4EF] bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-4 py-3.5 leading-snug focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0A0A0C] focus:ring-[#E8825E] placeholder:text-[#6B6762]"
            placeholder="您的姓名"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            maxLength={100}
          />
        </div>
        <div className="flex flex-col gap-2 md:flex-1">
          <label className="text-sm font-semibold text-[#B8B4AF] tracking-[-0.1px]">电子邮件</label>
          <input
            className="text-base text-[#F7F4EF] bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-4 py-3.5 leading-snug focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0A0A0C] focus:ring-[#E8825E] placeholder:text-[#6B6762]"
            placeholder="example@email.com"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            type="email"
            autoCapitalize="none"
            maxLength={320}
          />
        </div>
      </div>

      {/* Two-column row for Phone + Company */}
      <div className="flex flex-col md:flex-row md:gap-4 gap-5">
        <div className="flex flex-col gap-2 md:flex-1">
          <label className="text-sm font-semibold text-[#B8B4AF] tracking-[-0.1px]">联系电话</label>
          <input
            className="text-base text-[#F7F4EF] bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-4 py-3.5 leading-snug focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0A0A0C] focus:ring-[#E8825E] placeholder:text-[#6B6762]"
            placeholder="您的电话号码"
            value={form.phone}
            onChange={(e) => updateField("phone", e.target.value)}
            type="tel"
            maxLength={30}
          />
        </div>
        <div className="flex flex-col gap-2 md:flex-1">
          <label className="text-sm font-semibold text-[#B8B4AF] tracking-[-0.1px]">公司 / 机构</label>
          <input
            className="text-base text-[#F7F4EF] bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-4 py-3.5 leading-snug focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0A0A0C] focus:ring-[#E8825E] placeholder:text-[#6B6762]"
            placeholder="公司或机构名称"
            value={form.company}
            onChange={(e) => updateField("company", e.target.value)}
            maxLength={200}
          />
        </div>
      </div>

      {/* Subject Picker */}
      <div className="flex flex-col gap-2 relative">
        <label className="text-sm font-semibold text-[#B8B4AF] tracking-[-0.1px]">
          咨询主题 <span className="text-red-500">*</span>
        </label>
        <button
          className="w-full flex items-center justify-between bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-4 py-3.5 text-left"
          onClick={() => setShowSubjectPicker(!showSubjectPicker)}
        >
          <span className={`text-base ${form.subject ? 'text-[#F7F4EF]' : 'text-[#6B6762]'}`}>
            {form.subject || "请选择主题"}
          </span>
          <ChevronDown className="h-5 w-5 text-[#9B9691]" />
        </button>
        {showSubjectPicker && (
          <div className="absolute top-full left-0 right-0 z-10 bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg mt-1 overflow-hidden shadow-lg">
            {SUBJECT_OPTIONS.map((option) => (
              <button
                key={option}
                className={`w-full text-left px-4 py-3 text-sm ${form.subject === option ? 'text-[#E8825E] font-semibold bg-orange-500/10' : 'text-[#B8B4AF]'}`}
                onClick={() => {
                  updateField("subject", option);
                  setShowSubjectPicker(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Message */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold text-[#B8B4AF] tracking-[-0.1px]">
          咨询内容 <span className="text-red-500">*</span>
        </label>
        <textarea
          className="text-base text-[#F7F4EF] bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-4 py-3.5 min-h-[120px] leading-snug focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0A0A0C] focus:ring-[#E8825E] placeholder:text-[#6B6762]"
          placeholder="请详细描述您的需求..."
          value={form.message}
          onChange={(e) => updateField("message", e.target.value)}
          rows={4}
          maxLength={5000}
        />
      </div>

      {/* Submit */}
      <button
        className="py-4 rounded-xl flex items-center justify-center mt-1 bg-gradient-to-r from-[#E8825E] to-[#C77DBA] disabled:opacity-70 transition-opacity"
        onClick={handleSubmit}
        disabled={submitMutation.isPending}
      >
        {submitMutation.isPending ? (
          <Loader2 className="h-5 w-5 text-white animate-spin" />
        ) : (
          <span className="text-white text-lg font-semibold">提交留言</span>
        )}
      </button>
    </div>
  );
}

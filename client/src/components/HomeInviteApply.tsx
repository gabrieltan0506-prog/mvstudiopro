import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Send, CheckCircle, Loader2 } from "lucide-react";

export default function HomeInviteApply() {
  const [purpose, setPurpose] = useState("");
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.inviteApply.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!purpose.trim() || !contact.trim()) return;
    submit.mutate({ purpose: purpose.trim(), contact: contact.trim(), name: name.trim() || undefined });
  };

  return (
    <section id="invite-apply" className="w-full py-10 px-4 flex flex-col items-center scroll-mt-20">
      <div className="w-full max-w-xl bg-[var(--hp-card)] border border-[var(--hp-line)] rounded-2xl p-6 md:p-8 shadow-xl">
        <h2 className="text-xl font-bold text-[var(--hp-ink)] mb-1">申请邀请码</h2>
        <p className="text-sm text-[var(--hp-accent)] mb-6">内测阶段，填写申请后我们会通过微信或邮箱联系您</p>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle className="w-10 h-10 text-[var(--hp-success)]" />
            <p className="text-[var(--hp-ink)] font-semibold text-lg">申请已提交！</p>
            <p className="text-[var(--hp-accent)] text-sm">我们将通过您填写的联系方式与您沟通</p>
            <button
              onClick={() => { setSubmitted(false); setPurpose(""); setContact(""); setName(""); }}
              className="mt-4 text-xs text-[var(--hp-accent)] underline"
            >
              再次申请
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-[var(--hp-accent)] mb-1">姓名 / 昵称（选填）</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="您的称呼"
                maxLength={50}
                className="w-full rounded-lg bg-[var(--hp-card)] border border-[var(--hp-line)] px-4 py-2.5 text-[var(--hp-ink)] placeholder:text-[var(--hp-subtle)] text-sm focus:outline-none focus:border-[var(--hp-accent-line)] transition"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--hp-accent)] mb-1">
                用途 <span className="text-[var(--hp-danger)]">*</span>
              </label>
              <textarea
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="请描述您希望使用本平台的场景或目的（如：短视频内容创作、IP 孵化、品牌营销等）"
                maxLength={500}
                rows={4}
                required
                className="w-full rounded-lg bg-[var(--hp-card)] border border-[var(--hp-line)] px-4 py-2.5 text-[var(--hp-ink)] placeholder:text-[var(--hp-subtle)] text-sm resize-none focus:outline-none focus:border-[var(--hp-accent-line)] transition"
              />
              <p className="text-xs text-[var(--hp-subtle)] mt-1 text-right">{purpose.length}/500</p>
            </div>

            <div>
              <label className="block text-sm text-[var(--hp-accent)] mb-1">
                联系方式（微信 / 邮箱）<span className="text-[var(--hp-danger)]">*</span>
              </label>
              <input
                type="text"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="微信号 或 邮箱地址"
                maxLength={100}
                required
                className="w-full rounded-lg bg-[var(--hp-card)] border border-[var(--hp-line)] px-4 py-2.5 text-[var(--hp-ink)] placeholder:text-[var(--hp-subtle)] text-sm focus:outline-none focus:border-[var(--hp-accent-line)] transition"
              />
            </div>

            {submit.error && (
              <p className="text-[var(--hp-danger)] text-sm">{submit.error.message}</p>
            )}

            <button
              type="submit"
              disabled={submit.isPending || !purpose.trim() || !contact.trim()}
              className="flex items-center justify-center gap-2 mt-1 py-3 rounded-xl bg-gradient-to-r from-[var(--hp-peach)] to-[var(--hp-blush)] hover:from-[var(--hp-peach)] hover:to-[var(--hp-blush)] text-[var(--hp-ink)] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submit.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" />提交中…</>
              ) : (
                <><Send className="w-4 h-4" />提交申请</>
              )}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

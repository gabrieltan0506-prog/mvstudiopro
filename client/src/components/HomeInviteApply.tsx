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
    <section className="w-full py-10 px-4 flex flex-col items-center">
      <div className="w-full max-w-xl bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8 shadow-xl">
        <h2 className="text-xl font-bold text-white mb-1">申请邀请码</h2>
        <p className="text-sm text-purple-300/70 mb-6">内测阶段，填写申请后我们会通过微信或邮箱联系您</p>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle className="w-10 h-10 text-green-400" />
            <p className="text-white font-semibold text-lg">申请已提交！</p>
            <p className="text-purple-300/70 text-sm">我们将通过您填写的联系方式与您沟通</p>
            <button
              onClick={() => { setSubmitted(false); setPurpose(""); setContact(""); setName(""); }}
              className="mt-4 text-xs text-purple-400 underline"
            >
              再次申请
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-purple-200 mb-1">姓名 / 昵称（选填）</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="您的称呼"
                maxLength={50}
                className="w-full rounded-lg bg-white/8 border border-white/15 px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-purple-500 transition"
              />
            </div>

            <div>
              <label className="block text-sm text-purple-200 mb-1">
                用途 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="请描述您希望使用本平台的场景或目的（如：短视频内容创作、IP 孵化、品牌营销等）"
                maxLength={500}
                rows={4}
                required
                className="w-full rounded-lg bg-white/8 border border-white/15 px-4 py-2.5 text-white placeholder:text-white/30 text-sm resize-none focus:outline-none focus:border-purple-500 transition"
              />
              <p className="text-xs text-white/30 mt-1 text-right">{purpose.length}/500</p>
            </div>

            <div>
              <label className="block text-sm text-purple-200 mb-1">
                联系方式（微信 / 邮箱）<span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="微信号 或 邮箱地址"
                maxLength={100}
                required
                className="w-full rounded-lg bg-white/8 border border-white/15 px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-purple-500 transition"
              />
            </div>

            {submit.error && (
              <p className="text-red-400 text-sm">{submit.error.message}</p>
            )}

            <button
              type="submit"
              disabled={submit.isPending || !purpose.trim() || !contact.trim()}
              className="flex items-center justify-center gap-2 mt-1 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
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

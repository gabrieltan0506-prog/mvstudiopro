/**
 * 管理者全站悬浮 Pro Agent（Responses Pro · 多轮）。
 * 仅 supervisor / admin / ?supervisor=1 可见。
 */
import { useCallback, useMemo, useState } from "react";
import { Bot, Loader2, MessageSquare, X } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";
import { getSupervisorTrpcToken } from "@/lib/supervisorTrpcToken";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type ChatMsg = { role: "user" | "assistant"; content: string };

export default function PlatformProAgentDock() {
  const { user } = useAuth();
  const supervisorAccess = useMemo(() => hasSupervisorAccess(), []);
  const canSee =
    supervisorAccess || user?.role === "admin" || user?.role === "supervisor";

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const chatMutation = trpc.mvAnalysis.chatPlatformProAgent.useMutation();

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    const tok = getSupervisorTrpcToken();
    void (async () => {
      try {
        const res = await chatMutation.mutateAsync({
          messages: next,
          ...(tok ? { supervisorToken: tok } : {}),
        });
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Pro Agent 失败");
      }
    })();
  }, [input, messages, chatMutation]);

  if (!canSee) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto flex h-[min(70vh,520px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-violet-400/40 bg-[#0a0618]/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-violet-100">
              <Bot className="h-4 w-4" aria-hidden />
              Pro Agent
              <span className="rounded border border-violet-400/35 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                Responses Pro · 管理者
              </span>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
              onClick={() => setOpen(false)}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
            {messages.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-white/45">
                多轮参谋对话（不计用户免费额度）。可问选题策略、Skill 池、趋势库与 IA。
              </p>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={`rounded-xl px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ml-6 border border-sky-400/25 bg-sky-500/10 text-sky-50"
                    : "mr-4 border border-violet-400/25 bg-violet-500/10 text-violet-50"
                }`}
              >
                {m.content}
              </div>
            ))}
            {chatMutation.isPending ? (
              <div className="inline-flex items-center gap-1.5 text-[11px] text-violet-200/80">
                <Loader2 className="h-3 w-3 animate-spin" />
                Pro 思考中…
              </div>
            ) : null}
          </div>
          <div className="border-t border-white/10 p-2.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              placeholder="对 Pro Agent 说…"
              className="w-full resize-none rounded-lg border border-white/15 bg-black/40 px-2.5 py-2 text-[12px] text-white placeholder:text-white/30 focus:border-violet-400/50 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              disabled={chatMutation.isPending || !input.trim()}
              onClick={send}
              className="mt-2 w-full rounded-lg border border-violet-400/40 bg-violet-500/20 py-1.5 text-[12px] font-bold text-violet-100 hover:bg-violet-500/30 disabled:opacity-50"
            >
              发送
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-violet-400/45 bg-violet-600/90 px-3.5 py-2.5 text-[12px] font-bold text-white shadow-lg hover:bg-violet-500"
      >
        <MessageSquare className="h-4 w-4" aria-hidden />
        {open ? "收起 Pro" : "Pro Agent"}
      </button>
    </div>
  );
}

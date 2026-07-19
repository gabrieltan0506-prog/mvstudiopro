/**
 * 管理者 Pro Agent（Responses Pro · 多轮）。
 * 入口固定在右上（顶栏下方），避免与左下 PWA「新增到手机桌面」叠挡。
 * 打开：点本组件按钮，或 `window.dispatchEvent(new Event(PRO_AGENT_OPEN_EVENT))`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, MessageSquare, Paperclip, X } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";
import { getSupervisorTrpcToken } from "@/lib/supervisorTrpcToken";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export const PRO_AGENT_OPEN_EVENT = "mvs:pro-agent-open";
export const PRO_AGENT_TOGGLE_EVENT = "mvs:pro-agent-toggle";

export function requestOpenProAgent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PRO_AGENT_OPEN_EVENT));
}

export function requestToggleProAgent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PRO_AGENT_TOGGLE_EVENT));
}

type ChatMsg = { role: "user" | "assistant"; content: string };

type PendingFile = {
  name: string;
  mimeType: string;
  dataBase64: string;
  byteLength: number;
};

const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,.html,.doc,.docx,.ppt,.pptx,.xls,.xlsx,application/pdf,image/*";

const MAX_FILES = 4;
const MAX_BYTES = 20 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function PlatformProAgentDock() {
  const { user } = useAuth();
  const supervisorAccess = useMemo(() => hasSupervisorAccess(), []);
  const canSee =
    supervisorAccess || user?.role === "admin" || user?.role === "supervisor";

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatMutation = trpc.mvAnalysis.chatPlatformProAgent.useMutation();

  useEffect(() => {
    if (!canSee) return;
    const onOpen = () => setOpen(true);
    const onToggle = () => setOpen((v) => !v);
    window.addEventListener(PRO_AGENT_OPEN_EVENT, onOpen);
    window.addEventListener(PRO_AGENT_TOGGLE_EVENT, onToggle);
    return () => {
      window.removeEventListener(PRO_AGENT_OPEN_EVENT, onOpen);
      window.removeEventListener(PRO_AGENT_TOGGLE_EVENT, onToggle);
    };
  }, [canSee]);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (accepted.length >= MAX_FILES) {
        toast.message(`最多 ${MAX_FILES} 个附件`);
        break;
      }
      if (/^video\//i.test(file.type) || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name)) {
        toast.error(
          `「${file.name}」是视频：OpenAI Responses 暂无原生视频输入，请改传截图或 PDF/文稿。`,
        );
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`「${file.name}」超过 20MB`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        accepted.push({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64: dataUrl,
          byteLength: file.size,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "读取失败");
      }
    }
    if (accepted.length) {
      setPending((prev) => {
        const room = Math.max(0, MAX_FILES - prev.length);
        return room > 0 ? [...prev, ...accepted.slice(0, room)] : prev;
      });
    }
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if ((!text && pending.length === 0) || chatMutation.isPending) return;
    const userLine =
      text ||
      (pending.length
        ? `请分析附件：${pending.map((p) => p.name).join("、")}`
        : "");
    const next: ChatMsg[] = [...messages, { role: "user", content: userLine }];
    setMessages(next);
    setInput("");
    const attachments = pending.map((p) => ({
      name: p.name,
      mimeType: p.mimeType,
      dataBase64: p.dataBase64,
      byteLength: p.byteLength,
    }));
    setPending([]);
    const tok = getSupervisorTrpcToken();
    void (async () => {
      try {
        const res = await chatMutation.mutateAsync({
          messages: next,
          ...(attachments.length ? { attachments } : {}),
          ...(tok ? { supervisorToken: tok } : {}),
        });
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Pro Agent 失败");
      }
    })();
  }, [input, messages, pending, chatMutation]);

  if (!canSee) return null;

  /* 右上 · 顶栏下方；左下留给 PWA。勿再占用 bottom-right。 */
  return (
    <div className="pointer-events-none fixed right-3 top-[4.5rem] z-[60] flex flex-col items-end gap-2 sm:right-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-violet-400/45 bg-violet-600/90 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg hover:bg-violet-500"
        title="管理者 Pro Agent"
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {open ? "收起 Pro" : "Pro Agent"}
      </button>
      {open ? (
        <div className="pointer-events-auto flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-violet-400/40 bg-[#0a0618]/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-md">
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
                多轮参谋 · 可上传 <strong className="text-white/70">PDF</strong>
                （官方提取文字+页图）、图片、Office/文本。 视频暂不支持（Responses 无原生
                video input）。
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
                Pro 分析中…
              </div>
            ) : null}
          </div>
          <div className="border-t border-white/10 p-2.5">
            {pending.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pending.map((p) => (
                  <span
                    key={`${p.name}-${p.byteLength}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-violet-400/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-100"
                  >
                    <span className="truncate">{p.name}</span>
                    <button
                      type="button"
                      className="shrink-0 text-violet-200/70 hover:text-white"
                      onClick={() => setPending((prev) => prev.filter((x) => x !== p))}
                      aria-label={`移除 ${p.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              placeholder="对 Pro Agent 说…（可附 PDF/图片）"
              className="w-full resize-none rounded-lg border border-white/15 bg-black/40 px-2.5 py-2 text-[12px] text-white placeholder:text-white/30 focus:border-violet-400/50 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => void addFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={chatMutation.isPending || pending.length >= MAX_FILES}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                title="PDF / 图片 / Office / 文本"
              >
                <Paperclip className="h-3.5 w-3.5" />
                附件
              </button>
              <button
                type="button"
                disabled={chatMutation.isPending || (!input.trim() && pending.length === 0)}
                onClick={send}
                className="flex-1 rounded-lg border border-violet-400/40 bg-violet-500/20 py-1.5 text-[12px] font-bold text-violet-100 hover:bg-violet-500/30 disabled:opacity-50"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

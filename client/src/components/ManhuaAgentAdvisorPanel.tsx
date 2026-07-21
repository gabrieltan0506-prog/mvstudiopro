/**
 * 创作顾问：会话 UI（代理 sidecar Agent Loop）。
 * 前台不出现上游开源项目名 / 供应商名。
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Sparkles, WifiOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { ManhuaWorkbenchSyncPayload } from "@shared/manhuaAgentLoopSync";
import { toast } from "sonner";

const SESSION_STORAGE_KEY = "manhua-advisor-session-id";

type ChatLine = { role: "user" | "assistant"; text: string };

type Props = {
  topic?: string;
  factoryBusy?: boolean;
  /** 与工厂忙碌互斥：顾问跑规划时也视为忙 */
  onAdvisorBusyChange?: (busy: boolean) => void;
  onApplySync?: (sync: ManhuaWorkbenchSyncPayload) => void;
  onConfirmVisualBrief?: () => void;
  onRequestKeyarts?: (shotIndexes?: number[]) => void;
  onRequestClips?: (shotIndexes?: number[]) => void;
  onUpdateBeatsText?: (text: string) => void;
  onUpdateStoryText?: (text: string) => void;
  compact?: boolean;
};

function shotIndexesFromPayload(payload: Record<string, unknown> | undefined): number[] | undefined {
  const raw = payload?.shotIndexes;
  if (!Array.isArray(raw)) return undefined;
  const nums = raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 1);
  return nums.length ? nums : undefined;
}

export default function ManhuaAgentAdvisorPanel({
  topic,
  factoryBusy,
  onAdvisorBusyChange,
  onApplySync,
  onConfirmVisualBrief,
  onRequestKeyarts,
  onRequestClips,
  onUpdateBeatsText,
  onUpdateStoryText,
  compact,
}: Props) {
  const [sessionId, setSessionId] = useState(() => {
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [open, setOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastSyncKeyRef = useRef("");

  const statusQuery = trpc.manhuaAgentLoop.status.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const available = Boolean(statusQuery.data?.available);

  const createSession = trpc.manhuaAgentLoop.createSession.useMutation();
  const chatMutation = trpc.manhuaAgentLoop.chat.useMutation();
  const consumeAction = trpc.manhuaAgentLoop.consumePendingAction.useMutation();
  const sessionQuery = trpc.manhuaAgentLoop.getSession.useQuery(
    { sessionId },
    {
      enabled: Boolean(sessionId) && available,
      refetchInterval: available && sessionId ? 12_000 : false,
      retry: false,
    },
  );

  const busy =
    createSession.isPending || chatMutation.isPending || Boolean(factoryBusy);

  useEffect(() => {
    onAdvisorBusyChange?.(createSession.isPending || chatMutation.isPending);
  }, [createSession.isPending, chatMutation.isPending, onAdvisorBusyChange]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const applySyncIfAny = (sync: ManhuaWorkbenchSyncPayload | null | undefined) => {
    if (!sync) return;
    const key = `${sync.shots.length}|${sync.storyText.slice(0, 80)}|${sync.beatsMarkdown.slice(0, 120)}`;
    if (key === lastSyncKeyRef.current) return;
    lastSyncKeyRef.current = key;
    onApplySync?.(sync);
    if (sync.beatsMarkdown) onUpdateBeatsText?.(sync.beatsMarkdown);
    if (sync.storyText) onUpdateStoryText?.(sync.storyText);
  };

  const handlePendingActions = async (
    actions: Array<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      consumed?: boolean;
    }>,
  ) => {
    for (const action of actions) {
      if (action.consumed) continue;
      try {
        if (action.type === "confirm_visual_brief") {
          onConfirmVisualBrief?.();
        } else if (action.type === "generate_keyarts") {
          if (factoryBusy) {
            toast.message("工厂忙碌中", { description: "出图请求已记下，请稍后再点生成。" });
          } else {
            onRequestKeyarts?.(shotIndexesFromPayload(action.payload));
          }
        } else if (action.type === "generate_clips") {
          if (factoryBusy) {
            toast.message("工厂忙碌中", { description: "出片请求已记下，请稍后再点生成。" });
          } else {
            onRequestClips?.(shotIndexesFromPayload(action.payload));
          }
        } else if (action.type === "update_beats") {
          const text = String(action.payload.beatsText || "");
          if (text) onUpdateBeatsText?.(text);
        } else if (action.type === "update_story") {
          const text = String(action.payload.storyText || "");
          if (text) onUpdateStoryText?.(text);
        }
        if (sessionId) {
          await consumeAction.mutateAsync({ sessionId, actionId: action.id });
        }
      } catch {
        /* keep pending for next poll */
      }
    }
  };

  useEffect(() => {
    const pending = sessionQuery.data?.pendingActions;
    if (pending?.length) {
      void handlePendingActions(pending);
    }
    if (sessionQuery.data?.sync) {
      applySyncIfAny(sessionQuery.data.sync);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll-driven
  }, [sessionQuery.dataUpdatedAt]);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await createSession.mutateAsync({
      idea: topic || "",
      projectName: (topic || "manhua").slice(0, 40),
    });
    setSessionId(res.sessionId);
    return res.sessionId;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!available) {
      toast.message("创作顾问暂不可用", {
        description: "可继续用工作台一键工厂出图出片。",
      });
      return;
    }
    setDraft("");
    setLines((prev) => [...prev, { role: "user", text }]);
    try {
      const sid = await ensureSession();
      const res = await chatMutation.mutateAsync({ sessionId: sid, message: text });
      setLines((prev) => [
        ...prev,
        { role: "assistant", text: res.assistant || "已处理本轮请求。" },
      ]);
      applySyncIfAny(res.sync);
      if (res.pendingActions?.length) {
        await handlePendingActions(res.pendingActions);
      }
      if (res.sync?.shots?.length) {
        toast.success(`已同步 ${res.sync.shots.length} 个分镜到产物`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "发送失败";
      setLines((prev) => [
        ...prev,
        { role: "assistant", text: `暂时无法回复：${msg}。可改用一键工厂。` },
      ]);
    }
  };

  const startFresh = async () => {
    if (!available || busy) return;
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSessionId("");
    setLines([]);
    const res = await createSession.mutateAsync({
      idea: topic || "",
      projectName: (topic || "manhua").slice(0, 40),
    });
    setSessionId(res.sessionId);
    toast.message("已开新会话", { description: "刷新后仍可从本机会话继续。" });
  };

  return (
    <section
      data-manhua-panel="creative-advisor"
      className={`rounded-lg border border-white/10 bg-black/30 ${compact ? "p-2" : "p-2.5"}`}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" />
          <span className="truncate text-[11px] font-semibold text-white/85">创作顾问</span>
          {!available ? (
            <WifiOff className="h-3 w-3 shrink-0 text-white/35" aria-label="暂不可用" />
          ) : null}
        </button>
        <button
          type="button"
          disabled={!available || busy}
          onClick={() => void startFresh()}
          className="text-[9px] text-white/40 hover:text-white/70 disabled:opacity-40"
        >
          新会话
        </button>
      </div>

      {open ? (
        <div className="mt-2 space-y-2">
          {!available ? (
            <p className="text-[10px] leading-relaxed text-white/45">
              顾问服务未接入时，工作台一键工厂仍可用：确认简报 → 分镜静帧 → 成片。
            </p>
          ) : (
            <p className="text-[10px] leading-relaxed text-white/40">
              用对话规划故事与分镜；出静帧/成片仍走本站积分。与工厂生成互斥。
            </p>
          )}

          <div
            className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-white/8 bg-black/40 px-2 py-1.5"
            data-manhua-advisor-transcript
          >
            {lines.length === 0 ? (
              <p className="text-[10px] text-white/30">
                例如：「根据当前题材写一集竖屏分镜，先出节拍不要出图」
              </p>
            ) : (
              lines.map((line, i) => (
                <div
                  key={`${line.role}-${i}`}
                  className={
                    line.role === "user"
                      ? "text-[10px] text-cyan-100/85"
                      : "text-[10px] text-white/70"
                  }
                >
                  <span className="mr-1 text-white/35">
                    {line.role === "user" ? "我" : "顾问"}
                  </span>
                  {line.text}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              disabled={!available || busy}
              placeholder={available ? "跟创作顾问说…" : "顾问暂不可用"}
              className="min-h-[52px] flex-1 resize-none rounded-md border border-white/12 bg-black/50 px-2 py-1.5 text-[11px] text-white/90 placeholder:text-white/25 disabled:opacity-45"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              disabled={!available || busy || !draft.trim()}
              onClick={() => void send()}
              className="inline-flex h-auto shrink-0 items-center gap-1 self-stretch rounded-md border border-cyan-300/40 bg-cyan-500/20 px-2 text-[10px] font-semibold text-cyan-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              发送
            </button>
          </div>

          {sessionId ? (
            <p className="truncate text-[9px] text-white/25" title={sessionId}>
              会话已保存 · 刷新可继续
            </p>
          ) : null}

          {sessionQuery.data?.sync?.shots?.length ? (
            <div
              data-manhua-advisor-artifacts
              className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1.5"
            >
              <div className="text-[10px] font-semibold text-white/55">产物</div>
              <div className="mt-0.5 text-[10px] text-white/45">
                {sessionQuery.data.sync.shots.length} 镜已同步
                {sessionQuery.data.sync.storyText ? " · 含故事" : ""}
                {sessionQuery.data.sync.charactersSummary ? " · 含角色" : ""}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 创作顾问（Canvas 工作台）：走与平台同路的标准问答（Terra 额度桶），
 * 不再依赖未上线的侧车。前台不写模型名/供应商名。
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { ManhuaWorkbenchSyncPayload } from "@shared/manhuaAgentLoopSync";
import {
  PLATFORM_SKILL_QA_TERRA_DAILY_FREE,
  platformSkillQaPaidCredits,
} from "@shared/plans";
import { toast } from "sonner";

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

function buildCanvasAdvisorQuestion(topic: string | undefined, userText: string): string {
  const theme = String(topic || "").trim();
  return [
    "【漫剧工厂工作台·创作顾问】",
    theme ? `当前题材/项目：${theme}` : "当前题材：未命名",
    "请用简体中文直接回答用户。若用户要一集竖屏分镜或故事，请在回答中尽量包含「## 故事大纲」与「## 分镜表」段落，便于同步到工作台。",
    "出静帧/成片由用户在工作台确认视觉简报后操作，你只做文案与分镜规划，不要假装已出图。",
    "",
    "【用户提问】",
    userText.trim(),
  ].join("\n");
}

/** 从顾问回答里软提取故事/分镜，尽量同步到工作台（无则忽略） */
function softSyncFromAnswer(answer: string): {
  storyText?: string;
  beatsMarkdown?: string;
} {
  const text = String(answer || "");
  const story =
    text.match(/##\s*故事大纲\s*\n+([\s\S]*?)(?=\n##\s|$)/i)?.[1]?.trim() ||
    text.match(/##\s*故事\s*\n+([\s\S]*?)(?=\n##\s|$)/i)?.[1]?.trim() ||
    "";
  const beats =
    text.match(/##\s*分镜表\s*\n+([\s\S]*?)(?=\n##\s|$)/i)?.[1]?.trim() ||
    text.match(/##\s*镜头节拍\s*\n+([\s\S]*?)(?=\n##\s|$)/i)?.[1]?.trim() ||
    "";
  return {
    storyText: story || undefined,
    beatsMarkdown: beats
      ? `## 分镜表\n${beats}`
      : undefined,
  };
}

export default function ManhuaAgentAdvisorPanel({
  topic,
  factoryBusy,
  onAdvisorBusyChange,
  onApplySync,
  onUpdateBeatsText,
  onUpdateStoryText,
  compact,
}: Props) {
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [open, setOpen] = useState(true);
  const [remainingFree, setRemainingFree] = useState<number | null>(null);
  const [lastSyncHint, setLastSyncHint] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const askMutation = trpc.mvAnalysis.askPlatformSkillQa.useMutation();
  const busy = askMutation.isPending || Boolean(factoryBusy);
  const paidUnit = platformSkillQaPaidCredits("terra");

  useEffect(() => {
    onAdvisorBusyChange?.(askMutation.isPending);
  }, [askMutation.isPending, onAdvisorBusyChange]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  const applySoftSync = (answer: string) => {
    const soft = softSyncFromAnswer(answer);
    if (!soft.storyText && !soft.beatsMarkdown) return;
    const sync: ManhuaWorkbenchSyncPayload = {
      shots: [],
      storyText: soft.storyText || "",
      scriptText: soft.storyText || "",
      beatsMarkdown: soft.beatsMarkdown || "",
      charactersSummary: "",
    };
    onApplySync?.(sync);
    if (soft.beatsMarkdown) onUpdateBeatsText?.(soft.beatsMarkdown);
    if (soft.storyText) onUpdateStoryText?.(soft.storyText);
    const parts = [
      soft.beatsMarkdown ? "分镜表" : "",
      soft.storyText ? "故事" : "",
    ].filter(Boolean);
    setLastSyncHint(parts.length ? `已尝试同步：${parts.join(" · ")}` : "");
    if (parts.length) {
      toast.success(`已同步${parts.join("与")}到工作台`);
    }
  };

  const sendWithConfirm = async (userText: string, confirmPaid: boolean) => {
    const res = await askMutation.mutateAsync({
      question: buildCanvasAdvisorQuestion(topic, userText),
      qaModel: "gpt-5.6-terra",
      confirmPaid,
    });
    setRemainingFree(res.remainingFreeToday);
    const answer = String(res.answer || "").trim() || "已处理本轮请求。";
    setLines((prev) => [...prev, { role: "assistant", text: answer }]);
    applySoftSync(answer);
    if (res.paidThisTurn && res.creditsCharged > 0) {
      toast.message(`已扣 ${res.creditsCharged} 积分（超额问答）`);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (text.length < 2) {
      toast.message("请多写一点问题");
      return;
    }
    setDraft("");
    setLines((prev) => [...prev, { role: "user", text }]);

    let confirmPaid = false;
    if (remainingFree != null && remainingFree <= 0) {
      const ok = window.confirm(
        `今日免费 ${PLATFORM_SKILL_QA_TERRA_DAILY_FREE} 次已用完。继续将扣除 ${paidUnit} 积分/次。确认？`,
      );
      if (!ok) {
        setLines((prev) => prev.slice(0, -1));
        setDraft(text);
        return;
      }
      confirmPaid = true;
    }

    try {
      await sendWithConfirm(text, confirmPaid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/免费.*已用完|PAYMENT_REQUIRED|扣除/.test(msg) && !confirmPaid) {
        const ok = window.confirm(`${msg}\n\n确认扣点继续？`);
        if (ok) {
          try {
            await sendWithConfirm(text, true);
            return;
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : "发送失败";
            setLines((prev) => [
              ...prev,
              { role: "assistant", text: `暂时无法回复：${msg2}。可改用一键工厂。` },
            ]);
            return;
          }
        }
        setLines((prev) => prev.slice(0, -1));
        setDraft(text);
        return;
      }
      const friendly = /未登录|UNAUTHORIZED|登录/.test(msg)
        ? "请先登录后再使用创作顾问"
        : msg;
      setLines((prev) => [
        ...prev,
        { role: "assistant", text: `暂时无法回复：${friendly}。可改用一键工厂。` },
      ]);
    }
  };

  const startFresh = () => {
    if (busy) return;
    setLines([]);
    setLastSyncHint("");
    toast.message("已清空对话", { description: "额度仍按今日累计，不会重置。" });
  };

  return (
    <section
      data-manhua-panel="creative-advisor"
      data-manhua-advisor-backend="platform-skill-qa-terra"
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
          <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-500/10 px-1 py-0.5 text-[9px] text-emerald-100/80">
            已接通
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={startFresh}
          className="text-[9px] text-white/40 hover:text-white/70 disabled:opacity-40"
        >
          清空
        </button>
      </div>

      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] leading-relaxed text-white/40">
            对话规划故事与分镜（与平台创作顾问同额度：每日免费{" "}
            {PLATFORM_SKILL_QA_TERRA_DAILY_FREE} 次
            {remainingFree != null ? ` · 今日剩 ${remainingFree}` : ""}
            ，超额 {paidUnit} 积分/次）。出静帧/成片仍走工作台。
          </p>

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
              disabled={busy}
              placeholder="跟创作顾问说…"
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
              disabled={busy || !draft.trim()}
              onClick={() => void send()}
              className="inline-flex h-auto shrink-0 items-center gap-1 self-stretch rounded-md border border-cyan-300/40 bg-cyan-500/20 px-2 text-[10px] font-semibold text-cyan-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              发送
            </button>
          </div>

          {lastSyncHint ? (
            <p className="text-[9px] text-white/35" data-manhua-advisor-artifacts>
              {lastSyncHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

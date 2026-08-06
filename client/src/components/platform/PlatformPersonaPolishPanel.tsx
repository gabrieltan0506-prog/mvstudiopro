import { useMemo, useState } from "react";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import {
  applyPersonaPolishOption,
  PLATFORM_TOPIC_GOALS,
  type PlatformPersonaPolishOption,
  type PlatformPersonaPolishResult,
  type PlatformTopicGoalId,
} from "@shared/platformPersonaPolish";

/**
 * 人物背景「智能优化」。
 *
 * 不是一键替换：跑完给的是改写后的全文 + 2–3 条要用户自己拿主意的问题
 * （哪句太笼统、哪句跑题、缺了受众还是商业目标）。用户点完选项，
 * 文本在本地确定性地拼好，不再回服务端第二次烧钱。
 *
 * 选题方向三选常驻显示——它不只是装饰，会作为独立参数进选题提示词。
 */

type Props = {
  /** 当前人物背景全文 */
  value: string;
  /** 用户点「采用」时回写 */
  onApply: (next: string) => void;
  goal: PlatformTopicGoalId | null;
  onGoalChange: (next: PlatformTopicGoalId | null) => void;
  id?: string;
};

const GOAL_TONE: Record<PlatformTopicGoalId, string> = {
  acquire: "border-[#49e6ff]/45 bg-[rgba(73,230,255,0.12)] text-[#8cefff]",
  convert: "border-[#fbbf24]/45 bg-[rgba(251,191,36,0.12)] text-[#fde68a]",
  follow: "border-[#a78bfa]/45 bg-[rgba(167,139,250,0.14)] text-[#ddd0ff]",
};

export function PlatformPersonaPolishPanel({ value, onApply, goal, onGoalChange, id }: Props) {
  const [result, setResult] = useState<PlatformPersonaPolishResult | null>(null);
  const [draft, setDraft] = useState("");
  /** 每条问题选了哪个选项；"keep" 表示保持原样 */
  const [picked, setPicked] = useState<Record<string, string>>({});

  const quotaQuery = trpc.mvAnalysis.platformPersonaPolishQuota.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const polishMutation = trpc.mvAnalysis.polishPlatformPersona.useMutation();

  const quota = quotaQuery.data;
  const busy = polishMutation.isPending;

  const costLabel = useMemo(() => {
    if (!quota) return "";
    if (quota.nextFree) {
      return quota.firstFreeLeft > 0 ? `免费 · 还剩 ${quota.firstFreeLeft} 次` : "今日免费";
    }
    return `${quota.nextCredits} 积分`;
  }, [quota]);

  const run = async () => {
    const persona = value.trim();
    if (persona.length < 8) {
      toast.error("先写一句人话：你是谁、做什么赛道，再点优化。");
      return;
    }
    try {
      const res = await polishMutation.mutateAsync({
        persona,
        currentGoal: goal ?? undefined,
      });
      setResult(res);
      setDraft(res.polished);
      setPicked({});
      if (!goal && res.suggestedGoal) onGoalChange(res.suggestedGoal);
      void quotaQuery.refetch();
      toast.success(res.wasFree ? "优化完成（本次免费）" : `优化完成（扣 ${res.chargedCredits} 积分）`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(sanitizePlatformUserMessage(msg, "优化暂时用不了，请稍后重试"));
    }
  };

  const choose = (questionId: string, option: PlatformPersonaPolishOption | null) => {
    setPicked((prev) => ({ ...prev, [questionId]: option ? option.id : "keep" }));
    if (option) setDraft((prev) => applyPersonaPolishOption(prev, option));
  };

  const adopt = () => {
    const next = draft.trim();
    if (!next) return;
    onApply(next);
    setResult(null);
    toast.success("已采用优化后的背景");
  };

  return (
    <div id={id} className="mt-3 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-bold text-white">
          <Wand2 className="h-4 w-4 shrink-0 text-[#c4b5fd]" aria-hidden />
          智能优化
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/40 bg-[rgba(167,139,250,0.12)] px-3 py-1.5 text-[12px] font-semibold text-[#ddd0ff] transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "正在读你的背景…" : result ? "重新优化" : "帮我理一理"}
          {costLabel ? <span className="text-[11px] font-medium opacity-70">· {costLabel}</span> : null}
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-[#c9c0e6]/60">
        文笔不重要，说清楚就行。写得笼统也没关系，点一下我帮你理顺，再问你两三个问题补齐。
      </p>

      {/* 选题方向：常驻，不依赖优化结果 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-[#c9c0e6]/45">这轮想要：</span>
        {PLATFORM_TOPIC_GOALS.map((g) => {
          const active = goal === g.id;
          return (
            <button
              key={g.id}
              type="button"
              title={g.hint}
              onClick={() => onGoalChange(active ? null : g.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                active ? GOAL_TONE[g.id] : "border-white/12 text-[#c9c0e6]/70 hover:border-white/25 hover:text-white"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {result ? (
        <div className="mt-4 space-y-3">
          {result.careLine ? (
            <p className="rounded-xl border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.07)] px-3 py-2 text-[12px] leading-relaxed text-[#bfefff]">
              {result.careLine}
            </p>
          ) : null}

          <div>
            <div className="text-[11px] font-semibold text-[#c9c0e6]/50">改写后</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="mt-1.5 w-full rounded-xl border border-white/12 bg-[#0c061e] px-3.5 py-3 text-[13px] leading-relaxed text-white outline-none focus:border-[#a78bfa]/45"
            />
          </div>

          {result.changes.length ? (
            <ul className="space-y-1">
              {result.changes.map((c, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-[#c9c0e6]/70">
                  <Check className="mt-[3px] h-3 w-3 shrink-0 text-emerald-300/80" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.questions.map((q) => (
            <div key={q.id} className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
              <div className="text-[12px] font-semibold text-white/90">{q.question}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const active = picked[q.id] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={Boolean(picked[q.id])}
                      onClick={() => choose(q.id, opt)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-45 ${
                        active
                          ? "border-emerald-300/45 bg-[rgba(52,211,153,0.14)] text-emerald-200"
                          : "border-white/12 text-[#c9c0e6]/75 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={Boolean(picked[q.id])}
                  onClick={() => choose(q.id, null)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-45 ${
                    picked[q.id] === "keep"
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 text-[#c9c0e6]/50 hover:text-white/80"
                  }`}
                >
                  {q.keepLabel || "保持原样"}
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={adopt}
              className="rounded-lg bg-[#a78bfa] px-3.5 py-2 text-[12px] font-bold text-[#1b1030] transition hover:brightness-110"
            >
              采用这段背景
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="rounded-lg border border-white/12 px-3 py-2 text-[12px] font-medium text-[#c9c0e6]/70 transition hover:text-white"
            >
              不用了
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

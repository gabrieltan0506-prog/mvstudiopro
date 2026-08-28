/**
 * 创作顾问 v1 · 漫剧工厂右侧可收合面板。
 *
 * 产品边界（0826 拍板 + 0827 方案裁剪，v1 只读）：
 * - 只诊断/解释/推荐，不写入任何正式产物；付费生产永远不经聊天授权。
 * - 底料=匿名模板卡 + 去名化手法卡（组装在 lib/manhuaCreativeAdvisorContext，测试守泄漏）。
 * - 计费走现有 askPlatformSkillQa：免费额度用尽 → PAYMENT_REQUIRED → 面板内明价确认。
 * - 答案点名模板时挂「用这个模板试写 →」直通剧情增强试写（闭环第二段的入口）。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  buildAdvisorQuestion,
  findMentionedTemplates,
} from "@/lib/manhuaCreativeAdvisorContext";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

type AdvisorTurn = {
  id: string;
  role: "user" | "advisor";
  text: string;
  /** 顾问答案里点名的模板（挂试写按钮用） */
  mentioned?: PublicManhuaViralTemplateCard[];
};

export default function ManhuaCreativeAdvisorPanel(props: {
  open: boolean;
  onClose: () => void;
  /** 当前阶段条 label（如「资产设定」），仅作上下文展示 */
  stageZh?: string;
  /** 已选剧情增强模板（匿名卡） */
  selectedTemplate?: PublicManhuaViralTemplateCard | null;
  /** 可引用的 approved 模板（匿名卡，来自 listApprovedPublic） */
  templates: PublicManhuaViralTemplateCard[];
  /**
   * 「用这个模板试写」动作。由宿主决定语义：
   * 已接试写链路时直通试写；未接时至少选中模板并引导到剧情增强区。
   */
  onRequestTrial: (template: PublicManhuaViralTemplateCard) => void;
}) {
  const { open, onClose, stageZh, selectedTemplate, templates, onRequestTrial } = props;
  const [turns, setTurns] = useState<AdvisorTurn[]>([]);
  const [draft, setDraft] = useState("");
  /** 超额确认态：PAYMENT_REQUIRED 后带着原问题等用户点「确认扣点」 */
  const [pendingPaid, setPendingPaid] = useState<{ question: string; priceHintZh: string } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const askMutation = trpc.mvAnalysis.askPlatformSkillQa.useMutation();

  const scrollToEnd = useCallback(() => {
    window.setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, 30);
  }, []);

  const send = useCallback(
    async (rawQuestion: string, confirmPaid: boolean) => {
      const question = rawQuestion.trim();
      if (question.length < 2) {
        toast.error("问题太短，说说你卡在哪");
        return;
      }
      if (askMutation.isPending) return; // 防连点：一次一问
      setPendingPaid(null);
      // 超额确认重发的是同一个问题，气泡已经在对话里——别再追加一条重复提问
      if (!confirmPaid) {
        setTurns((prev) => [
          ...prev,
          { id: `u-${Date.now()}`, role: "user", text: question },
        ]);
      }
      setDraft("");
      scrollToEnd();
      try {
        const res = await askMutation.mutateAsync({
          question: buildAdvisorQuestion({
            question,
            stageZh,
            selectedTemplate,
            templates,
          }),
          confirmPaid: confirmPaid || undefined,
        });
        const answer = String(res.answer || "").trim() || "（这次没答上来，换个问法试试）";
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "advisor",
            text: answer,
            mentioned: findMentionedTemplates(answer, templates),
          },
        ]);
        if (res.paidThisTurn && res.creditsCharged > 0) {
          toast.message(`本次问答扣 ${res.creditsCharged} 积分`, {
            description: `今日免费额度已用完（${res.usedToday}/${res.dailyLimit}）`,
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "问答失败";
        // 免费额度用尽：把原问题挂起，面板内明价确认后重发（不静默扣费）
        if (/已用完|PAYMENT_REQUIRED|扣除.*积分/.test(msg)) {
          setPendingPaid({ question, priceHintZh: msg });
        } else {
          toast.error("顾问没回上来", { description: msg });
        }
      }
      scrollToEnd();
    },
    [askMutation, scrollToEnd, selectedTemplate, stageZh, templates],
  );

  const quickQuestions = useMemo(
    () => [
      "这一集为什么不够吸引人？",
      selectedTemplate
        ? `「${selectedTemplate.nameZh}」该怎么用才不落俗套？`
        : "哪个模板适合我现在的故事？",
      "这场对峙戏适合哪种拍法？",
    ],
    [selectedTemplate],
  );

  if (!open) return null;

  return (
    <aside
      data-manhua-creative-advisor
      className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[380px] flex-col border-l border-white/10 bg-[#0d0c18]/95 shadow-2xl backdrop-blur"
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white">创作顾问</div>
          <div className="truncate text-[11px] text-white/45">
            阶段：{stageZh || "—"} · 剧情增强：{selectedTemplate ? selectedTemplate.nameZh : "未选择"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-xs text-white/60 hover:text-white"
        >
          收起
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] leading-relaxed text-white/50">
              我熟悉你的模板库与导演手法库。问我该选哪个模板、这场戏怎么拍、
              节奏为什么不对——答案只依据库里学到的真实内容。
            </p>
            {quickQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q, false)}
                className="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12px] text-white/75 transition hover:border-cyan-300/40 hover:text-white"
              >
                {q}
              </button>
            ))}
          </div>
        ) : (
          turns.map((t) => (
            <div key={t.id} className={t.role === "user" ? "text-right" : ""}>
              <div
                className={
                  t.role === "user"
                    ? "inline-block max-w-[90%] rounded-xl bg-cyan-500/15 px-3 py-2 text-left text-[12px] text-cyan-50"
                    : "inline-block max-w-[95%] whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-[12px] leading-relaxed text-white/85"
                }
              >
                {t.text}
              </div>
              {t.role === "advisor" && t.mentioned && t.mentioned.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {t.mentioned.map((tpl) => (
                    <button
                      key={tpl.publicId}
                      type="button"
                      onClick={() => onRequestTrial(tpl)}
                      className="rounded-full border border-emerald-300/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                    >
                      用「{tpl.nameZh}」试写 →
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
        {askMutation.isPending ? (
          <div className="text-[11px] text-white/40">顾问翻库中…</div>
        ) : null}
        {pendingPaid ? (
          <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-100">
            <div>{pendingPaid.priceHintZh}</div>
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => void send(pendingPaid.question, true)}
                className="rounded border border-amber-300/50 px-2 py-1 font-semibold hover:bg-amber-500/20"
              >
                确认扣点继续
              </button>
              <button
                type="button"
                onClick={() => setPendingPaid(null)}
                className="rounded border border-white/20 px-2 py-1 text-white/60 hover:text-white"
              >
                算了
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="border-t border-white/10 p-3">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft, false);
              }
            }}
            rows={2}
            placeholder="问剧情、问模板、问拍法…（Enter 发送）"
            className="min-w-0 flex-1 resize-none rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-cyan-300/50"
          />
          <button
            type="button"
            disabled={askMutation.isPending}
            onClick={() => void send(draft, false)}
            className="shrink-0 self-end rounded-lg bg-cyan-500/80 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-cyan-400 disabled:opacity-40"
          >
            {askMutation.isPending ? "…" : "发送"}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-white/30">
          顾问只做建议，不改你的任何内容；生成类付费动作仍需你在对应工序里亲自确认。
        </p>
      </footer>
    </aside>
  );
}

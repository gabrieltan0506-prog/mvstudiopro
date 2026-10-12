import { useEffect, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import type { CodeMotionBrief, CodeMotionProject } from "@shared/codeMotion";
import { codeMotionRevisionProposalSchema } from "@shared/codeMotionRevision";
type Proposal = z.infer<typeof codeMotionRevisionProposalSchema>;
type Request = {
  requestId: string;
  brief: CodeMotionBrief;
  confirmPaid: boolean;
  confirmedCredits?: number;
  proposal?: Proposal;
  failed?: boolean;
};
export default function CodeMotionRevisionAssistant({
  project,
  generation,
  disabled,
  onProposal,
}: {
  project: CodeMotionProject;
  generation: string;
  disabled: boolean;
  onProposal(value: Proposal): void;
}) {
  const { user } = useAuth(),
    [instruction, setInstruction] = useState(""),
    [pending, setPending] = useState<Request | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation(),
    quote = trpc.codeMotion.quote.useQuery(undefined, {
      enabled: !!user,
      retry: false,
    });
  const key = user ? `ink-revision-advisor:${user.id}:${project.id}` : null;
  useEffect(() => {
    setPending(null);
    setMessage("");
    setInstruction("");
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw) as Request;
        if (
          value.brief?.revisionSource?.projectId !== project.id ||
          !value.requestId
        )
          throw Error();
        setPending(value);
        setInstruction(value.brief.revisionSource.instruction);
        if (
          value.proposal &&
          value.brief.revisionSource.generation === generation
        )
          onProposal(codeMotionRevisionProposalSchema.parse(value.proposal));
        else if (value.brief.revisionSource.generation !== generation)
          setMessage(
            "原修改提案对应较早版本，请恢复原工程核对；不会重新计费整理。"
          );
      }
    } catch {
      setMessage("原修改提案恢复记录不可读，请先保留工程并核对。");
    }
  }, [key]);
  const run = async () => {
    if (!key || busy || !quote.data) return;
    const request = pending || {
      requestId: crypto.randomUUID(),
      brief: {
        ...project.brief,
        revisionSource: {
          projectId: project.id,
          generation,
          instruction: instruction.trim(),
        },
      },
      confirmPaid: quote.data.credits > 0,
      ...(quote.data.credits ? { confirmedCredits: quote.data.credits } : {}),
    };
    setBusy(true);
    setMessage("");
    try {
      // Persist before the paid advisor call. A lost response is recovered with the same identity.
      localStorage.setItem(key, JSON.stringify(request));
      setPending(request);
      if (request.brief.revisionSource?.generation !== generation)
        throw Error(
          "原修改提案对应较早版本，请恢复原工程核对；不会重新计费整理"
        );
      if (request.proposal) {
        onProposal(request.proposal);
        return;
      }
      const response = await ask.mutateAsync({
        question: request.brief.revisionSource!.instruction,
        rawQuestion: request.brief.revisionSource!.instruction,
        codeMotionContext: request.brief,
        qaModel: "gpt-5.6-terra",
        requestId: request.requestId,
        confirmPaid: request.confirmPaid,
        confirmedCredits: request.confirmedCredits,
      });
      const proposal = codeMotionRevisionProposalSchema.parse(
        JSON.parse(response.answer)
      );
      const saved = { ...request, proposal };
      localStorage.setItem(key, JSON.stringify(saved));
      setPending(saved);
      onProposal(proposal);
      setMessage(
        `${proposal.summary}${proposal.limitations.length ? `；未修改：${proposal.limitations.join("；")}` : ""}。${response.creditsCharged ? `整理使用${response.creditsCharged}积分。` : "本次整理未扣积分。"}`
      );
      void quote.refetch();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (/ADVISOR_OPERATION_FAILED(?!.*REFUND)/.test(detail)) {
        const failed = { ...request, failed: true };
        localStorage.setItem(key, JSON.stringify(failed));
        setPending(failed);
      }
      setMessage(
        error instanceof Error ? error.message : "提案尚未确认，请恢复原请求"
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        想怎么改？
        <textarea
          aria-label="自然语言修改要求"
          className="mt-2 block min-h-24 w-full rounded border p-2"
          disabled={disabled || busy || !!pending}
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          maxLength={1200}
          placeholder="例如：开场换成暖色，标题从左边滑进来；最后一句改成‘现在就来试试’。"
        />
      </label>
      <p className="text-xs text-stone-500">
        按描述选择镜头并优先修改代码画面。自然动作使用已有原片；换图、改声音和改变镜头时长暂不在此修改。
      </p>
      <button
        className="rounded border px-3 py-2 text-sm disabled:opacity-50"
        disabled={
          disabled ||
          busy ||
          !!pending?.failed ||
          !user ||
          !generation ||
          generation === "0" ||
          instruction.trim().length < 2 ||
          !quote.data
        }
        onClick={() => void run()}
      >
        {busy
          ? "正在整理修改…"
          : pending
            ? "恢复原修改提案"
            : `整理修改${quote.data?.credits ? `（${quote.data.credits}积分）` : "（免费）"}`}
      </button>
      {(pending?.proposal || pending?.failed) && (
        <button
          className="ml-2 text-xs underline"
          disabled={disabled || busy}
          onClick={() => {
            if (key) localStorage.removeItem(key);
            setPending(null);
            onProposal({ summary: "", changes: [], limitations: [] });
            setMessage("");
          }}
        >
          另写修改要求
        </button>
      )}
      <p className="text-xs">
        整理沿用现有顾问额度；下方确认采用才计算本部成片的修改次数或原片工具费用。
      </p>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

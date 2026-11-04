import { importWorkflowVideoSource } from "@/lib/videoUpscaleApi";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { manhuaVfxMediaIdentity } from "@/lib/manhuaVfxWorkflow";
import {
  parseMontagePlan,
  remapMontageSubtitles,
  type MontagePlan,
} from "@shared/montagePlan";
import type { ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";

type Props = {
  clips: Array<{ id: string; url: string; label: string }>;
  context?: ManhuaCreativeAdvisorContext;
  story: string;
  storage: Storage;
  storageKey: string;
  busy: boolean;
  beforeSubmit?: () => Promise<void>;
  onSourceChange?: (id: string) => void;
  onSubmit: (
    params: {
      clips: string[];
      trims: Array<{ startSec: number; endSec: number }>;
      width: number;
      height: number;
      fps: number;
      subtitleSrt?: string;
    },
    title: string
  ) => Promise<unknown>;
};
type Saved = {
  sourceId: string;
  sourceIdentity: string;
  analysisSourceUri?: string;
  target: number;
  aspect: "9:16" | "16:9";
  answer: string;
  pending?: Parameters<
    ReturnType<
      typeof trpc.mvAnalysis.askPlatformSkillQa.useMutation
    >["mutateAsync"]
  >[0];
};

/** 原片→完整音画顾问→可审方案→既有后期队列；保存到所属项目的原存储适配器。 */
export function MontagePlanner(props: Props) {
  const [initial] = useState(() => {
    try {
      const value = JSON.parse(
        props.storage.getItem(props.storageKey) || "null"
      ) as Saved | null;
      if (
        value !== null &&
        (typeof value !== "object" ||
          Array.isArray(value) ||
          typeof value.sourceId !== "string" ||
          typeof value.sourceIdentity !== "string" ||
          typeof value.answer !== "string" ||
          !Number.isInteger(value.target) ||
          value.target < 5 ||
          value.target > 300 ||
          !["9:16", "16:9"].includes(value.aspect) ||
          (value.pending &&
            (typeof value.pending.requestId !== "string" ||
              !value.pending.manhuaContext?.subtitleReview)))
      )
        throw new Error("草稿格式错误");
      return { value, error: "" };
    } catch {
      return {
        value: null,
        error: "剪辑方案草稿无法读取，原记录保留，请先恢复项目",
      };
    }
  });
  const [saved, setSaved] = useState<Saved>(
    initial.value || {
      sourceId: "",
      sourceIdentity: "",
      target: 30,
      aspect: "9:16",
      answer: "",
    }
  );
  const [error, setError] = useState(initial.error);
  const [working, setWorking] = useState(false),
    [paid, setPaid] = useState(false);
  const gate = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const live = useRef(saved);
  live.current = saved;
  const advisor = trpc.mvAnalysis.askPlatformSkillQa.useMutation({
    retry: false,
  });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(
    props.context?.projectId
      ? { projectId: props.context.projectId }
      : undefined,
    { enabled: Boolean(props.context), retry: false }
  );
  const source = props.clips.find(c => c.id === saved.sourceId);
  const stale = Boolean(
    source && saved.sourceIdentity !== manhuaVfxMediaIdentity(source.url)
  );
  const locked = props.busy || working || Boolean(initial.error);
  const save = (value: Saved) => {
    if (!mounted.current) throw new Error("原工作区已关闭，原请求保留供恢复");
    props.storage.setItem(props.storageKey, JSON.stringify(value));
    live.current = value;
    setSaved(value);
  };
  function update(value: Partial<Saved>) {
    try {
      save({ ...live.current, ...value });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  let plan: MontagePlan | undefined,
    parseError = "";
  if (saved.answer)
    try {
      plan = parseMontagePlan(saved.answer);
    } catch {
      parseError =
        "方案格式或时间码未通过校验，请核对报告后修正，不能提交剪辑。";
    }
  async function ask(confirmPaid = false) {
    if (
      !props.context ||
      !source ||
      gate.current ||
      locked ||
      stale ||
      !Number.isInteger(saved.target) ||
      saved.target < 5 ||
      saved.target > 300
    )
      return;
    gate.current = true;
    setWorking(true);
    setError("");
    try {
      const videoUri =
        saved.pending?.manhuaContext?.subtitleReview?.videoUri ??
        (source.url.startsWith("https://d2h7xmz5gqybh9.cloudfront.net/")
          ? await importWorkflowVideoSource(source.url)
          : source.url);
      if (!mounted.current) return;
      const request = saved.pending ?? {
        requestId: crypto.randomUUID(),
        question: "完整观看原片，提出情绪、揭示时机与音乐变化驱动的剪辑方案",
        rawQuestion: "成片剪辑方案",
        manhuaContext: {
          ...props.context,
          bgmMix: undefined,
          filmReview: undefined,
          previsEdit: undefined,
          worldTarget: undefined,
          studio3d: undefined,
          subtitleReview: {
            videoUri,
            dialogue:
              props.story || "无已确认对白；仅据真实音画分析，不生成字幕。",
            montageTargetSec: saved.target,
          },
        },
      };
      save({ ...saved, pending: request });
      await props.beforeSubmit?.();
      if (!mounted.current) return;
      const result = await advisor.mutateAsync({
        ...request,
        ...(confirmPaid
          ? { confirmPaid: true, confirmedCredits: quota.data?.price }
          : {}),
      });
      if (!mounted.current) return;
      parseMontagePlan(result.answer);
      save({
        ...live.current,
        answer: result.answer,
        analysisSourceUri: videoUri,
        pending: undefined,
      });
      setPaid(false);
      await props.beforeSubmit?.();
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(maskMediaProviderDetails(message));
      // 已明确拒绝的输入可修改；网络/超时结果不明时保留原编号恢复，不能自动重投。
      const code = (e as { data?: { code?: string } })?.data?.code;
      if (
        !message.includes("REFUND_PENDING") &&
        (message.includes("ADVISOR_OPERATION_FAILED") ||
          ["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(
            code || ""
          ))
      )
        save({ ...live.current, pending: undefined });
      if (/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message))
        setPaid(true);
    } finally {
      gate.current = false;
      setWorking(false);
    }
  }
  async function render(index: number) {
    if (gate.current || locked || !plan || !source || stale) return;
    gate.current = true;
    setWorking(true);
    setError("");
    try {
      const selected = plan.plans[index];
      const subtitleSrt = remapMontageSubtitles(plan.sourceSrt, selected.cuts);
      const [width, height] =
        saved.aspect === "9:16" ? [720, 1280] : [1280, 720];
      await props.onSubmit(
        {
          clips: selected.cuts.map(() => saved.analysisSourceUri || source.url),
          trims: selected.cuts.map(c => ({
            startSec: c.startSec,
            endSec: c.endSec,
          })),
          width,
          height,
          fps: 30,
          ...(subtitleSrt ? { subtitleSrt } : {}),
        },
        selected.title
      );
    } catch (e) {
      setError(
        maskMediaProviderDetails(e instanceof Error ? e.message : String(e))
      );
    } finally {
      gate.current = false;
      setWorking(false);
    }
  }
  return (
    <section
      className="my-3 space-y-3 rounded-xl border border-cyan-300/20 p-3"
      aria-label="剪辑方案工坊"
    >
      <h3 className="text-sm font-semibold">预告与短片 · 剪辑方案</h3>
      <p className="text-xs text-white/60">
        完整音画顾问根据原片提出候选；先审时间码和理由，再生成。保留原声与必要停顿，不自动避让音乐。竖横画幅等比补边。
      </p>
      <label className="block text-xs">
        原片
        <select
          aria-label="剪辑方案原片"
          disabled={locked || Boolean(saved.pending)}
          value={saved.sourceId}
          onChange={e => {
            const c = props.clips.find(c => c.id === e.target.value);
            update({
              sourceId: e.target.value,
              sourceIdentity: c ? manhuaVfxMediaIdentity(c.url) : "",
              answer: "",
              analysisSourceUri: undefined,
            });
            props.onSourceChange?.(e.target.value);
          }}
          className="ml-2 max-w-full rounded bg-slate-900 p-2"
        >
          <option value="">选择本项目成片</option>
          {props.clips.map(c => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        目标秒数{" "}
        <input
          aria-label="剪辑目标秒数"
          type="number"
          min={5}
          max={300}
          disabled={locked || Boolean(saved.pending)}
          value={saved.target}
          onChange={e => update({ target: Number(e.target.value), answer: "" })}
          className="w-16 rounded bg-slate-900 p-1"
        />
      </label>
      <select
        aria-label="短片画幅"
        disabled={locked}
        value={saved.aspect}
        onChange={e => update({ aspect: e.target.value as Saved["aspect"] })}
        className="ml-2 rounded bg-slate-900 p-1"
      >
        <option value="9:16">竖屏9:16</option>
        <option value="16:9">横屏16:9</option>
      </select>
      {stale && <p role="alert">原片版本已变化，请重新选择素材并分析。</p>}
      <div>
        <button
          type="button"
          disabled={
            locked ||
            !source ||
            !props.context ||
            stale ||
            !Number.isInteger(saved.target) ||
            saved.target < 5 ||
            saved.target > 300
          }
          onClick={() => void ask()}
          className="rounded border px-3 py-2 text-xs disabled:opacity-40"
        >
          {working
            ? "处理中…"
            : saved.pending
              ? "恢复原咨询"
              : "分析原片并提出方案"}
        </button>
        <span className="ml-2 text-xs text-white/60">
          沿用创作顾问配额；付费时另确认。剪辑不调用生成模型，使用现有转码资源。
        </span>
      </div>
      {paid && (
        <button
          type="button"
          disabled={locked || !quota.data}
          onClick={() => void ask(true)}
          className="text-xs underline"
        >
          确认按顾问报价 {quota.data?.price} 积分咨询
        </button>
      )}
      <details>
        <summary className="cursor-pointer text-xs">
          导入或修正已核对的方案
        </summary>
        <p className="text-xs text-white/60">
          仅导入与所选原片对应的完整方案JSON；不是自动读片结果。
        </p>
        <textarea
          aria-label="剪辑方案JSON"
          disabled={locked || Boolean(saved.pending) || !source}
          value={saved.answer}
          onChange={e => update({ answer: e.target.value })}
          className="mt-2 h-32 w-full rounded bg-slate-900 p-2 text-xs"
        />
      </details>
      {(error || parseError) && (
        <p role="alert" className="text-xs text-red-300">
          {error || parseError}
        </p>
      )}
      {plan && (
        <>
          <p className="whitespace-pre-wrap text-xs">{plan.summary}</p>
          {plan.uncertainties.length > 0 && (
            <p className="text-xs text-amber-200">
              需人工核对：{plan.uncertainties.join("；")}
            </p>
          )}
          {plan.plans.map((p, i) => (
            <article
              key={i}
              className="space-y-2 rounded border border-white/15 p-2"
            >
              <strong className="text-sm">
                {p.title} ·{" "}
                {p.cuts
                  .reduce((n, c) => n + c.endSec - c.startSec, 0)
                  .toFixed(1)}
                秒
              </strong>
              <p className="text-xs">{p.rationale}</p>
              <ol className="space-y-1 text-xs">
                {p.cuts.map((c, j) => (
                  <li key={j}>
                    {c.startSec.toFixed(2)}–{c.endSec.toFixed(2)}秒：{c.reason}
                    <br />
                    依据：{c.evidence}
                  </li>
                ))}
              </ol>
              <p className="text-xs text-white/60">
                输出{saved.aspect}，保留原声；
                {plan.sourceSrt
                  ? "对白字幕按完整句同步重排"
                  : "没有可用对白字幕，不添加字幕"}
                。原片保留，结果回到本项目后期任务。
              </p>
              <button
                type="button"
                disabled={locked || stale || !source || Boolean(saved.pending)}
                onClick={() => void render(i)}
                className="rounded border px-3 py-2 text-xs disabled:opacity-40"
              >
                采用并生成此版
              </button>
            </article>
          ))}
          <details>
            <summary className="text-xs">参考结构与差异化创作方向</summary>
            {plan.creativeDirections.map((d, i) => (
              <article key={i} className="my-2 text-xs">
                <strong>{d.title}</strong>
                <p>参考依据：{d.evidence}</p>
                <p>新的表达：{d.difference}</p>
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  );
}

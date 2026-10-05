import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { manhuaProjectStorage as storage } from "@shared/manhuaProjectScope";
import {
  templateFeatureChoices,
  optimizationInputSchema,
  optimizationResultSchema,
  type EpisodeOptimizationInput,
  type EpisodeOptimizationResult,
} from "@shared/manhuaEpisodeOptimization";
import {
  validateAdvisorRewriteBody,
  splitManhuaEpisodeStoryText,
  type AdvisorRewriteCandidate,
} from "@shared/manhuaAdvisorRewrite";
import type { ManhuaWriterEpisode } from "@shared/manhuaWriterRoom";
import type { ManhuaWriterModel } from "@shared/manhuaWriterModels";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import type { AdvisorTemplatePlan } from "@/lib/manhuaAdvisorTemplates";
import { ManhuaRewriteComparison } from "./ManhuaRewriteComparison";
export type EpisodeOptimizationWorkspace = {
  episodes: ManhuaWriterEpisode[];
  model: ManhuaWriterModel;
  comparisonHost: HTMLElement | null;
  onFocusEpisode: (index: number) => void;
  onApplyCandidates: (candidates: AdvisorRewriteCandidate[]) => boolean;
};
type Saved = {
  selected: number[];
  features: Record<string, string[]>;
  results: EpisodeOptimizationResult[];
  pending: EpisodeOptimizationInput | null;
};
export default function ManhuaEpisodeOptimization(
  props: EpisodeOptimizationWorkspace & {
    userId?: string;
    projectId?: string;
    focusEpisode: number;
    templates: PublicManhuaViralTemplateCard[];
    plans: AdvisorTemplatePlan[];
    asking: boolean;
    onRecommend: (episodes: ManhuaWriterEpisode[]) => void;
  }
) {
  const key =
    props.userId && props.projectId
      ? `mvs:episode-optimization:${props.userId}:${props.projectId}`
      : null;
  const [initial] = useState(() => {
    try {
      const raw = key && storage.getItem(key),
        v = raw ? JSON.parse(raw) : {};
      return {
        selected: Array.isArray(v.selected) ? v.selected : [props.focusEpisode],
        features:
          v.features && typeof v.features === "object" ? v.features : {},
        results: Array.isArray(v.results)
          ? v.results.map((x: unknown) => optimizationResultSchema.parse(x))
          : [],
        pending: v.pending ? optimizationInputSchema.parse(v.pending) : null,
        error: "",
      };
    } catch {
      return {
        selected: [props.focusEpisode],
        features: {},
        results: [],
        pending: null,
        error: "本机优化记录无法读取，请先导出作品备份。",
      };
    }
  });
  const [selected, setSelected] = useState<number[]>(initial.selected),
    [features, setFeatures] = useState<Record<string, string[]>>(
      initial.features
    ),
    [results, setResults] = useState<EpisodeOptimizationResult[]>(
      initial.results
    ),
    [pending, setPending] = useState<EpisodeOptimizationInput | null>(
      initial.pending
    );
  const [storageError, setStorageError] = useState(initial.error),
    [error, setError] = useState(""),
    [active, setActive] = useState(""),
    [edit, setEdit] = useState<AdvisorRewriteCandidate | null>(null);
  const mutation = trpc.mvAnalysis.optimizeManhuaEpisodes.useMutation();
  const quota = trpc.mvAnalysis.manhuaEpisodeOptimizationQuota.useQuery(
    undefined,
    { enabled: Boolean(props.userId), refetchOnWindowFocus: true }
  );
  const history = trpc.mvAnalysis.manhuaEpisodeOptimizationHistory.useQuery(
    { projectId: props.projectId || "" },
    {
      enabled: Boolean(props.userId && props.projectId),
      refetchInterval: pending ? 4000 : false,
    }
  );
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pendingRow = history.data?.find(r => r.requestId === pending?.requestId);
  const chosen = props.episodes.filter(ep => selected.includes(ep.index));
  const disabled =
    props.asking ||
    mutation.isPending ||
    Boolean(pending) ||
    Boolean(storageError);
  const cards = props.plans
    .map(plan => ({
      plan,
      card: props.templates.find(c => c.publicId === plan.publicId),
    }))
    .filter(
      (
        x
      ): x is {
        plan: AdvisorTemplatePlan;
        card: PublicManhuaViralTemplateCard;
      } => Boolean(x.card)
    );
  const latest = useRef<Saved>({ selected, features, results, pending });
  latest.current = { selected, features, results, pending };
  const saved = (next: Partial<Saved>) => ({ ...latest.current, ...next });
  function persist(next: Partial<Saved>) {
    if (!key) {
      setStorageError("请先保存这部作品，才能保存试写与优化结果。");
      return false;
    }
    try {
      const value = saved(next);
      storage.setItem(key, JSON.stringify(value));
      latest.current = value;
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "优化记录保存失败，请保持页面并导出备份；本次不再提交新生成。"
      );
      return false;
    }
  }
  function remember(result: EpisodeOptimizationResult) {
    const next = [
      ...latest.current.results.filter(r => r.requestId !== result.requestId),
      result,
    ];
    if (!persist({ results: next, pending: null })) return;
    setResults(next);
    setPending(null);
    setError("");
    const first = result.candidates[0];
    if (first) {
      setActive(`${result.requestId}:${first.episodeIndex}`);
      setEdit({ ...first, rewrittenBody: splitManhuaEpisodeStoryText(first.rewrittenBody).story });
      props.onFocusEpisode(first.episodeIndex);
    }
  }
  useEffect(() => {
    const incoming = (history.data || []).flatMap(r =>
      r.result && !results.some(x => x.requestId === r.result!.requestId)
        ? [r.result]
        : []
    );
    if (incoming.length) {
      const next = [...results, ...incoming];
      if (persist({ results: next })) setResults(next);
    }
  }, [history.data]);
  useEffect(() => {
    if (!pending) return;
    const row = pendingRow;
    if (row?.result) remember(row.result);
    else if (row?.status === "failed") {
      setError(row.error || "本次未完成，原稿保留");
    }
  }, [history.data]);
  async function execute(input: EpisodeOptimizationInput) {
    if (inFlight.current) return;
    const validation = optimizationInputSchema.safeParse(input);
    if (!validation.success) {
      setError(validation.error.issues.map(i => i.message).join("；"));
      return;
    }
    if (!persist({ pending: input })) return;
    setPending(input);
    setError("");
    inFlight.current = true;
    try {
      const result = await mutation.mutateAsync(input);
      if (mounted.current) remember(result);
    } catch (e) {
      if (mounted.current) {
        setError(
          e instanceof Error ? e.message : "优化未收到完整回执，请取回原请求"
        );
        const code = (e as { data?: { code?: string } })?.data?.code;
        if (
          [
            "BAD_REQUEST",
            "PRECONDITION_FAILED",
            "UNAUTHORIZED",
            "FORBIDDEN",
          ].includes(code || "") &&
          persist({ pending: null })
        )
          setPending(null);
        void history.refetch();
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) void quota.refetch();
    }
  }
  function startTrial(card: PublicManhuaViralTemplateCard) {
    const episode =
      chosen.find(ep => ep.index === props.focusEpisode) || chosen[0];
    if (!episode || !props.projectId) return;
    const cached = results.find(
      r =>
        r.mode === "trial" &&
        r.model === props.model &&
        r.templates[0]?.publicId === card.publicId &&
        r.candidates[0]?.originalBody === episode.body &&
        r.candidates[0]?.episodeIndex === episode.index &&
        (r.candidates[0]?.originalEndHook || "") === (episode.endHook || "")
    );
    if (cached) {
      openCandidate(cached, cached.candidates[0]);
      return;
    }
    if ((quota.data?.trialsLeftToday ?? 0) < 1) {
      toast.message("今日三次免费试写已用完，请勾选特色后正式优化");
      return;
    }
    void execute({
      requestId: crypto.randomUUID(),
      projectId: props.projectId,
      mode: "trial",
      model: props.model,
      episodes: [
        {
          index: episode.index,
          title: episode.title,
          body: episode.body,
          endHook: episode.endHook || "",
        },
      ],
      templates: [{ publicId: card.publicId, features: [] }],
      confirmedCredits: 0,
    });
  }
  function toggleFeature(id: string, feature: string) {
    const current = features[id] || [],
      next = {
        ...features,
        [id]: current.includes(feature)
          ? current.filter(f => f !== feature)
          : [...current, feature],
      };
    if (persist({ features: next })) setFeatures(next);
  }
  function startCombined() {
    if (!props.projectId || !chosen.length) return;
    const selections = Object.entries(features)
      .filter(([, v]) => v.length)
      .map(([publicId, features]) => ({ publicId, features }));
    if (!selections.length) {
      toast.error("请先勾选至少一种模板特色");
      return;
    }
    const cost = chosen.length * 6;
    if (
      !window.confirm(
        `组合所选模板特色，优化第 ${chosen.map(e => e.index).join("、")} 集，每集6积分，共${cost}积分。先生成对比稿，点击套用后才替换原稿。是否继续？`
      )
    )
      return;
    void execute({
      requestId: crypto.randomUUID(),
      projectId: props.projectId,
      mode: "optimize",
      model: props.model,
      episodes: chosen.map(e => ({
        index: e.index,
        title: e.title,
        body: e.body,
        endHook: e.endHook || "",
      })),
      templates: selections,
      confirmedCredits: cost,
    });
  }
  const activeResult = results.find(r =>
    r.candidates.some(c => `${r.requestId}:${c.episodeIndex}` === active)
  );

  function openCandidate(
    result: EpisodeOptimizationResult,
    candidate: AdvisorRewriteCandidate
  ) {
    const id = `${result.requestId}:${candidate.episodeIndex}`;
    let restored = candidate;
    try {
      const raw = key && storage.getItem(`${key}:edit`),
        v = raw ? JSON.parse(raw) : null;
      if (
        v?.active === id &&
        v.candidate?.originalBody === candidate.originalBody &&
        v.candidate?.originalEndHook === candidate.originalEndHook &&
        typeof v.candidate?.rewrittenBody === "string" &&
        (v.candidate.endHook === undefined ||
          typeof v.candidate.endHook === "string")
      )
        restored = {
          ...candidate,
          rewrittenBody: v.candidate.rewrittenBody,
          ...(v.candidate.endHook !== undefined
            ? { endHook: v.candidate.endHook }
            : {}),
        };
    } catch {
      setError("编辑草稿无法恢复，已保留最近完整版本");
    }
    setActive(id);
    setEdit({ ...restored, rewrittenBody: splitManhuaEpisodeStoryText(restored.rewrittenBody).story });
    props.onFocusEpisode(candidate.episodeIndex);
  }
  function saveEdit(candidate: AdvisorRewriteCandidate) {
    if (!activeResult) return;
    const next = results.map(r =>
      r.requestId === activeResult.requestId
        ? {
            ...r,
            candidates: r.candidates.map(c =>
              c.episodeIndex === candidate.episodeIndex ? candidate : c
            ),
          }
        : r
    );
    // 允许编辑中暂空，存于独立草稿，已验证候选不被毁掉。
    setEdit(candidate);
    try {
      if (key)
        storage.setItem(`${key}:edit`, JSON.stringify({ active, candidate }));
    } catch {
      setStorageError("编辑草稿未保存，请保留页面");
    }
    if (
      candidate.rewrittenBody.trim().length > 0 &&
      (candidate.endHook === undefined || candidate.endHook.trim().length > 0)
    ) {
      setResults(next);
      persist({ results: next });
    }
  }
  function adopt(all: boolean) {
    if (!activeResult || activeResult.mode !== "optimize" || !edit) return;
    const candidates = all
      ? activeResult.candidates.map(c =>
          c.episodeIndex === edit.episodeIndex ? edit : c
        )
      : [edit];
    try {
      candidates.forEach(c =>
        validateAdvisorRewriteBody(c.originalBody, c.rewrittenBody, c.endHook)
      );
      if (props.onApplyCandidates(candidates))
        toast.success("优化稿已套用，旧稿已备份");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "优化稿尚未通过检查");
    }
  }
  const view = edit && activeResult && (
    <section
      aria-label="整集模板试写对比"
      className="my-4 space-y-3 rounded-xl border border-emerald-400/30 bg-black/10 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          第{edit.episodeIndex}集 ·{" "}
          {activeResult.mode === "trial" ? "模板试写" : "组合优化"} ·{" "}
          {activeResult.templates.map(t => t.nameZh).join(" + ")}
        </h3>
        <button type="button" onClick={() => setEdit(null)}>
          收起对比
        </button>
      </div>
      <ManhuaRewriteComparison
        before={edit.originalBody}
        after={edit.rewrittenBody}
        afterLabel="模板应用后"
      />
      <details>
        <summary>查看具体改动</summary>
        {edit.changes.map((x, i) => (
          <p key={i}>{x}</p>
        ))}
      </details>
      {activeResult.mode === "optimize" ? (
        <>
          <label className="block">
            优化后剧情与对白 · 可修改
            <textarea
              aria-label="组合优化整集正文"
              disabled={Boolean(pending)}
              className="mt-2 w-full rounded border border-white/20 bg-black/20 p-3"
              rows={12}
              value={edit.rewrittenBody}
              onChange={e =>
                saveEdit({ ...edit, rewrittenBody: e.target.value })
              }
            />
          </label>
          {edit.endHook !== undefined && (
            <label className="block">
              片尾钩子
              <textarea
                aria-label="组合优化片尾钩子"
                disabled={Boolean(pending)}
                className="mt-2 w-full rounded border border-white/20 bg-black/20 p-3"
                rows={3}
                value={edit.endHook}
                onChange={e => saveEdit({ ...edit, endHook: e.target.value })}
              />
            </label>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => adopt(false)}
            className="rounded bg-emerald-500/20 px-4 py-2 disabled:opacity-40"
          >
            套用本集
          </button>
          {activeResult.candidates.length > 1 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => adopt(true)}
              className="ml-2 rounded border px-4 py-2 disabled:opacity-40"
            >
              套用本批{activeResult.candidates.length}集
            </button>
          )}
          <p className="text-xs opacity-65">
            先备份再替换。原稿已变化时停止覆盖；其他集正文保持原样。
          </p>
        </>
      ) : (
        <p className="text-sm">
          看完后在顾问中勾选本模板要借用的特色，可与其他模板组合。正式优化每集6积分，先确认。
        </p>
      )}
    </section>
  );
  return (
    <>
      <section
        aria-label="选集与模板组合优化"
        className="space-y-3 rounded-lg border border-cyan-300/25 p-3 text-sm"
      >
        <h3 className="font-semibold">这次想优化哪几集？</h3>
        {!props.projectId && (
          <p role="status">
            请先在工作区保存这部作品，再进行模板试写与组合优化。
          </p>
        )}
        <p>
          作品共 {props.episodes.length} 集 · 已选 {chosen.length}{" "}
          集，单集也可以
        </p>
        <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
          {props.episodes.map(ep => (
            <label
              key={ep.index}
              className="rounded border border-white/20 p-2"
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(ep.index)}
                onChange={() => {
                  const next = selected.includes(ep.index)
                    ? selected.filter(i => i !== ep.index)
                    : [...selected, ep.index];
                  if (persist({ selected: next })) {
                    setSelected(next);
                    props.onFocusEpisode(ep.index);
                  }
                }}
              />{" "}
              第{ep.index}集 · {ep.title}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={
            disabled ||
            !chosen.length ||
            !props.userId ||
            props.templates.length < 3
          }
          onClick={() => props.onRecommend(chosen)}
          className="rounded bg-cyan-500/20 px-3 py-2 disabled:opacity-40"
        >
          为所选剧集推荐3—5个模板
        </button>
        <p className="text-xs opacity-70">
          推荐以所选列表中第一集为依据；组合优化逐集读取完整正文。
        </p>
        <p className="text-xs opacity-70">
          模板试写今日剩余 {quota.data?.trialsLeftToday ?? "…"} / 3
          次，GLM / DeepSeek共用；换模型重新试写也计一次。每次只试写一集。推荐沿用顾问额度，超额先确认。
        </p>
        {chosen.length > 1 && (
          <label className="block">
            试写哪一集
            <select
              aria-label="模板试写集数"
              value={
                chosen.some(e => e.index === props.focusEpisode)
                  ? props.focusEpisode
                  : chosen[0]?.index
              }
              onChange={e => props.onFocusEpisode(Number(e.target.value))}
              disabled={disabled}
              className="ml-2 rounded bg-black/20 p-2"
            >
              {chosen.map(ep => (
                <option key={ep.index} value={ep.index}>
                  第{ep.index}集
                </option>
              ))}
            </select>
          </label>
        )}
        {cards.map(({ plan, card }) => (
          <section
            key={card.publicId}
            className="space-y-2 rounded border border-white/15 p-3"
          >
            <h4 className="font-semibold">
              {card.methodBrief?.title || card.nameZh}
            </h4>
            <p>{plan.reason}</p>
            <p className="text-xs opacity-70">保留：{plan.preserve}</p>
            <ul className="text-xs">
              {plan.changes.map((x, i) => (
                <li key={i}>• {x}</li>
              ))}
            </ul>
            <button
              type="button"
              disabled={
                disabled || !chosen.length || !quota.data || !props.projectId
              }
              onClick={() => startTrial(card)}
              className="rounded border border-cyan-300/30 px-3 py-2 disabled:opacity-40"
            >
              试写一集 · 免费
            </button>
            <p className="font-medium">选择要注入的特色</p>
            {templateFeatureChoices(card).map(f => (
              <label key={f.id} className="flex items-start gap-2 leading-6">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={(features[card.publicId] || []).includes(f.id)}
                  onChange={() => toggleFeature(card.publicId, f.id)}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </section>
        ))}
        {Object.entries(features).some(([, v]) => v.length) && (
          <section aria-label="已选模板特色">
            <h4 className="font-semibold">本次组合</h4>
            {Object.entries(features)
              .filter(([, v]) => v.length)
              .map(([id, ids]) => {
                const card = props.templates.find(c => c.publicId === id);
                return (
                  <div key={id}>
                    <p>{card?.methodBrief?.title || card?.nameZh || id}</p>
                    {ids.map(feature => (
                      <label key={feature} className="flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked
                          disabled={disabled}
                          onChange={() => toggleFeature(id, feature)}
                        />
                        {card
                          ? templateFeatureChoices(card).find(
                              f => f.id === feature
                            )?.label || "该特色已更新，请移除后重新选择"
                          : "模板暂不可用，请移除"}
                      </label>
                    ))}
                  </div>
                );
              })}
          </section>
        )}
        <button
          type="button"
          disabled={disabled || !chosen.length || !props.projectId}
          onClick={startCombined}
          className="rounded bg-emerald-500/20 px-3 py-2 disabled:opacity-40"
        >
          按所选特色优化{chosen.length}集 · {chosen.length * 6}积分
        </button>
        {pending && (
          <div role="status">
            <p>
              {pendingRow?.status === "failed"
                ? "本次已停止"
                : "正在取回原请求"}
              ，已完成 {pendingRow?.completedEpisodes || 0} 集。原稿保留。
            </p>
            <button type="button" onClick={() => void history.refetch()}>
              取回原请求状态
            </button>
            {pendingRow?.status === "failed" && (
              <>
                <button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => void execute({ ...pending, resume: true })}
                >
                  仅继续未完成集
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (persist({ pending: null })) setPending(null);
                  }}
                >
                  结束本次，保留已完成稿
                </button>
              </>
            )}
            {pendingRow?.phase === "ready" && (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => void execute(pending)}
              >
                恢复已保存结果的结算
              </button>
            )}
          </div>
        )}
        {quota.isError && (
          <p role="alert">
            暂时无法读取试写额度，请稍后取回；不会提交免费试写。
          </p>
        )}
        {(error || storageError) && (
          <p role="alert" className="text-amber-200">
            {storageError || error}
          </p>
        )}
        {(history.data || [])
          .filter(row => row.status === "failed" && row.candidates.length)
          .map(row => (
            <button
              type="button"
              key={row.requestId}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob(
                    [
                      JSON.stringify(
                        {
                          projectId: props.projectId,
                          requestId: row.requestId,
                          candidates: row.candidates,
                        },
                        null,
                        2
                      ),
                    ],
                    { type: "application/json" }
                  )
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = `已完成优化稿-${row.requestId}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              下载中断前已完成的{row.candidates.length}集
            </button>
          ))}
        {!!results.length && (
          <details open>
            <summary>已保存的试写与优化</summary>
            {results.flatMap(r =>
              r.candidates.map(c => (
                <button
                  key={`${r.requestId}:${c.episodeIndex}`}
                  type="button"
                  className="my-1 block rounded border border-white/20 px-2 py-1 text-left"
                  onClick={() => openCandidate(r, c)}
                >
                  {r.mode === "trial" ? "试写" : "组合优化"} · 第
                  {c.episodeIndex}集 · {r.model === "glm" ? "GLM" : "DeepSeek"} ·{" "}
                  {r.templates.map(t => t.nameZh).join(" + ")}
                </button>
              ))
            )}
          </details>
        )}
      </section>
      {view &&
        (props.comparisonHost
          ? createPortal(view, props.comparisonHost)
          : view)}
    </>
  );
}

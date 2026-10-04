import {
  readNovelWorkspaceDb,
  saveNovelWorkspaceDb,
} from "@/lib/novelWorkspaceDb";
import {
  batchStart,
  batchEnd,
  batchNovel,
  continuationContext,
  nextNovelBatch,
  completeScriptBatches,
  novelTextHash,
} from "@/lib/novelSeries";
import { createNovelFactoryProject } from "@/lib/novelFactoryProject";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ManhuaNovelSourcePanel } from "@/components/canvas/ManhuaNovelSourcePanel";
import ManhuaTemplatePicker from "@/components/canvas/ManhuaTemplatePicker";
import { NovelTemplateComparison } from "@/components/canvas/NovelTemplateComparison";
import { prepareNovelExcerpt } from "@shared/manhuaNovelSource";
import {
  novelAdviceSchema,
  formatNovelOutline,
  novelModelLabel,
  NOVEL_MODEL_OPTIONS,
  novelChapterSchema,
  novelOutlineSchema,
  novelTestInputSchema,
  type NovelTestInput,
} from "@shared/novelWorkspace";
import {
  applyNovelChapterCompletion,
  downloadNovelText,
  emptyNovelWorkspace,
  novelSourceIdentity,
  readNovelWorkspace,
  type NovelWorkspace,
} from "@/lib/novelWorkspace";

export default function NovelAdaptation() {
  const { user, loading } = useAuth();
  if (loading) return <main className="p-8">正在读取账号…</main>;
  if (!user)
    return (
      <main className="p-8">
        请先
        <Link href="/login" className="underline">
          登录
        </Link>
        。
      </main>
    );
  if (user.role !== "admin" && user.role !== "supervisor")
    return (
      <main className="p-8">
        小说改编当前仅开放管理者测试。<Link href="/canvas">返回漫剧工厂</Link>
      </main>
    );
  return (
    <NovelAdaptationWorkspace key={String(user.id)} userId={String(user.id)} />
  );
}
export function NovelAdaptationWorkspace({ userId }: { userId: string }) {
  const [loaded, setLoaded] = useState<Awaited<
    ReturnType<typeof readNovelWorkspaceDb>
  > | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    readNovelWorkspaceDb(userId)
      .then(v => {
        if (active) setLoaded(v);
      })
      .catch(() => {
        if (active)
          setLoadError(
            "本机草稿读取失败，原稿保留，未开始写入。请重试或保留浏览器数据。"
          );
      });
    return () => {
      active = false;
    };
  }, [userId]);
  if (loadError)
    return (
      <main role="alert" className="p-8">
        {loadError}
      </main>
    );
  if (!loaded) return <main className="p-8">正在读取小说草稿…</main>;
  return (
    <NovelWorkspaceEditor userId={userId} initial={{ ...loaded, error: "" }} />
  );
}
function NovelWorkspaceEditor({
  userId,
  initial,
}: {
  userId: string;
  initial: Awaited<ReturnType<typeof readNovelWorkspaceDb>> & { error: string };
}) {
  const [draft, setDraft] = useState(initial.value),
    [saveError, setSaveError] = useState(initial.error),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState("");
  const [progress, setProgress] = useState("");
  const [backupOpen, setBackupOpen] = useState(false),
    [backupBusy, setBackupBusy] = useState(false),
    [backupMessage, setBackupMessage] = useState("");
  const backupMutation = trpc.novelWorkspace.backup.useMutation();
  const backupList = trpc.novelWorkspace.listBackups.useQuery(undefined, {
    enabled: backupOpen,
    retry: 1,
  });
  const queueSubmitting = useRef(false);
  const sourceFileInput = useRef<HTMLInputElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const latest = useRef(draft),
    raw = useRef(initial.raw),
    running = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const templates = trpc.manhuaViralTemplate.listApprovedPublic.useQuery(
    undefined,
    { retry: 1, staleTime: 60000 }
  );
  const cards = (templates.data?.groups || []).flatMap(g => g.items);
  const mutation = trpc.novelWorkspace.generate.useMutation();
  const [savedRaw, setSavedRaw] = useState<{
    requestId: string;
    text: string;
    sha256: string;
  } | null>(null);
  const recoveryMutation =
    trpc.novelWorkspace.recoverSavedChapter.useMutation();
  const activeRequestId = useRef<string | undefined>(undefined);
  const recoveringRequestId = useRef<string | undefined>(undefined);
  const utils = trpc.useUtils();
  const recoverable = trpc.novelWorkspace.recoverableChapters.useQuery(
    { roundId: draft.roundId },
    { retry: 1, staleTime: 30000 }
  );
  const failedChapter =
    draft.failedRequest ||
    recoverable.data?.find(
      input => !draft.chapters[input.chapterIndex - 1]?.trim()
    );
  const writes = useRef(Promise.resolve(true));
  const saving = useRef(0);
  const queueActive = useRef(false);
  const persist = (next: NovelWorkspace, archiveKey?: string) => {
    latest.current = next;
    setDraft(next);
    saving.current++;
    const operation = writes.current
      .then(async ok => {
        if (!ok) return false;
        try {
          raw.current = await saveNovelWorkspaceDb(
            userId,
            raw.current,
            next,
            archiveKey
          );
          setSaveError("");
          return true;
        } catch (e) {
          queueActive.current = false;
          setSaveError(
            e instanceof Error
              ? e.message
              : "本机保存失败，请下载完整备份再离开。"
          );
          return false;
        }
      })
      .finally(() => {
        saving.current--;
      });
    writes.current = operation;
    return operation;
  };
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (running.current || saving.current > 0 || saveError) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saveError]);
  const change = (patch: Partial<NovelWorkspace>) => {
    const next = { ...latest.current, ...patch };
    if (novelSourceIdentity(next) !== novelSourceIdentity(draft)) {
      next.outlineApproved = "";
      next.novelApproved = "";
    }
    persist(next);
  };
  const addTemplate = (id: string) => {
    if (draft.templates.some(t => t.publicId === id)) return;
    persist({
      ...draft,
      templates: [
        ...draft.templates,
        {
          publicId: id,
          role: "节奏、人物关系与对白",
          ...(!draft.templates.length
            ? { weight: 100 }
            : draft.templates.some(t => t.weight !== undefined)
              ? { weight: 0 }
              : {}),
        },
      ],
    });
  };
  const disabled =
    busy || !!saveError || !!draft.pending || queueActive.current;
  const weighted = draft.templates.some(t => t.weight !== undefined);
  const weightTotal = draft.templates.reduce(
    (sum, t) => sum + (t.weight || 0),
    0
  );
  const weightValid =
    !weighted ||
    (weightTotal === 100 && draft.templates.every(t => t.weight !== undefined));
  const currentNovel = batchNovel(draft);
  const adviceRuns = draft.runs.filter(
    r =>
      r.input.stage === "advice" &&
      r.input.roundId === draft.roundId &&
      r.input.topic === draft.topic &&
      r.input.direction === draft.direction &&
      (r.input.episodeStart || 1) === batchStart(draft) &&
      JSON.stringify(r.input.source) ===
        JSON.stringify(
          draft.mode === "source" && draft.source?.enabled
            ? (() => {
                try {
                  return prepareNovelExcerpt(draft.source);
                } catch {
                  return undefined;
                }
              })()
            : undefined
        )
  );
  useEffect(() => {
    if (conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [adviceRuns.length, draft.pending?.requestId]);
  const adviceRun =
    adviceRuns.find(r => r.input.requestId === draft.advisorAnchor) ||
    adviceRuns.at(-1);
  const discussionHistory = adviceRun
    ? [
        ...(adviceRun.input.advisorHistory || []),
        {
          user:
            adviceRun.input.advisorMessage ||
            "请依据创作方向提出建议与模板推荐。",
          assistant: adviceRun.result.text,
        },
      ]
    : [];
  const advice = adviceRun
    ? novelAdviceSchema.parse(JSON.parse(adviceRun.result.text))
    : null;
  const recommendationAdvice = [...discussionHistory]
    .reverse()
    .map(r => novelAdviceSchema.parse(JSON.parse(r.assistant)))
    .find(a => a.recommendations.length);
  const applyResult = (
    input: NovelTestInput,
    result: typeof mutation.data & {}
  ) => {
    const now = latest.current;
    if (
      now.roundId !== input.roundId ||
      now.pending?.requestId !== input.requestId ||
      now.runs.some(r => r.result.requestId === result.requestId)
    )
      return;
    const next = {
      ...now,
      pending: undefined,
      failedRequest:
        now.failedRequest?.requestId === input.requestId ||
        (input.stage === "chapter" &&
          now.failedRequest?.chapterIndex === input.chapterIndex)
          ? undefined
          : now.failedRequest,
      runs: [...now.runs, { input, result }],
    };
    if (input.stage === "outline") {
      const plan = novelOutlineSchema.parse(JSON.parse(result.text));
      next.outline = formatNovelOutline(plan);
      next.outlineApproved = "";
      next.storyVersions = [
        ...(now.storyVersions || []),
        {
          label: `生成提案前 · ${new Date().toLocaleString()}`,
          outline: now.outline,
          episodeCount: now.episodeCount,
          episodeStart: batchStart(now),
          advisorAnchor: now.advisorAnchor,
          chapters: [...now.chapters],
          templates: now.templates.map(t => ({ ...t })),
        },
      ];
      // Replanning never removes written episodes; explicit edits remain available.
      next.chapters = [...now.chapters];
      next.novelApproved = "";
    }
    if (input.stage === "chapter") {
      Object.assign(next, applyNovelChapterCompletion(now, input, result));
    }
    if (input.stage === "advice") {
      next.advisorAnchor = input.requestId;
      if (input.advisorMessage === now.advisorDraft?.trim())
        next.advisorDraft = "";
      next.outlineApproved = "";
      next.novelApproved = "";
    }
    if (
      now.generationQueue &&
      (input.stage === "chapter" || input.stage === "script")
    ) {
      const index =
        input.stage === "chapter"
          ? input.chapterIndex
          : input.episodeStart || 1;
      if (index === now.generationQueue.next) {
        const nextIndex =
          input.stage === "chapter"
            ? Array.from(
                { length: Math.max(0, now.generationQueue.end - index) },
                (_, i) => index + i + 1
              ).find(i => !next.chapters[i - 1]?.trim())
            : index + 1;
        next.generationQueue =
          nextIndex !== undefined && nextIndex <= now.generationQueue.end
            ? { ...now.generationQueue, next: nextIndex }
            : undefined;
      }
      if (
        !next.generationQueue ||
        (input.stage === "chapter" && next.chapterWarnings?.[String(index - 1)])
      )
        queueActive.current = false;
    }
    setError("");
    return persist(next);
  };
  // Poll only the original receipt. Never resubmit a generation on refresh or network failure.
  useEffect(() => {
    const pending = draft.pending;
    if (!pending || saveError) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (recoveringRequestId.current === pending.requestId) {
        timer = setTimeout(check, 500);
        return;
      }
      try {
        const receipt = await utils.novelWorkspace.receipt.fetch({
          requestId: pending.requestId,
        });
        if (stopped || latest.current.pending?.requestId !== pending.requestId)
          return;
        if (receipt.status === "succeeded" && receipt.result) {
          await applyResult(pending, receipt.result);
          if (activeRequestId.current === pending.requestId) {
            activeRequestId.current = undefined;
            running.current = false;
            setBusy(false);
          }
          setProgress("已完成，建议已保存。");
          return;
        }
        if (
          receipt.status === "failed" &&
          recoveringRequestId.current === pending.requestId
        ) {
          timer = setTimeout(check, 500);
          return;
        }
        if (receipt.status === "failed") {
          queueActive.current = false;
          persist({
            ...latest.current,
            pending: undefined,
            failedRequest: pending,
          });
          if (activeRequestId.current === pending.requestId) {
            activeRequestId.current = undefined;
            running.current = false;
            setBusy(false);
          }
          setError("本次请求失败，原稿与已收到的记录保留；没有自动重试。");
          setProgress("");
          return;
        }
        const labels: Record<string, string> = {
          preparing: "正在读取方向与模板",
          waiting: "模板已就绪，等待创作服务回复",
          receiving: "正在接收创作回复",
          validating: "回复已收到，正在检查内容格式",
        };
        setProgress(
          receipt.status === "not_found"
            ? "已发出请求，等待服务端确认；不会重复提交。"
            : (labels[receipt.phase || "preparing"] || "请求仍在处理") +
                (receipt.updatedAt
                  ? ` · 最近更新 ${new Date(receipt.updatedAt).toLocaleTimeString()}`
                  : "")
        );
      } catch {
        if (!stopped)
          setProgress("暂时无法读取进度，原请求保留；正在重新查询状态。");
      }
      if (!stopped) timer = setTimeout(check, 3000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // A receipt follows one immutable request; refs protect against stale results.
  }, [draft.pending?.requestId, saveError]);
  const generate = async (
    stage: NovelTestInput["stage"],
    single?: string,
    chapterIndex = 1,
    advisorMessage?: string,
    advisorIntent?: NovelTestInput["advisorIntent"],
    fromQueue = false
  ) => {
    if (
      (disabled && !fromQueue) ||
      running.current ||
      latest.current.pending ||
      saveError
    )
      return;
    const draft = latest.current;
    const currentNovel = batchNovel(draft);
    setError("");
    let submittedId: string | undefined;
    try {
      if (stage === "advice" && adviceRuns.length >= 20)
        throw new Error(
          "本轮已完成20次顾问讨论，请整理并确认提案后继续；历史对话完整保留。"
        );
      if (
        fromQueue &&
        draft.generationQueue?.configuration &&
        draft.generationQueue.configuration !== queueConfiguration(draft)
      )
        throw new Error(
          "本批的方向、模板或大纲已改变；请结束原批次并重新确认生成范围，已有稿保留。"
        );
      if (
        fromQueue &&
        stage === "script" &&
        (await novelTextHash(batchNovel(draft))) !==
          draft.generationQueue?.scriptBatch?.baseline
      )
        throw new Error(
          "本批小说已修改，请结束原剧本批次，重新审阅后再生成。已有候选保留。"
        );
      if (!draft.topic.trim())
        throw new Error("请先填写作品名称，就在创作方向上方。");
      if (!draft.direction.trim())
        throw new Error("请先填写创作方向，让顾问了解主角与故事目标。");
      const source =
        draft.mode === "source" && draft.source
          ? prepareNovelExcerpt(draft.source)
          : undefined;
      if (draft.mode === "source" && !source)
        throw new Error("请导入底本并勾选用于本次改编，或切换为原创新方向。");
      if (stage === "outline" && !advice)
        throw new Error("请先让创作顾问提出建议。");
      if (stage === "chapter" && draft.outlineApproved !== draft.outline)
        throw new Error("请先确认当前大纲。");
      if (
        stage === "chapter" &&
        chapterIndex > 1 &&
        !draft.chapters[chapterIndex - 2]?.trim()
      )
        throw new Error("请先完成前一集。");
      if (
        stage === "script" &&
        (!draft.novelApproved || draft.novelApproved !== currentNovel)
      )
        throw new Error("请先确认当前小说。");
      const choices = single
        ? draft.templates
            .filter(t => t.publicId === single)
            .map(t => ({ ...t, weight: 100 }))
        : draft.templates;
      if (!single && !weightValid)
        throw new Error(
          `模板创作配比当前合计${weightTotal}%，请调整为100%再提交。`
        );
      if (choices.some(t => !cards.some(c => c.publicId === t.publicId)))
        throw new Error("所选模板已不可用，请重新选择。");
      const input = novelTestInputSchema.parse({
        requestId: crypto.randomUUID(),
        roundId: draft.roundId,
        stage,
        topic: draft.topic,
        direction: draft.direction,
        ...(draft.modelPreference
          ? { modelPreference: draft.modelPreference }
          : {}),
        source,
        ...(advisorMessage ? { advisorMessage } : {}),
        ...(advisorIntent ? { advisorIntent } : {}),
        ...(((stage === "advice" &&
          (advisorMessage || advisorIntent === "story_variants")) ||
          stage === "outline") &&
        adviceRuns.length
          ? {
              advisorHistory: discussionHistory,
            }
          : {}),
        templates: choices,
        episodeCount: stage === "script" ? 1 : draft.episodeCount,
        episodeStart: stage === "script" ? chapterIndex : batchStart(draft),
        targetEpisodeCount: Math.max(
          draft.targetEpisodeCount || batchEnd(draft),
          batchEnd(draft)
        ),
        continuity: draft.continuity || "",
        ...(stage === "script" && draft.generationQueue?.scriptBatch
          ? { scriptBatch: draft.generationQueue.scriptBatch }
          : {}),
        outline:
          stage === "advice"
            ? advisorMessage ||
              advisorIntent === "recommend_templates" ||
              advisorIntent === "story_variants"
              ? draft.outline
              : ""
            : draft.outlineApproved,
        novel:
          stage === "advice"
            ? advisorMessage ||
              advisorIntent === "recommend_templates" ||
              advisorIntent === "story_variants"
              ? continuationContext(
                  draft,
                  Math.min(draft.chapters.length, batchEnd(draft))
                )
              : ""
            : stage === "chapter"
              ? continuationContext(draft, chapterIndex - 1)
              : stage === "script"
                ? draft.chapters[chapterIndex - 1]
                : "",
        chapterIndex,
        selectedTemplateIds: draft.templates.map(t => t.publicId),
      });
      if (
        !fromQueue &&
        !window.confirm(
          `本次提交管理者测试：${advisorIntent === "story_variants" ? "三个故事线方案" : stage === "advice" ? "创作顾问与模板推荐" : stage === "outline" ? "改编提案" : stage === "chapter" ? `第${chapterIndex}集小说稿` : `第${chapterIndex}集剧本候选`}。将调用创作服务并产生实际成本，是否继续？`
        )
      )
        return;
      if (
        !(await persist({
          ...draft,
          pending: input,
          pendingContextBase:
            stage === "chapter"
              ? draft.chapters.slice(0, chapterIndex - 1).join("\n\n")
              : undefined,
          pendingChapterBase:
            stage === "chapter"
              ? draft.chapters[chapterIndex - 1] || ""
              : undefined,
        }))
      )
        return;
      submittedId = input.requestId;
      activeRequestId.current = input.requestId;
      running.current = true;
      setBusy(true);
      setProgress("正在提交请求…");
      const result = await mutation.mutateAsync(input);
      if (alive.current) await applyResult(input, result);
    } catch (e) {
      queueActive.current = false;
      if (alive.current)
        setError(
          e instanceof Error && !("data" in e)
            ? "issues" in e
              ? "请检查作品名称、方向、模板与长度；顾问对话最多20轮，每次按集提交，前情档案最多8,000字符。"
              : e.message
            : "本次提交未完成，请核对原请求记录；不会自动重试。"
        );
    } finally {
      if (!submittedId || activeRequestId.current === submittedId) {
        running.current = false;
        activeRequestId.current = undefined;
        if (alive.current) setBusy(false);
      }
    }
  };
  const queueConfiguration = (d: NovelWorkspace) =>
    JSON.stringify([
      d.topic,
      d.direction,
      d.templates,
      d.modelPreference,
      d.outline,
      d.source,
      d.episodeStart,
      d.episodeCount,
    ]);
  const startBatch = async (stage: "chapter" | "script", single?: string) => {
    if (disabled || queueSubmitting.current) return;
    const d = latest.current,
      start = batchStart(d),
      end = Math.min(batchEnd(d), d.targetEpisodeCount || batchEnd(d));
    const next =
      stage === "chapter"
        ? Array.from(
            { length: Math.max(0, end - start + 1) },
            (_, i) => start + i
          ).find(i => !d.chapters[i - 1]?.trim())
        : start;
    if (next === undefined || next > end) {
      setError("本批已写完；要修改可逐集重写，已有稿不自动覆盖。");
      return;
    }
    if (
      stage === "chapter" &&
      (!d.outline.trim() || d.outlineApproved !== d.outline)
    ) {
      setError("请先生成并确认本批大纲。");
      return;
    }
    if (stage === "script" && d.novelApproved !== batchNovel(d)) {
      setError("请先审阅并确认本批小说稿。");
      return;
    }
    if (
      !window.confirm(
        `依次生成第${next}–${end}集${stage === "chapter" ? "小说稿" : "剧本"}，每集单独调用模型并产生实际成本；失败即停，不自动重试，批末停下审阅。继续？`
      )
    )
      return;
    queueSubmitting.current = true;
    const scriptBatch =
      stage === "script"
        ? {
            id: crypto.randomUUID(),
            start,
            count: end - start + 1,
            baseline: await novelTextHash(batchNovel(d)),
          }
        : undefined;
    if (
      await persist({
        ...d,
        generationQueue: {
          stage,
          next,
          end,
          single,
          scriptBatch,
          configuration: queueConfiguration(d),
        },
      })
    ) {
      queueActive.current = true;
      setBusy(false);
      setProgress("本批已确认，正在逐集生成…");
    }
    queueSubmitting.current = false;
  };
  useEffect(() => {
    if (
      !queueActive.current ||
      busy ||
      draft.pending ||
      saveError ||
      !draft.generationQueue
    )
      return;
    const q = draft.generationQueue;
    if (q.stage === "chapter" && draft.chapters[q.next - 1]?.trim()) {
      const next = Array.from(
        { length: Math.max(0, q.end - q.next) },
        (_, i) => q.next + i + 1
      ).find(i => !draft.chapters[i - 1]?.trim());
      if (next === undefined) queueActive.current = false;
      void persist({
        ...latest.current,
        generationQueue: next === undefined ? undefined : { ...q, next },
      });
      return;
    }
    if (q.next > (draft.targetEpisodeCount || q.end)) {
      queueActive.current = false;
      setProgress("全剧计划已缩短，后续请求已暂停；已有稿保留。");
      return;
    }
    const timer = setTimeout(
      () =>
        void generate(q.stage, q.single, q.next, undefined, undefined, true),
      50
    );
    return () => clearTimeout(timer);
  }, [draft.generationQueue, draft.pending, busy, saveError, progress]);
  const recover = async () => {
    if (!draft.pending || running.current) return;
    try {
      const receipt = await utils.novelWorkspace.receipt.fetch({
        requestId: draft.pending.requestId,
      });
      if (receipt.status === "succeeded" && receipt.result)
        applyResult(draft.pending, receipt.result);
      else if (receipt.status === "failed") {
        queueActive.current = false;
        persist({
          ...latest.current,
          pending: undefined,
          failedRequest: draft.pending,
        });
        setError("原请求失败，证据保留；如需重做，请手动提交新的测试。");
      } else
        setError(
          receipt.status === "not_found"
            ? "尚未找到服务端记录，请保留请求编号并核对，不自动重提。"
            : "原请求仍在处理，请稍后核对。"
        );
    } catch {
      setError("暂时无法核对原请求，请保留当前页面。");
    }
  };
  const reset = async () => {
    if (busy) return;
    if (
      !window.confirm(
        "放弃本轮并重新开始？当前内容将封存到本机，可下载保留；漫剧工厂作品不受影响。"
      )
    )
      return;
    try {
      queueActive.current = false;
      if (!(await persist(emptyNovelWorkspace(), draft.roundId))) return;
      setError("");
      setSaveError("");
    } catch {
      setSaveError("封存失败，未清空当前轮次；请先下载备份。");
    }
  };
  const field =
    "mt-2 w-full rounded-xl border border-white/15 bg-black/20 p-3 text-sm";
  const button =
    "rounded-xl border border-white/20 px-4 py-2 text-sm disabled:opacity-40";
  return (
    <main className="min-h-screen bg-[#111820] px-5 py-8 text-slate-100 md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-xs tracking-widest text-amber-200">
              MV STUDIO PRO / 管理者测试
            </p>
            <h1 className="mt-2 text-3xl font-semibold">小说改编工作室</h1>
            <p className="mt-3 text-sm text-slate-400">
              顾问提案 → 分集小说稿 → 剧本比较 → 漫剧制作
            </p>
          </div>
          <Link
            href="/canvas"
            onClick={e => {
              if (
                busy &&
                !window.confirm(
                  "仍在生成，离开后请回来核对原请求结果。确定离开？"
                )
              )
                e.preventDefault();
            }}
            className={button}
          >
            返回漫剧工厂
          </Link>
        </header>
        <a href="/manhua-projects" className="mb-4 inline-block underline">
          我的漫剧 · 切换作品
        </a>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-400">
            独立本机草稿，不覆盖当前漫剧。正式计价待定。
          </span>
          <button
            className={button}
            onClick={() =>
              downloadNovelText(
                "小说改编备份.json",
                JSON.stringify(draft, null, 2),
                "application/json"
              )
            }
          >
            下载完整备份
          </button>
          <button
            disabled={busy || !!saveError}
            className={button}
            onClick={reset}
          >
            放弃本轮，重新开始
          </button>
        </div>
        <div className="mb-5 flex flex-wrap gap-3">
          <button
            className={button}
            disabled={backupBusy}
            onClick={async () => {
              setBackupBusy(true);
              setBackupMessage("");
              try {
                await writes.current; // Cloud backup also rescues an in-memory draft after a local write failure.
                const receipt = await backupMutation.mutateAsync({
                  workspaceJson: JSON.stringify(latest.current),
                });
                setBackupMessage(
                  `云端备份已保存 · ${new Date(receipt.createdAt).toLocaleString()}`
                );
                void backupList.refetch();
              } catch {
                setBackupMessage(
                  "云端备份失败，本机稿件保留，请重试或下载完整备份。"
                );
              } finally {
                setBackupBusy(false);
              }
            }}
          >
            {backupBusy ? "备份处理中…" : "云端备份"}
          </button>
          <button className={button} onClick={() => setBackupOpen(v => !v)}>
            回填备份
          </button>
          {backupMessage && <span role="status">{backupMessage}</span>}
        </div>
        {backupOpen && (
          <section className="mb-5 rounded-xl border border-white/15 p-4">
            <h2>选择云端备份</h2>
            <p className="my-2 text-sm">
              回填前先将当前稿存为云端备份，并保留本机版本。生成中的任务请先核对完成，避免错接回执。
            </p>
            {backupList.isLoading && <p>正在读取备份…</p>}
            {backupList.isError && (
              <button onClick={() => void backupList.refetch()}>
                读取失败，重试
              </button>
            )}
            {backupList.data?.length === 0 && (
              <p>暂无云端备份，请先点击云端备份。</p>
            )}
            {backupList.data?.map(item => (
              <div
                key={item.backupId}
                className="my-2 flex flex-wrap items-center gap-3"
              >
                <span>
                  {item.title} · 第{item.season}季 ·{" "}
                  {new Date(item.createdAt).toLocaleString()} ·{" "}
                  {(item.bytes / 1024).toFixed(1)} KB
                </span>
                <button
                  className={button}
                  disabled={disabled || backupBusy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `回填「${item.title}」第${item.season}季的这份备份？当前版本先保留，不会重新提交生成。`
                      )
                    )
                      return;
                    setBackupBusy(true);
                    queueActive.current = false;
                    try {
                      if (!(await writes.current))
                        throw new Error("本机保存失败");
                      const before = latest.current;
                      await backupMutation.mutateAsync({
                        workspaceJson: JSON.stringify(before),
                      });
                      const restored =
                        await utils.novelWorkspace.readBackup.fetch({
                          backupId: item.backupId,
                        });
                      if (latest.current !== before)
                        throw new Error(
                          "回填期间你修改了当前稿件，已保留新修改；请重新选择回填。"
                        );
                      const value = readNovelWorkspace(
                        { getItem: () => restored.workspaceJson },
                        userId
                      ).value;
                      if (
                        !(await persist(
                          value,
                          `${before.roundId}:${crypto.randomUUID()}`
                        ))
                      )
                        throw new Error("本机回填失败");
                      setBackupMessage(
                        "回填成功，生成批次已暂停；在途请求仅核对原回执，不重提。"
                      );
                      setBackupOpen(false);
                    } catch (e) {
                      setBackupMessage(
                        `未完成回填，当前版本保留：${e instanceof Error ? e.message : "请重试"}`
                      );
                    } finally {
                      setBackupBusy(false);
                    }
                  }}
                >
                  回填这一份
                </button>
              </div>
            ))}
          </section>
        )}
        {saveError && (
          <p role="alert" className="mb-4 text-amber-200">
            {saveError}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 text-amber-200">
            {error}
          </p>
        )}
        {failedChapter?.stage === "chapter" && (
          <div className="mb-4 rounded-xl border border-amber-200/30 p-3">
            <p>
              第{failedChapter.chapterIndex}
              集未完成。可尝试恢复已收到的原稿，不重新调用模型。
            </p>
            <button
              className={button}
              disabled={busy || !!draft.pending || !!saveError}
              onClick={async () => {
                const input = failedChapter!;
                recoveringRequestId.current = input.requestId;
                setBusy(true);
                try {
                  if (
                    !(await persist({
                      ...latest.current,
                      pending: input,
                      pendingChapterBase: "",
                      pendingContextBase: latest.current.chapters
                        .slice(0, input.chapterIndex - 1)
                        .join("\n\n"),
                    }))
                  )
                    return;
                  setBusy(true);
                  const result = await recoveryMutation.mutateAsync({
                    requestId: input.requestId,
                  });
                  await applyResult(input, result);
                  setProgress("已恢复原稿，没有重新调用模型。");
                } catch {
                  await persist({ ...latest.current, pending: undefined });
                  setError(
                    "原稿仍无法通过完整校验，已保留证据；没有重新调用模型。"
                  );
                } finally {
                  recoveringRequestId.current = undefined;
                  setBusy(false);
                }
              }}
            >
              恢复已收到的第{failedChapter.chapterIndex}集（不重新生成）
            </button>
            <button
              className={`${button} ml-2`}
              onClick={async () => {
                try {
                  const raw = await utils.novelWorkspace.savedRaw.fetch({
                    requestId: failedChapter.requestId,
                  });
                  setSavedRaw(raw);
                } catch {
                  setError("原稿读取失败，请重试；现有稿件保留。");
                }
              }}
            >
              查看保留原文
            </button>
            {savedRaw?.requestId === failedChapter.requestId && (
              <div className="mt-3">
                <p>
                  这是模型返回的原文，可能含格式错误或未写完的内容。可复制正文到对应集编辑，核对后再续写；不会自动视为完整稿。
                </p>
                <textarea
                  aria-label="保留的模型原文"
                  readOnly
                  className={field}
                  rows={10}
                  value={savedRaw.text}
                />
                <button
                  className={button}
                  onClick={() =>
                    downloadNovelText(
                      `第${failedChapter.chapterIndex}集-保留原文.txt`,
                      savedRaw.text,
                      "text/plain"
                    )
                  }
                >
                  下载保留原文
                </button>
                <p className="break-all text-xs">原文校验：{savedRaw.sha256}</p>
              </div>
            )}
          </div>
        )}
        {draft.pending && (
          <div className="mb-4 rounded-xl border border-amber-200/30 p-3 text-sm">
            <span role="status">{progress || "正在核对原请求进度…"}</span>
            <button
              disabled={busy}
              className={`${button} ml-3`}
              onClick={recover}
            >
              核对原请求
            </button>
            <p className="mt-2 text-xs">请求编号：{draft.pending.requestId}</p>
          </div>
        )}
        <section className="mb-5 rounded-xl border border-white/15 p-4">
          <label>
            全剧计划集数{" "}
            <input
              aria-label="全剧计划集数"
              type="number"
              min={1}
              step={1}
              className={field}
              value={draft.targetEpisodeCount || batchEnd(draft)}
              onChange={e => {
                const n = Number(e.target.value);
                if (Number.isSafeInteger(n) && n > 0)
                  change({ targetEpisodeCount: n });
              }}
            />
          </label>
          <p className="mt-2 text-sm">
            第{draft.season || 1}季 · 当前批次：第{batchStart(draft)}–
            {batchEnd(draft)}
            集。小说稿与剧本使用同一集号。总集数随时可改，缩短计划不会删除任何已写内容。
          </p>
          {(draft.targetEpisodeCount || batchEnd(draft)) < batchEnd(draft) && (
            <button
              className={button}
              disabled={disabled}
              onClick={() => {
                const n =
                  (draft.targetEpisodeCount || 1) - batchStart(draft) + 1;
                if (n < 1) {
                  setError(
                    "本批已超出新计划；请保留原稿并开始下一季，或调整全剧计划。"
                  );
                  return;
                }
                change({
                  episodeCount: n,
                  outlineApproved: "",
                  novelApproved: "",
                });
              }}
            >
              将本批范围缩到计划末集（稿件保留）
            </button>
          )}
          <button
            className={`${button} mt-2`}
            disabled={disabled}
            onClick={() => {
              if (
                !window.confirm(
                  "开始下一季？本季全部稿件、模板和回执保留；新季从第1集开始，承接当前人物与伏笔，可继续修改方向。"
                )
              )
                return;
              const saved = JSON.stringify({ ...draft, seasons: undefined });
              change({
                ...emptyNovelWorkspace(),
                topic: draft.topic,
                direction: draft.direction,
                source: draft.source,
                mode: draft.mode,
                templates: draft.templates,
                modelPreference: draft.modelPreference,
                targetEpisodeCount: draft.targetEpisodeCount,
                season: (draft.season || 1) + 1,
                continuity: draft.continuity,
                seasons: [
                  ...(draft.seasons || []),
                  { season: draft.season || 1, workspace: saved },
                ],
              });
            }}
          >
            开始下一季
          </button>
          {!!draft.seasons?.length && (
            <details>
              <summary>保留的季稿（{draft.seasons.length}）</summary>
              {draft.seasons.map((v, i) => (
                <div key={i}>
                  第{v.season}季{" "}
                  <button
                    className="underline"
                    onClick={() =>
                      downloadNovelText(
                        `第${v.season}季.json`,
                        v.workspace,
                        "application/json"
                      )
                    }
                  >
                    下载完整稿件
                  </button>
                  <button
                    disabled={disabled}
                    className="ml-3 underline"
                    onClick={() => {
                      if (!window.confirm("切回此季？当前季也完整保留。"))
                        return;
                      const previous = JSON.parse(
                        v.workspace
                      ) as NovelWorkspace;
                      change({
                        ...previous,
                        seasons: [
                          ...draft.seasons!.filter((_, n) => n !== i),
                          {
                            season: draft.season || 1,
                            workspace: JSON.stringify({
                              ...draft,
                              seasons: undefined,
                            }),
                          },
                        ],
                      });
                    }}
                  >
                    切回此季
                  </button>
                </div>
              ))}
            </details>
          )}
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="min-w-0 rounded-2xl border border-white/10 p-5">
            <h2 className="text-xl">01 / 创作方向与顾问</h2>
            <fieldset disabled={disabled}>
              <div className="mt-4 flex gap-2">
                {(["source", "original"] as const).map(mode => (
                  <button
                    key={mode}
                    className={`${button} ${draft.mode === mode ? "bg-amber-200 text-slate-950" : ""}`}
                    onClick={() => {
                      if (mode === "source") {
                        flushSync(() => change({ mode }));
                        sourceFileInput.current?.click();
                      } else change({ mode });
                    }}
                  >
                    {mode === "source" ? "上传底本改编" : "原创新方向"}
                  </button>
                ))}
              </div>
              {draft.mode === "source" && (
                <ManhuaNovelSourcePanel
                  inline
                  fileInputRef={sourceFileInput}
                  value={draft.source}
                  onChange={source => change({ source })}
                  disabled={disabled}
                />
              )}
              <label className="mt-4 block">
                作品名称
                <input
                  aria-label="作品名称"
                  className={field}
                  maxLength={200}
                  value={draft.topic}
                  onChange={e => change({ topic: e.target.value })}
                />
              </label>
              <label className="mt-4 block">
                创作方向
                <textarea
                  aria-label="创作方向"
                  className={field}
                  maxLength={2000}
                  rows={4}
                  value={draft.direction}
                  onChange={e => change({ direction: e.target.value })}
                  placeholder="主角想得到什么？障碍是什么？希望观众期待什么？"
                />
              </label>
              <label className="mt-4 block text-sm">
                创作模型
                <select
                  aria-label="创作模型"
                  className={field}
                  value={draft.modelPreference || "auto"}
                  onChange={e =>
                    change({
                      modelPreference: e.target.value as
                        | "auto"
                        | "glm"
                        | "deepseek",
                    })
                  }
                >
                  {NOVEL_MODEL_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-xs text-slate-400">
                  用于接下来提交的顾问与创作任务。手动选择不会换模型；已生成内容保留。重新取建议只使用当前方向、底本和配比，不带旧回答；回复顾问才带对话。
                </span>
              </label>
              <button
                className={`${button} mt-4 bg-amber-200 text-slate-950`}
                onClick={() => generate("advice")}
              >
                {busy ? "创作服务处理中…" : "请创作顾问建议方向与模板"}
              </button>
              <div
                aria-live="polite"
                className="mt-2 text-sm"
                data-advisor-feedback
              >
                {error && (
                  <p role="alert" className="text-amber-200">
                    {error}
                  </p>
                )}
                {saveError && (
                  <p role="alert" className="text-amber-200">
                    {saveError}
                  </p>
                )}
                {draft.pending && (
                  <p role="status">{progress || "正在核对原请求进度…"}</p>
                )}
                {!error && !saveError && !draft.pending && (
                  <p className="text-slate-400">
                    填好作品名称、方向，并采用正文选段后提交；无需先选择模板。
                  </p>
                )}
              </div>
            </fieldset>
            {advice && (
              <div className="mt-5 space-y-3">
                <h3 className="font-semibold">与创作顾问讨论</h3>
                <div
                  ref={conversation}
                  aria-label="顾问对话记录"
                  className="max-h-80 space-y-3 overflow-y-auto rounded-xl bg-black/20 p-3"
                >
                  {adviceRuns.map(r => (
                    <div key={r.input.requestId}>
                      <button
                        className="mb-2 text-xs underline disabled:no-underline disabled:text-emerald-200"
                        disabled={
                          disabled ||
                          adviceRun?.input.requestId === r.input.requestId
                        }
                        onClick={() =>
                          change({ advisorAnchor: r.input.requestId })
                        }
                      >
                        {adviceRun?.input.requestId === r.input.requestId
                          ? "当前采用的讨论"
                          : "以这版继续讨论与创作"}
                      </button>
                      <p className="mb-2 whitespace-pre-wrap text-sm text-amber-200">
                        你：
                        {r.input.advisorMessage ||
                          "请依据创作方向提出建议与模板推荐。"}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-7">
                        顾问：
                        {
                          novelAdviceSchema.parse(JSON.parse(r.result.text))
                            .assessment
                        }
                      </p>
                      {r.result.model && (
                        <p className="mt-2 text-xs text-slate-400">
                          备注：{novelModelLabel(r.result.model)}
                          {r.result.settings
                            ? ` · 推理：${r.result.settings.reasoning === "off" ? "关闭" : r.result.settings.reasoning === "enabled" ? "已开启" : r.result.settings.reasoning} · 输出上限：${r.result.settings.maxTokens}`
                            : ""}
                        </p>
                      )}
                    </div>
                  ))}
                  {draft.pending?.advisorMessage && (
                    <p className="whitespace-pre-wrap text-sm text-amber-200">
                      你：{draft.pending.advisorMessage}
                    </p>
                  )}
                </div>
                <label className="block text-sm">
                  回复顾问
                  <textarea
                    aria-label="回复顾问"
                    className={field}
                    rows={3}
                    maxLength={2000}
                    disabled={disabled}
                    value={draft.advisorDraft || ""}
                    onChange={e => change({ advisorDraft: e.target.value })}
                    placeholder="例如：保留未来武器；这三个模板分别负责权谋、破局和对白，你建议怎么组合？"
                  />
                </label>
                <button
                  className={button}
                  disabled={disabled || !draft.advisorDraft?.trim()}
                  onClick={() =>
                    generate("advice", undefined, 1, draft.advisorDraft?.trim())
                  }
                >
                  发送给顾问
                </button>
                <button
                  className={`${button} ml-2`}
                  disabled={disabled || !draft.advisorDraft?.trim()}
                  onClick={() =>
                    generate(
                      "advice",
                      undefined,
                      1,
                      draft.advisorDraft?.trim(),
                      "story_variants"
                    )
                  }
                >
                  按新方向生成3个故事方案
                </button>
                <p className="text-xs text-slate-400">
                  回复会带上前文与当前模板分工。故事线不满意时，写出新方向再生成3个故事方案；顾问结合原有情节与库内模板，展示具体变化与取舍。原稿保留，方案不自动采用。
                </p>
                <h3 className="font-semibold">
                  可选模板 · 讨论不会自动更改选择
                </h3>
                {recommendationAdvice?.recommendations.map(r => (
                  <article
                    key={r.publicId}
                    className="rounded-xl border border-emerald-200/20 p-3"
                  >
                    <h4>
                      {cards.find(c => c.publicId === r.publicId)?.nameZh ||
                        r.publicId}
                    </h4>
                    <p className="mt-2 text-sm">推荐原因：{r.reason}</p>
                    <p className="mt-2 text-sm text-slate-400">
                      取舍：{r.tradeoff}
                    </p>
                    <button
                      disabled={
                        disabled ||
                        draft.templates.some(t => t.publicId === r.publicId)
                      }
                      className={`${button} mt-3`}
                      onClick={() => addTemplate(r.publicId)}
                    >
                      加入本轮候选
                    </button>
                  </article>
                ))}
                {!adviceRun?.input.advisorMessage &&
                  !advice.variants &&
                  advice.recommendations.length < 3 && (
                    <p className="text-xs text-amber-200">
                      可推荐的库内模板不足3个，未编造补足。
                    </p>
                  )}
              </div>
            )}
          </section>
          <section className="min-w-0 rounded-2xl border border-white/10 p-5">
            <h2 className="text-xl">02 / 模板与分工</h2>
            <p className="mt-3 text-sm text-slate-400">
              自己挑选或采用顾问推荐；可单独生成，也可指定分工组合。
            </p>
            <button
              className={`${button} mt-3`}
              disabled={disabled || templates.isFetching}
              onClick={() => void templates.refetch()}
            >
              刷新模板库
            </button>
            {templates.isError && (
              <div role="alert" className="mt-3 text-sm text-amber-200">
                模板加载失败，已有选择保留。
                <button
                  className="ml-2 underline"
                  onClick={() => void templates.refetch()}
                >
                  重试读取
                </button>
              </div>
            )}
            <ManhuaTemplatePicker
              cards={cards}
              value={selected}
              disabled={disabled}
              onChange={id => {
                setSelected(id);
                if (id) addTemplate(id);
              }}
            />
            {!!draft.templates.length && (
              <div
                className="mt-4 rounded-xl border border-amber-200/20 p-3"
                aria-label="模板创作配比"
              >
                <p className="font-medium">
                  创作配比{weighted ? ` · 合计 ${weightTotal}%` : ""}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  表示手法影响程度，不按字数分配。0%仅作情节参考；调整只影响下一次生成，已有稿保留。单独使用一个模板时按100%创作。
                </p>
                <button
                  className={`${button} mt-2`}
                  disabled={disabled}
                  onClick={() =>
                    change({
                      templates: draft.templates.map((t, i) => ({
                        ...t,
                        weight:
                          Math.floor(100 / draft.templates.length) +
                          (i < 100 % draft.templates.length ? 1 : 0),
                      })),
                    })
                  }
                >
                  {weighted ? "平均分配" : "设置百分比"}
                </button>
                {!weightValid && (
                  <p role="alert" className="mt-2 text-sm text-amber-200">
                    请将所有模板配比合计调整为100%，不会自动改动你的比例。
                  </p>
                )}
              </div>
            )}
            {draft.templates.map(t => (
              <div
                key={t.publicId}
                className="mt-3 rounded-lg border border-white/10 p-3"
              >
                <div className="flex justify-between">
                  <span>
                    {cards.find(c => c.publicId === t.publicId)?.nameZh ||
                      t.publicId}
                  </span>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      change({
                        templates: draft.templates.filter(
                          x => x.publicId !== t.publicId
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
                {weighted && (
                  <label className="mt-2 block text-xs">
                    创作占比（%）
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      aria-label={`模板占比 ${t.publicId}`}
                      className={field}
                      disabled={disabled}
                      value={t.weight ?? ""}
                      onChange={e => {
                        const value =
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value);
                        if (
                          value !== undefined &&
                          (!Number.isInteger(value) || value < 0 || value > 100)
                        )
                          return;
                        change({
                          templates: draft.templates.map(x =>
                            x.publicId === t.publicId
                              ? { ...x, weight: value }
                              : x
                          ),
                        });
                      }}
                    />
                  </label>
                )}
                <label className="mt-2 block text-xs">
                  组合时负责什么
                  <input
                    aria-label={`模板分工 ${t.publicId}`}
                    disabled={disabled}
                    className={field}
                    maxLength={160}
                    value={t.role}
                    onChange={e =>
                      change({
                        templates: draft.templates.map(x =>
                          x.publicId === t.publicId
                            ? { ...x, role: e.target.value }
                            : x
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <button
              disabled={disabled || !draft.templates.length}
              className={`${button} mt-4`}
              onClick={() =>
                generate("advice", undefined, 1, undefined, "story_variants")
              }
            >
              生成3个故事方案
            </button>
            <p className="mt-2 text-sm text-slate-400">
              选好模板即可比较三个故事走向。采用后可编辑大纲，再确认生成小说。
            </p>
            {[...adviceRuns]
              .reverse()
              .filter(r => r.input.advisorIntent === "story_variants")
              .map(run => (
                <section
                  key={run.input.requestId}
                  className="mt-5 space-y-3"
                  aria-label="故事线方案"
                >
                  <h3 className="font-semibold">
                    {run.input.advisorMessage
                      ? `新方向：${run.input.advisorMessage}`
                      : "所选模板 · 三个故事走向"}
                  </h3>
                  {novelAdviceSchema
                    .parse(JSON.parse(run.result.text))
                    .variants?.map(variant => (
                      <article
                        key={variant.id}
                        className="rounded-xl border border-amber-200/20 p-4"
                      >
                        <h4 className="text-lg font-semibold">
                          {variant.id} · {variant.title}
                        </h4>
                        <p className="mt-2 whitespace-pre-wrap">
                          {variant.outline.premise}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          人物：{variant.outline.characters}
                        </p>
                        <p className="mt-2 text-sm text-amber-200">
                          变化：{variant.changeSummary}
                        </p>
                        <p className="mt-2 text-sm text-slate-400">
                          取舍：{variant.tradeoff}
                        </p>
                        {variant.outline.episodes.map(ep => (
                          <div
                            key={ep.index}
                            className="mt-3 border-t border-white/10 pt-2 text-sm"
                          >
                            <h5 className="font-semibold">
                              第{ep.index}集 · {ep.title}
                            </h5>
                            <p className="whitespace-pre-wrap">{ep.events}</p>
                            <p className="mt-1">本集兑现：{ep.payoff}</p>
                            <p>追看理由：{ep.hook}</p>
                          </div>
                        ))}
                        <details className="mt-3 text-sm">
                          <summary>模板分工与配比</summary>
                          {variant.templates.map(t => (
                            <p key={t.publicId}>
                              {cards.find(c => c.publicId === t.publicId)
                                ?.nameZh || t.publicId}{" "}
                              · {t.weight}% · {t.role}
                            </p>
                          ))}
                        </details>
                        <button
                          className={`${button} mt-3`}
                          disabled={
                            disabled ||
                            (run.input.episodeStart || 1) !== batchStart(draft)
                          }
                          onClick={() => {
                            if (
                              variant.templates.some(
                                t => !cards.some(c => c.publicId === t.publicId)
                              )
                            ) {
                              setError(
                                "方案内有已不可用模板，请刷新模板库后重新提案。"
                              );
                              return;
                            }
                            if (
                              !window.confirm(
                                "采用此故事线？当前大纲、小说与模板会保存到采用前版本；不会自动生成小说。"
                              )
                            )
                              return;
                            change({
                              storyVersions: [
                                ...(draft.storyVersions || []),
                                {
                                  label: `采用${variant.id} · ${variant.title}前 · ${new Date().toLocaleString()}`,
                                  outline: draft.outline,
                                  episodeCount: draft.episodeCount,
                                  episodeStart: batchStart(draft),
                                  advisorAnchor: draft.advisorAnchor,
                                  chapters: [...draft.chapters],
                                  templates: draft.templates.map(t => ({
                                    ...t,
                                  })),
                                },
                              ],
                              outline: formatNovelOutline(variant.outline),
                              templates: variant.templates.map(t => ({ ...t })),
                              episodeCount: run.input.episodeCount,
                              chapters: [...draft.chapters],
                              episodeStart: run.input.episodeStart || 1,
                              outlineApproved: "",
                              novelApproved: "",
                              advisorAnchor: run.input.requestId,
                            });
                          }}
                        >
                          采用这条故事线
                        </button>
                      </article>
                    ))}
                </section>
              ))}
            {!!draft.storyVersions?.length && (
              <details className="mt-4">
                <summary>采用前版本（{draft.storyVersions.length}）</summary>
                {draft.storyVersions.map((version, index) => (
                  <article
                    key={index}
                    className="mt-3 rounded-xl border border-white/10 p-3"
                  >
                    <p>{version.label}</p>
                    <details>
                      <summary>查看原稿</summary>
                      <pre className="whitespace-pre-wrap text-sm">
                        {[version.outline, ...version.chapters].join("\n\n") ||
                          "尚未生成正文"}
                      </pre>
                    </details>
                    <button
                      className={`${button} mt-2`}
                      disabled={disabled}
                      onClick={() => {
                        if (
                          !window.confirm(
                            "恢复此版本？当前稿件也会保留，恢复后请重新确认大纲与小说。"
                          )
                        )
                          return;
                        change({
                          storyVersions: [
                            ...(draft.storyVersions || []),
                            {
                              label: `恢复前 · ${new Date().toLocaleString()}`,
                              outline: draft.outline,
                              episodeCount: draft.episodeCount,
                              episodeStart: batchStart(draft),
                              advisorAnchor: draft.advisorAnchor,
                              chapters: [...draft.chapters],
                              templates: draft.templates.map(t => ({ ...t })),
                            },
                          ],
                          outline: version.outline,
                          episodeCount:
                            version.episodeCount || draft.episodeCount,
                          episodeStart: version.episodeStart || 1,
                          advisorAnchor: version.advisorAnchor,
                          chapters: [...version.chapters],
                          templates: version.templates.map(t => ({ ...t })),
                          outlineApproved: "",
                          novelApproved: "",
                        });
                      }}
                    >
                      恢复此版本
                    </button>
                  </article>
                ))}
              </details>
            )}
            <button
              className={`${button} mt-4`}
              disabled={disabled || !advice || !draft.templates.length}
              onClick={() => void generate("outline")}
            >
              生成本批续写提案
            </button>
            <label className="mt-4 block">
              提案与大纲 · 可修改
              <textarea
                aria-label="提案与大纲"
                disabled={disabled}
                className={field}
                rows={12}
                value={draft.outline}
                onChange={e =>
                  change({
                    outline: e.target.value,
                    outlineApproved: "",
                    novelApproved: "",
                  })
                }
                maxLength={14000}
              />
            </label>
            <button
              disabled={disabled || !draft.outline.trim()}
              className={`${button} mt-3`}
              onClick={() =>
                change({ outlineApproved: draft.outline, novelApproved: "" })
              }
            >
              确认大纲，开始分集写作
            </button>
          </section>
        </div>
        <section className="mt-6 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl">03 / 分集小说稿 · 审阅后再转剧本</h2>
          <p className="mt-2 text-sm text-slate-400">
            生成时仍可修改任何一集；正在生成的内容不会实时读取你的新修改，返回后会提示核对衔接。
          </p>
          <div className="my-3 flex flex-wrap gap-2">
            <button
              className={`${button} bg-amber-200 text-slate-950`}
              disabled={disabled || !!draft.generationQueue}
              onClick={() => void startBatch("chapter")}
            >
              生成本批未写集数（逐集保存）
            </button>
            {draft.generationQueue && (
              <>
                <span role="status">
                  本批下一集：{draft.generationQueue.next} /{" "}
                  {draft.generationQueue.end} ·{" "}
                  {queueActive.current ? "运行中" : "已暂停"}
                </span>
                <button
                  className={button}
                  onClick={() => {
                    queueActive.current = false;
                    setProgress("已暂停后续请求；当前请求仍会保存，不重提。");
                  }}
                >
                  暂停后续生成
                </button>
                <button
                  className={button}
                  disabled={busy || !!draft.pending || !!saveError}
                  onClick={() => {
                    if (
                      window.confirm(
                        "从下一集继续已确认批次？每集会调用模型，失败即停。"
                      )
                    ) {
                      queueActive.current = true;
                      setProgress("正在继续本批…");
                    }
                  }}
                >
                  继续本批
                </button>
                <button
                  className={button}
                  disabled={busy || !!draft.pending}
                  onClick={() => {
                    queueActive.current = false;
                    change({ generationQueue: undefined });
                  }}
                >
                  结束本批生成，保留已有稿
                </button>
              </>
            )}
          </div>
          <details className="my-3 rounded-xl border border-white/15 p-3">
            <summary>续写档案 · 人物、前情与未解伏笔</summary>
            <p className="text-xs">
              长篇续写使用累计档案与最近两集全文；全部原文仍保留。修改早期情节后，请同步核对档案再续写。新季沿用上一季档案。
            </p>
            <textarea
              aria-label="续写档案"
              className={field}
              rows={6}
              maxLength={8000}
              value={draft.continuity || ""}
              onChange={e =>
                change({
                  continuity: e.target.value,
                  continuityBase: undefined,
                })
              }
            />
            <button
              className={button}
              disabled={busy || !!draft.pending || !draft.continuity?.trim()}
              onClick={() => {
                let through = 0;
                while (draft.chapters[through]?.trim()) through++;
                change({
                  continuityThrough: through,
                  continuityBase: draft.chapters.slice(0, through).join("\n\n"),
                });
              }}
            >
              已核对档案与当前原文
            </button>
          </details>
          {Array.from(
            { length: Math.max(batchEnd(draft), draft.chapters.length) },
            (_, i) => (
              <div key={i} className="mt-4">
                <div className="flex items-center gap-3">
                  <h3>第{i + 1}集</h3>
                  <button
                    className={button}
                    disabled={
                      disabled ||
                      i + 1 < batchStart(draft) ||
                      i + 1 > batchEnd(draft) ||
                      !draft.outlineApproved ||
                      draft.outlineApproved !== draft.outline ||
                      (i > 0 && !draft.chapters[i - 1])
                    }
                    onClick={() => generate("chapter", undefined, i + 1)}
                  >
                    {draft.chapters[i] ? "重新生成本集" : "生成本集"}
                  </button>
                </div>
                <textarea
                  aria-label={`第${i + 1}集小说稿`}
                  disabled={Boolean(initial.error)}
                  className={field}
                  rows={8}
                  maxLength={6600}
                  value={draft.chapters[i] || ""}
                  onChange={e => {
                    const chapters = [...draft.chapters];
                    chapters[i] = e.target.value;
                    const chapterWarnings = { ...draft.chapterWarnings };
                    for (let j = i + 1; j < draft.chapters.length; j++)
                      if (chapters[j])
                        chapterWarnings[String(j)] =
                          "前文已修改，请核对本集衔接。";
                    change({ chapters, chapterWarnings, novelApproved: "" });
                  }}
                />
                {draft.chapterWarnings?.[String(i)] && (
                  <div className="mt-2 text-sm text-amber-200" role="status">
                    {draft.chapterWarnings[String(i)]}
                    <button
                      className="ml-2 underline"
                      onClick={() => {
                        const warnings = { ...draft.chapterWarnings };
                        delete warnings[String(i)];
                        change({ chapterWarnings: warnings });
                      }}
                    >
                      已核对本集
                    </button>
                  </div>
                )}
                {draft.runs.filter(
                  r =>
                    r.input.stage === "chapter" &&
                    r.input.chapterIndex === i + 1
                ).length > 0 && (
                  <details className="mt-2 text-sm">
                    <summary>本集生成稿与保留版本</summary>
                    {draft.runs
                      .filter(
                        r =>
                          r.input.stage === "chapter" &&
                          r.input.chapterIndex === i + 1
                      )
                      .map(r => {
                        const chapter = novelChapterSchema.parse(
                          JSON.parse(r.result.text)
                        );
                        const text = `${chapter.title}\n\n${chapter.text}`;
                        return (
                          <article key={r.input.requestId} className="mt-2">
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                              {text}
                            </pre>
                            <button
                              disabled={Boolean(initial.error)}
                              className="underline"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    "采用这份生成稿？当前手动修改会保留为本集历史版本。"
                                  )
                                )
                                  return;
                                const chapters = [...draft.chapters];
                                chapters[i] = text;
                                const warnings = {
                                  ...draft.chapterWarnings,
                                  [String(i)]:
                                    "已采用历史生成稿，请结合当前前文核对衔接。",
                                };
                                for (
                                  let j = i + 1;
                                  j < draft.chapters.length;
                                  j++
                                )
                                  if (chapters[j])
                                    warnings[String(j)] =
                                      "前文已修改，请核对本集衔接。";
                                change({
                                  chapters,
                                  chapterWarnings: warnings,
                                  chapterVersions: [
                                    ...(draft.chapterVersions || []),
                                    {
                                      index: i,
                                      text: draft.chapters[i] || "",
                                      savedAt: new Date().toISOString(),
                                    },
                                  ],
                                  novelApproved: "",
                                });
                              }}
                            >
                              采用这份生成稿
                            </button>
                          </article>
                        );
                      })}
                    {draft.chapterVersions
                      ?.filter(v => v.index === i)
                      .map((v, n) => (
                        <details key={n}>
                          <summary>
                            手动稿 · {new Date(v.savedAt).toLocaleString()}
                          </summary>
                          <pre className="whitespace-pre-wrap">{v.text}</pre>
                        </details>
                      ))}
                  </details>
                )}
              </div>
            )
          )}
          <button
            disabled={
              disabled ||
              !draft.outlineApproved ||
              draft.outlineApproved !== draft.outline ||
              draft.chapters
                .slice(batchStart(draft) - 1, batchEnd(draft))
                .filter(c => c.trim().length >= 500).length !==
                draft.episodeCount
            }
            className={`${button} mt-4 bg-amber-200 text-slate-950`}
            onClick={() => change({ novelApproved: currentNovel })}
          >
            确认这版小说，进入模板比较
          </button>
        </section>
        <section className="mt-6 rounded-xl border border-amber-200/20 p-4">
          <h2>审阅后续写</h2>
          <p className="my-2 text-sm">
            确认本批小说后，选择下一批范围，再修改方向、模板配比并生成新提案。每批结束都停下审阅，不自动写完整部。
          </p>
          {[10, 20].map(count => (
            <button
              key={count}
              className={`${button} mr-2`}
              disabled={disabled || !!draft.generationQueue}
              onClick={() => {
                try {
                  change(nextNovelBatch(draft, count));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              审阅通过，准备续写{count}集
            </button>
          ))}
        </section>
        <section className="mt-6 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl">04 / 本批剧本与模板比较</h2>
          <div className="my-4 flex flex-wrap gap-2">
            {draft.templates.map(t => (
              <button
                key={t.publicId}
                className={button}
                disabled={
                  disabled ||
                  !draft.novelApproved ||
                  draft.novelApproved !== currentNovel
                }
                onClick={() => void startBatch("script", t.publicId)}
              >
                单独生成 ·{" "}
                {cards.find(c => c.publicId === t.publicId)?.nameZh ||
                  t.publicId}
              </button>
            ))}
            <button
              className={button}
              disabled={
                disabled ||
                draft.templates.length < 2 ||
                !draft.novelApproved ||
                draft.novelApproved !== currentNovel
              }
              onClick={() => void startBatch("script")}
            >
              按分工组合生成
            </button>
          </div>
          <NovelTemplateComparison
            runs={completeScriptBatches(draft.runs)}
            disabled={disabled}
            onAdopt={async run => {
              if (
                !window.confirm(
                  `将「${JSON.parse(run.result.text).title}」第${run.input.episodeStart || 1}–${(run.input.episodeStart || 1) + run.input.episodeCount - 1}集接入本季漫剧作品。已有集数与素材保留；不会自动生成图片或视频。继续？`
                )
              )
                return;
              try {
                // The assembled view is derived from preserved per-episode receipts.
                if (
                  run.input.scriptBatch &&
                  run.input.requestId === run.input.scriptBatch.id
                ) {
                  run = {
                    ...run,
                    result: {
                      ...run.result,
                      resultSha256: await novelTextHash(run.result.text),
                      inputSha256: await novelTextHash(
                        JSON.stringify(run.input)
                      ),
                    },
                  };
                }
                const cloud = await utils.manhuaCloudDraft.get.fetch({
                  projectId: draft.roundId,
                });
                const localAt = localStorage.getItem(
                  `mv-manhua-project:${userId}:${draft.roundId}:mv-manhua-cloud-draft-local-at-v1`
                );
                if (
                  cloud?.draft &&
                  (!localAt ||
                    Date.parse(cloud.draft.clientUpdatedAt || "") >
                      Date.parse(localAt))
                )
                  throw new Error(
                    "此作品云端有更新，请先在我的漫剧中打开恢复最新内容，再回来追加续集。"
                  );
                if (!(await writes.current))
                  throw new Error("改编稿尚未保存，未跳转");
                if (!navigator.locks)
                  throw new Error(
                    "当前浏览器无法取得作品编辑锁，请使用支持此功能的浏览器。"
                  );
                const project = await navigator.locks.request(
                  `mv-manhua-project:${userId}:${draft.roundId}`,
                  { ifAvailable: true },
                  lock => {
                    if (!lock)
                      throw new Error(
                        "此作品正在另一页面中编辑，请先保存并关闭那个作品页面，再追加续集。"
                      );
                    return createNovelFactoryProject(
                      localStorage,
                      userId,
                      run,
                      draft.roundId
                    );
                  }
                );
                window.location.assign(project.href);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "创建作品失败，原稿保留"
                );
              }
            }}
          />
        </section>
        <details className="mt-6 rounded-xl border border-white/10 p-4">
          <summary>本轮版本与完整记录（{draft.runs.length}）</summary>
          {draft.runs.map((run, i) => (
            <details key={run.result.requestId} className="mt-3">
              <summary>
                {i + 1}.{" "}
                {
                  {
                    advice: "顾问建议",
                    outline: "提案",
                    chapter: "小说",
                    script: "剧本",
                  }[run.input.stage]
                }{" "}
                · {run.result.requestId}
              </summary>
              <button
                className={`${button} mt-2`}
                onClick={() =>
                  downloadNovelText(
                    `改编记录-${run.result.requestId}.json`,
                    JSON.stringify(run, null, 2),
                    "application/json"
                  )
                }
              >
                下载记录
              </button>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">
                {run.result.text}
              </pre>
            </details>
          ))}
        </details>
      </div>
    </main>
  );
}

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
  novelModelLabel,
  NOVEL_MODEL_OPTIONS,
  novelChapterSchema,
  novelOutlineSchema,
  novelTestInputSchema,
  type NovelTestInput,
} from "@shared/novelWorkspace";
import {
  archiveNovelRound,
  downloadNovelText,
  emptyNovelWorkspace,
  novelSourceIdentity,
  readNovelWorkspace,
  saveNovelWorkspace,
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
  const [initial] = useState(() => {
    try {
      return { ...readNovelWorkspace(localStorage, userId), error: "" };
    } catch {
      return {
        raw: null,
        value: emptyNovelWorkspace(),
        error: "本机草稿无法读取，已停止写入；请保留浏览器数据。",
      };
    }
  });
  const [draft, setDraft] = useState(initial.value),
    [saveError, setSaveError] = useState(initial.error),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState("");
  const [progress, setProgress] = useState("");
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
  const utils = trpc.useUtils();
  const persist = (next: NovelWorkspace) => {
    latest.current = next;
    setDraft(next);
    if (initial.error) return false;
    try {
      raw.current = saveNovelWorkspace(localStorage, userId, raw.current, next);
      setSaveError("");
      return true;
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message.includes("另一页面")
          ? e.message
          : "本机保存失败，请下载完整备份再离开。"
      );
      return false;
    }
  };
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (running.current || saveError) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saveError]);
  const change = (patch: Partial<NovelWorkspace>) => {
    const next = { ...draft, ...patch };
    if (novelSourceIdentity(next) !== novelSourceIdentity(draft)) {
      next.outlineApproved = "";
      next.novelApproved = "";
    }
    persist(next);
  };
  const addTemplate = (id: string) => {
    if (draft.templates.some(t => t.publicId === id)) return;
    if (draft.templates.length >= 5) {
      setError("本轮最多选择5个模板");
      return;
    }
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
  const disabled = busy || !!saveError || !!draft.pending;
  const weighted = draft.templates.some(t => t.weight !== undefined);
  const weightTotal = draft.templates.reduce(
    (sum, t) => sum + (t.weight || 0),
    0
  );
  const weightValid =
    !weighted ||
    (weightTotal === 100 && draft.templates.every(t => t.weight !== undefined));
  const currentNovel = draft.chapters
    .map((text, i) => `第${i + 1}章\n${text}`)
    .join("\n\n");
  const adviceRuns = draft.runs.filter(
    r =>
      r.input.stage === "advice" &&
      r.input.roundId === draft.roundId &&
      r.input.topic === draft.topic &&
      r.input.direction === draft.direction &&
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
      now.runs.some(r => r.result.requestId === result.requestId)
    )
      return;
    try {
      localStorage.setItem(
        `mv-novel-lab-snapshot:${userId}:${input.requestId}`,
        JSON.stringify(now)
      );
    } catch {
      setSaveError(
        "生成结果已有服务端记录，但本机版本保存失败，请下载备份后核对原请求。"
      );
      return;
    }
    const next = {
      ...now,
      pending: undefined,
      runs: [...now.runs, { input, result }],
    };
    if (input.stage === "outline") {
      const plan = novelOutlineSchema.parse(JSON.parse(result.text));
      next.outline = [
        `核心冲突\n${plan.premise}`,
        `人物关系\n${plan.characters}`,
        ...plan.episodes.map(
          ep =>
            `第${ep.index}集：${ep.title}\n剧情：${ep.events}\n本集兑现：${ep.payoff}\n片尾钩子：${ep.hook}`
        ),
      ].join("\n\n");
      next.outlineApproved = "";
      next.chapters = [];
      next.novelApproved = "";
    }
    if (input.stage === "chapter") {
      const chapter = novelChapterSchema.parse(JSON.parse(result.text));
      next.chapters = [...now.chapters];
      next.chapters[input.chapterIndex - 1] =
        `${chapter.title}\n\n${chapter.text}`;
      next.novelApproved = "";
    }
    if (input.stage === "advice") {
      next.advisorAnchor = input.requestId;
      if (input.advisorMessage === now.advisorDraft?.trim())
        next.advisorDraft = "";
      next.outlineApproved = "";
      next.novelApproved = "";
    }
    setError("");
    persist(next);
  };
  // Poll only the original receipt. Never resubmit a generation on refresh or network failure.
  useEffect(() => {
    const pending = draft.pending;
    if (!pending || saveError) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const receipt = await utils.novelWorkspace.receipt.fetch({
          requestId: pending.requestId,
        });
        if (stopped || latest.current.pending?.requestId !== pending.requestId)
          return;
        if (receipt.status === "succeeded" && receipt.result) {
          applyResult(pending, receipt.result);
          setProgress("已完成，建议已保存。");
          return;
        }
        if (receipt.status === "failed") {
          persist({ ...latest.current, pending: undefined });
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
    advisorIntent?: NovelTestInput["advisorIntent"]
  ) => {
    if (disabled || running.current) return;
    setError("");
    try {
      if (stage === "advice" && adviceRuns.length >= 20)
        throw new Error(
          "本轮已完成20次顾问讨论，请整理并确认提案后继续；历史对话完整保留。"
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
        throw new Error("请先完成前一章。");
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
        ...(((stage === "advice" && advisorMessage) || stage === "outline") &&
        adviceRuns.length
          ? {
              advisorHistory: discussionHistory,
            }
          : {}),
        templates: choices,
        episodeCount: draft.episodeCount,
        outline:
          stage === "advice"
            ? advisorIntent === "recommend_templates"
              ? draft.outline
              : ""
            : draft.outlineApproved,
        novel:
          stage === "advice"
            ? advisorIntent === "recommend_templates"
              ? currentNovel
              : ""
            : stage === "chapter"
              ? draft.chapters.slice(0, chapterIndex - 1).join("\n\n")
              : draft.novelApproved,
        chapterIndex,
        selectedTemplateIds: draft.templates.map(t => t.publicId),
      });
      if (
        !window.confirm(
          `本次提交管理者测试：${stage === "advice" ? "创作顾问与模板推荐" : stage === "outline" ? "改编提案" : stage === "chapter" ? `第${chapterIndex}章小说` : `${draft.episodeCount}集剧本候选`}。将调用创作服务并产生实际成本，是否继续？`
        )
      )
        return;
      if (!persist({ ...draft, pending: input })) return;
      running.current = true;
      setBusy(true);
      setProgress("正在提交请求…");
      const result = await mutation.mutateAsync(input);
      if (alive.current) applyResult(input, result);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error && !("data" in e)
            ? "issues" in e
              ? "请检查作品名称、方向、模板与长度；顾问对话最多20轮，小说最多20,000字符。"
              : e.message
            : "本次提交未完成，请核对原请求记录；不会自动重试。"
        );
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const recover = async () => {
    if (!draft.pending || running.current) return;
    try {
      const receipt = await utils.novelWorkspace.receipt.fetch({
        requestId: draft.pending.requestId,
      });
      if (receipt.status === "succeeded" && receipt.result)
        applyResult(draft.pending, receipt.result);
      else if (receipt.status === "failed") {
        persist({ ...draft, pending: undefined });
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
  const reset = () => {
    if (busy) return;
    if (
      !window.confirm(
        "放弃本轮并重新开始？当前内容将封存到本机，可下载保留；漫剧工厂作品不受影响。"
      )
    )
      return;
    try {
      const next = archiveNovelRound(localStorage, userId, raw.current, draft);
      raw.current = next.raw;
      latest.current = next.value;
      setDraft(next.value);
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
              顾问提案 → 分章小说 → 前三集模板比较
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
              <label className="mt-3 block">
                试看集数
                <select
                  aria-label="试看集数"
                  className={field}
                  value={draft.episodeCount}
                  onChange={e =>
                    change({ episodeCount: Number(e.target.value) as 2 | 3 })
                  }
                >
                  <option value={2}>2集</option>
                  <option value={3}>3集</option>
                </select>
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
                      "recommend_templates"
                    )
                  }
                >
                  按新方向推荐模板
                </button>
                <p className="text-xs text-slate-400">
                  回复会带上前文与当前模板分工。故事线不满意时，写出新方向再点“按新方向推荐模板”；顾问会参考现有大纲与正文，推荐其他已审核模板，说明改变与取舍。原稿和配比保留，推荐不自动采用。
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
              自己挑选或采用顾问推荐，最多5个；可单独生成，也可指定分工组合。
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
              disabled={disabled || !advice || !draft.templates.length}
              className={`${button} mt-4`}
              onClick={() => generate("outline")}
            >
              生成改编提案
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
              确认大纲，开始分章
            </button>
          </section>
        </div>
        <section className="mt-6 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl">03 / 分章小说 · 审阅后再转剧本</h2>
          <p className="mt-2 text-sm text-slate-400">
            每章分别生成与修改。确认下一章前先审阅前文；历史生成稿保留在记录中。
          </p>
          {Array.from({ length: draft.episodeCount }, (_, i) => (
            <div key={i} className="mt-4">
              <div className="flex items-center gap-3">
                <h3>第{i + 1}章</h3>
                <button
                  className={button}
                  disabled={
                    disabled ||
                    !draft.outlineApproved ||
                    draft.outlineApproved !== draft.outline ||
                    (i > 0 && !draft.chapters[i - 1])
                  }
                  onClick={() => generate("chapter", undefined, i + 1)}
                >
                  {draft.chapters[i] ? "重新生成本章" : "生成本章"}
                </button>
              </div>
              <textarea
                aria-label={`第${i + 1}章小说`}
                disabled={disabled}
                className={field}
                rows={8}
                maxLength={6600}
                value={draft.chapters[i] || ""}
                onChange={e => {
                  const chapters = [...draft.chapters];
                  chapters[i] = e.target.value;
                  change({ chapters, novelApproved: "" });
                }}
              />
            </div>
          ))}
          <button
            disabled={
              disabled ||
              !draft.outlineApproved ||
              draft.outlineApproved !== draft.outline ||
              draft.chapters.filter(c => c.trim().length >= 500).length !==
                draft.episodeCount
            }
            className={`${button} mt-4 bg-amber-200 text-slate-950`}
            onClick={() => change({ novelApproved: currentNovel })}
          >
            确认这版小说，进入模板比较
          </button>
        </section>
        <section className="mt-6 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl">04 / 模板候选与前三集比较</h2>
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
                onClick={() => generate("script", t.publicId)}
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
              onClick={() => generate("script")}
            >
              按分工组合生成
            </button>
          </div>
          <NovelTemplateComparison runs={draft.runs} />
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

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { creativeUserText } from "@/lib/creativeUserText";
import {
  COVER_DIRECTIONS,
  COVER_DRAFT_CREDITS,
  COVER_FINAL_CREDITS,
  coverBriefSchema,
  coverBriefFieldsSchema,
  coverRequestSchema,
  type CoverBrief,
  type CoverRequest,
} from "@shared/coverWorkshop";

const blank: CoverBrief = {
  description: "",
  headline: "",
  style: "",
  aspectRatio: "9:16",
  references: [],
};
const inputClass =
  "mt-2 w-full rounded-xl border border-[var(--hp-line)] bg-[var(--hp-bg)] p-3 text-base text-[var(--hp-ink)]";
const buttonClass =
  "min-h-11 rounded-xl bg-[var(--hp-accent)] px-5 py-3 font-bold text-white disabled:opacity-50";
const secondaryClass =
  "min-h-11 rounded-xl border border-[var(--hp-line)] px-4 py-2 text-sm text-[var(--hp-ink)] disabled:opacity-50";
const finalEditSchema = z.object({
  selected: z.number().int().min(0).max(2).nullable(),
  changes: z.string().max(1500),
});
type FinalEdit = z.infer<typeof finalEditSchema>;
const emptyFinalEdit: FinalEdit = { selected: null, changes: "" };
function readFinalEdits(raw: unknown): Record<string, FinalEdit> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([id, value]) => {
      const parsed = finalEditSchema.safeParse(value);
      return z.string().uuid().safeParse(id).success && parsed.success
        ? [[id, parsed.data]]
        : [];
    })
  );
}
function readLocal(userId: string) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`cover-workshop:${userId}`) || "{}"
    );
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {};
  } catch {
    return {};
  }
}
export default function HomeCoverWorkshop() {
  const { user } = useAuth({ autoFetch: true });
  return (
    <CoverWorkspace
      key={user?.id || "guest"}
      userId={user ? String(user.id) : "guest"}
    />
  );
}
export function CoverWorkspace({ userId }: { userId: string }) {
  const loggedIn = userId !== "guest";
  const [saved] = useState(() => readLocal(userId));
  const [brief, setBrief] = useState<CoverBrief>(() =>
    coverBriefFieldsSchema.safeParse(saved.brief).success
      ? coverBriefFieldsSchema.parse(saved.brief)
      : blank
  );
  const [id, setId] = useState<string>(
    typeof saved.id === "string" ? saved.id : ""
  );
  const [pending, setPending] = useState<CoverRequest | null>(() => {
    const parsed = coverRequestSchema.safeParse(saved.pending);
    return parsed.success ? parsed.data : null;
  });
  const [finalEdits, setFinalEdits] = useState(() =>
    readFinalEdits(saved.finalEdits)
  );
  const { selected, changes } = finalEdits[id] || emptyFinalEdit;
  const updateFinalEdit = (patch: Partial<FinalEdit>) =>
    setFinalEdits(edits => ({
      ...edits,
      [id]: { ...(edits[id] || emptyFinalEdit), ...patch },
    }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const inFlight = useRef(false);
  const prepare = trpc.coverWorkshop.prepare.useMutation();
  const submit = trpc.coverWorkshop.submit.useMutation();
  const recover = trpc.coverWorkshop.recover.useMutation();
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const history = trpc.coverWorkshop.list.useQuery(
    { accountId: userId },
    {
      enabled: loggedIn,
      retry: false,
    }
  );
  const current = trpc.coverWorkshop.get.useQuery(
    { id: id || "00000000-0000-4000-8000-000000000000" },
    {
      enabled: loggedIn && Boolean(id),
      retry: false,
      refetchInterval: query =>
        query.state.data?.items.some(
          item => item.status === "running" || item.status === "queued"
        )
          ? 5000
          : false,
    }
  );
  const data = current.data?.id === id ? current.data : undefined;
  useEffect(() => {
    try {
      localStorage.setItem(
        `cover-workshop:${userId}`,
        JSON.stringify({ brief, id, pending, finalEdits })
      );
    } catch {
      setError("本机保存失败，请保留本页；已确认的云端设计仍可从历史打开。");
    }
  }, [brief, id, pending, finalEdits, userId]);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(creativeUserText(e instanceof Error ? e.message : String(e)));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const prepareRequest = async (request: CoverRequest) => {
    setPending(request);
    // 在网络请求之前保存身份；响应丢失后仍恢复同一设计，不创建另一份收费任务。
    localStorage.setItem(
      `cover-workshop:${userId}`,
      JSON.stringify({ brief, id, pending: request, finalEdits })
    );
    const row = await prepare.mutateAsync(request);
    if (!alive.current) return;
    setId(row.id);
    setPending(null);
    await history.refetch();
  };
  const update = (patch: Partial<CoverBrief>) =>
    setBrief(b => ({ ...b, ...patch }));
  const prepareDrafts = () =>
    void run(async () => {
      const parsed = coverBriefSchema.parse(brief);
      await prepareRequest({
        id: crypto.randomUUID(),
        stage: "draft",
        brief: parsed,
      });
    });
  const chooseRecord = (next: string) => {
    setId(next);
    setError("");
  };
  const allPrepared = data?.items.every(item => item.status === "prepared");
  const somePrepared = data?.items.some(item => item.status === "prepared");
  return (
    <div className="mt-7 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-5 text-[var(--hp-ink)] sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--hp-accent)]">
            从一个想法，到一张想点开的封面
          </p>
          <h3 className="mt-3 text-2xl font-bold">吸睛封面设计</h3>
          <p className="mt-3 max-w-2xl leading-7 text-[var(--hp-muted)]">
            说出想法，或上传参考图。先看三款不同方向的 2K
            初稿，挑中喜欢的，再精修成稿。
          </p>
        </div>
        <span className="text-sm text-[var(--hp-muted)]">
          三款初稿 {COVER_DRAFT_CREDITS} 积分 · 成稿另计 {COVER_FINAL_CREDITS}{" "}
          积分
        </span>
      </div>
      <div className="mt-7 grid gap-7 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <label className="block font-medium">
            你想要什么样的封面？
            <textarea
              aria-label="封面想法"
              rows={4}
              maxLength={4000}
              value={brief.description}
              onChange={e => update({ description: e.target.value })}
              placeholder="例如：旅行咖啡馆里的随拍感，不看镜头，人物自然放松；也可以做产品、课程、小说或音乐封面。"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            上传参考图片（可选，最多四张）
            <input
              aria-label="封面参考图片"
              className={`${inputClass} text-sm`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={!loggedIn || busy || brief.references.length >= 4}
              onChange={e => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                void run(async () => {
                  if (files.length + brief.references.length > 4)
                    throw Error("最多上传四张参考图片");
                  if (
                    files.some(
                      f =>
                        !["image/png", "image/jpeg", "image/webp"].includes(
                          f.type
                        ) || f.size > 20 * 1024 * 1024
                    )
                  )
                    throw Error("请使用20MB以内的PNG、JPEG或WebP图片");
                  const refs = [...brief.references];
                  for (const [index, file] of Array.from(files.entries())) {
                    if (!alive.current) return;
                    const asset = await uploadOneCanvasAsset({
                      file,
                      index,
                      getSignedUploadUrl: input => upload.mutateAsync(input),
                    });
                    if (asset.previewUrl?.startsWith("blob:"))
                      URL.revokeObjectURL(asset.previewUrl);
                    if (!asset.gcsUri) throw Error("图片尚未保存成功");
                    if (!alive.current) return;
                    refs.push(asset.gcsUri);
                    if (alive.current) update({ references: [...refs] });
                  }
                });
              }}
            />
          </label>
          {brief.references.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {brief.references.map((ref, i) => (
                <button
                  className={secondaryClass}
                  key={ref}
                  disabled={busy}
                  onClick={() =>
                    update({
                      references: brief.references.filter((_, j) => i !== j),
                    })
                  }
                >
                  参考 {i + 1} · 移除
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              封面标题（可选）
              <input
                aria-label="封面标题"
                className={inputClass}
                value={brief.headline}
                maxLength={80}
                placeholder="不填则不加文字"
                onChange={e => update({ headline: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              画面比例
              <select
                aria-label="封面比例"
                className={inputClass}
                value={brief.aspectRatio}
                onChange={e =>
                  update({
                    aspectRatio: e.target.value as CoverBrief["aspectRatio"],
                  })
                }
              >
                <option value="9:16">竖版 9:16</option>
                <option value="16:9">横版 16:9</option>
                <option value="1:1">方形 1:1</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">
            想保留的风格（可选）
            <input
              aria-label="封面风格"
              className={inputClass}
              maxLength={500}
              value={brief.style}
              onChange={e => update({ style: e.target.value })}
              placeholder="如：真实摄影、温暖绘本、极简产品……"
            />
          </label>
          <button
            className={buttonClass}
            disabled={!loggedIn || busy || Boolean(pending)}
            onClick={prepareDrafts}
          >
            整理三款设计 · 不扣积分
          </button>
          {!loggedIn && (
            <p className="text-sm">
              <a className="underline" href={getLoginUrl()}>
                登录后上传图片、保存设计和生成封面
              </a>
            </p>
          )}
        </div>
        <div className="space-y-4" aria-label="三种设计方向">
          {COVER_DIRECTIONS.map((d, i) => (
            <div
              key={d.title}
              className="rounded-2xl border border-[var(--hp-line)] p-5"
            >
              <span className="text-xs font-bold text-[var(--hp-accent)]">
                0{i + 1}
              </span>
              <h4 className="mt-2 text-lg font-bold">{d.title}</h4>
              <p className="mt-2 text-sm leading-6 text-[var(--hp-muted)]">
                {d.description}
              </p>
            </div>
          ))}
        </div>
      </div>
      {pending && (
        <div className="mt-5 rounded-xl border border-amber-500/40 p-4">
          <p>设计保存尚待确认。恢复同一份设计不会生成图片或扣积分。</p>
          <button
            className={secondaryClass}
            disabled={busy}
            onClick={() => void run(() => prepareRequest(pending))}
          >
            恢复待确认设计
          </button>
          <button
            className={`${secondaryClass} ml-2`}
            disabled={busy}
            onClick={() => {
              setPending(null);
              setError("");
            }}
          >
            返回修改设计
          </button>
        </div>
      )}
      {(error || current.error || history.error) && (
        <p
          role="alert"
          className="mt-5 whitespace-pre-wrap rounded-xl border border-red-500/40 p-4 text-sm"
        >
          {error ||
            creativeUserText(
              current.error?.message || history.error?.message || ""
            )}
        </p>
      )}
      {loggedIn && (
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <label className="text-sm">
            已保存的设计
            <select
              aria-label="已保存的封面"
              className={`${inputClass} max-w-sm`}
              value={id}
              disabled={busy}
              onChange={e => chooseRecord(e.target.value)}
            >
              <option value="">选择一份设计</option>
              {history.data?.map(row => (
                <option key={row.id} value={row.id}>
                  {row.stage === "draft" ? "初稿" : "成稿"} ·{" "}
                  {row.title.slice(0, 40)} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <button
            className={secondaryClass}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await history.refetch();
                if (id) await current.refetch();
              })
            }
          >
            刷新原任务
          </button>
        </div>
      )}
      {data && (
        <section
          className="mt-8 border-t border-[var(--hp-line)] pt-7"
          aria-label="当前封面设计"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-xl font-bold">
              {data.stage === "draft" ? "三款初稿" : "高画质成稿"} ·{" "}
              {data.brief.headline || "无文字封面"}
            </h4>
            <p className="text-sm text-[var(--hp-muted)]">
              {data.brief.aspectRatio} · 长边 2048 像素 · 本次{" "}
              {data.totalCredits} 积分
            </p>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7">
            {data.brief.description || "以参考图为内容"}
          </p>
          {data.referencePreviews.length > 0 && (
            <div
              className="my-4 flex gap-3 overflow-x-auto"
              aria-label="本次实际参考图片"
            >
              {data.referencePreviews.map((src, i) => (
                <a href={src} target="_blank" rel="noreferrer" key={src}>
                  <img
                    className="h-24 w-24 rounded-xl object-contain"
                    src={src}
                    alt={`本次参考 ${i + 1}${data.stage === "final" && i === 0 ? "：选定初稿" : ""}`}
                  />
                </a>
              ))}
            </div>
          )}
          <div
            className={`mt-5 grid gap-4 ${data.stage === "draft" ? "md:grid-cols-3" : "max-w-xl"}`}
          >
            {data.items.map(item => (
              <article
                key={item.jobId}
                className={`min-w-0 rounded-2xl border p-4 ${selected === item.index ? "border-[var(--hp-accent)] bg-[var(--hp-accent-soft)]" : "border-[var(--hp-line)]"}`}
              >
                <h5 className="font-bold">
                  {COVER_DIRECTIONS[item.direction].title}
                </h5>
                {item.imageUrl ? (
                  <a href={item.imageUrl} target="_blank" rel="noreferrer">
                    <img
                      className="mt-4 max-h-[520px] w-full rounded-xl object-contain"
                      src={item.imageUrl}
                      alt={`${COVER_DIRECTIONS[item.direction].title}${data.stage === "draft" ? "初稿" : "成稿"}`}
                    />
                  </a>
                ) : (
                  <p className="my-7 text-sm" role="status">
                    {
                      {
                        prepared: "设计已整理，等待确认生成",
                        queued: "已排队",
                        running: "正在制作，请稍候",
                        failed: "本张尚未交付",
                        succeeded: "图片回执缺失，请刷新原任务",
                      }[item.status]
                    }
                  </p>
                )}
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-medium">
                    查看实际设计提示词
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap break-words leading-6">
                    {item.prompt}
                  </p>
                </details>
                <p className="mt-3 break-all text-xs text-[var(--hp-muted)]">
                  任务 {item.jobId} · {item.credits} 积分
                </p>
                {item.error && (
                  <p className="mt-3 whitespace-pre-wrap text-sm" role="alert">
                    {creativeUserText(item.error)}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.imageUrl && data.stage === "draft" && (
                    <button
                      aria-pressed={selected === item.index}
                      className={secondaryClass}
                      disabled={busy}
                      onClick={() => updateFinalEdit({ selected: item.index })}
                    >
                      {selected === item.index ? "已选择此方向" : "选择此方向"}
                    </button>
                  )}
                  {item.imageUrl && (
                    <a
                      className={secondaryClass}
                      href={item.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                    >
                      查看 / 保存图片
                    </a>
                  )}
                  {item.originalUrl && (
                    <a
                      className={secondaryClass}
                      href={item.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      后期前原图
                    </a>
                  )}
                  {item.receiptUrl && (
                    <a
                      className={secondaryClass}
                      href={item.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      后期处理记录
                    </a>
                  )}
                  {item.canRecover && (
                    <button
                      className={secondaryClass}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await recover.mutateAsync({
                            id: data.id,
                            index: item.index,
                          });
                          await current.refetch();
                        })
                      }
                    >
                      恢复原图精修 · 不重新出图
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {somePrepared && (
            <div className="mt-6">
              <p className="mb-3 text-sm leading-6">
                请先查看本次设计内容、参考图片和提示词。点击下方按钮确认本次生成；选择初稿本身不扣积分，成稿另行确认。失败保留已成功的图片，未知结果不会自动再次生成。
              </p>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await submit.mutateAsync({
                      id: data.id,
                      fingerprint: data.fingerprint,
                    });
                    await current.refetch();
                  })
                }
              >
                {allPrepared
                  ? `确认生成${data.stage === "draft" ? "三款 2K 初稿" : "高画质成稿"} · ${data.totalCredits} 积分`
                  : "确认并恢复本批尚未入队的任务"}
              </button>
            </div>
          )}
          {data.stage === "draft" &&
            selected !== null &&
            data.items.some(
              item => item.index === selected && item.imageUrl
            ) && (
              <div className="mt-7 rounded-2xl border border-[var(--hp-accent-line)] p-5">
                <h5 className="font-bold">
                  已选：{COVER_DIRECTIONS[selected].title}
                </h5>
                <label className="mt-3 block text-sm">
                  成稿还想调整哪里？
                  <textarea
                    aria-label="成稿修改"
                    className={inputClass}
                    rows={3}
                    maxLength={1500}
                    value={changes}
                    disabled={busy}
                    onChange={e => updateFinalEdit({ changes: e.target.value })}
                    placeholder="例如：保留构图，人物再小一点，标题移到左侧。"
                  />
                </label>
                <button
                  className={`${buttonClass} mt-4`}
                  disabled={busy || Boolean(pending)}
                  onClick={() =>
                    void run(() =>
                      prepareRequest({
                        id: crypto.randomUUID(),
                        stage: "final",
                        batchId: data.id,
                        candidate: selected,
                        changes,
                      })
                    )
                  }
                >
                  查看成稿设计 · 生成另计 {COVER_FINAL_CREDITS} 积分
                </button>
              </div>
            )}
        </section>
      )}
    </div>
  );
}

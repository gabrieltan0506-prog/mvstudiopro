import { saveRemixProductionHandoff } from "@/lib/remixProductionHandoff";
import React, { useEffect, useRef, useState } from "react";
import {
  draftFromEvidence,
  exportRemixMarkdown,
  exportRemixPackage,
  buildRemixRewriteInput,
  remixDraftSchema,
  type RemixDraft,
  type RemixEvidence,
} from "@shared/remixDraft";

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RemixDraftEditor({
  evidence,
  format,
  userId,
  brief,
  onRewrite,
  rewriteCost = 0,
  onBusyChange,
}: {
  evidence: RemixEvidence | null;
  format: RemixDraft["format"];
  userId: number;
  brief: string;
  onRewrite?: (
    input: ReturnType<typeof buildRemixRewriteInput>
  ) => Promise<string>;
  rewriteCost?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const storageKey = `mvsp-remix-editor-v1:${userId}:${format}`;
  const [draft, setDraft] = useState<RemixDraft>(() =>
    draftFromEvidence({}, format, brief)
  );
  const [readyKey, setReadyKey] = useState("");
  const [status, setStatus] = useState("");
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [candidate, setCandidate] = useState<{
    id: string;
    text: string;
    before: string;
  } | null>(null);
  useEffect(() => {
    onBusyChange?.(rewriteBusy);
    return () => onBusyChange?.(false);
  }, [rewriteBusy, onBusyChange]);
  const rewriteLock = useRef(false);
  const mounted = useRef(true);
  const [readError, setReadError] = useState(false);
  const [deleted, setDeleted] = useState<{
    row: RemixDraft["units"][number];
    index: number;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const persistCandidate = (value: typeof candidate) => {
    try {
      value
        ? localStorage.setItem(`${storageKey}:candidate`, JSON.stringify(value))
        : localStorage.removeItem(`${storageKey}:candidate`);
      return true;
    } catch {
      if (mounted.current)
        setStatus("候选保存失败，请复制或下载备份，避免刷新丢失");
      return false;
    }
  };
  useEffect(() => {
    if (!rewriteBusy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [rewriteBusy]);
  const [confirmReplace, setConfirmReplace] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? remixDraftSchema.parse(JSON.parse(raw)) : null;
      if (saved && saved.format !== format) throw new Error("草稿类型不匹配");
      setDraft(saved || draftFromEvidence({}, format, brief));
      setStatus(saved ? "已恢复本机草稿" : "修改自动保存在当前浏览器");
      setReadyKey(storageKey);
      setReadError(false);
    } catch {
      setDraft(draftFromEvidence({}, format, brief));
      setReadError(true);
      setStatus("草稿读取失败，原记录已保留。请下载原始记录后新建草稿。");
      setReadyKey("");
    }
    setConfirmReplace(false);
    try {
      const raw = localStorage.getItem(`${storageKey}:candidate`);
      const value = raw ? JSON.parse(raw) : null;
      setCandidate(
        value &&
          typeof value.id === "string" &&
          typeof value.text === "string" &&
          typeof value.before === "string"
          ? value
          : null
      );
    } catch {
      setStatus("候选记录读取失败，原记录未删除");
    }
  }, [storageKey]);
  useEffect(() => {
    if (readyKey !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      setStatus("本机保存失败，请下载草稿备份，避免刷新丢失。");
    }
  }, [draft, readyKey, storageKey]);
  const patch = (index: number, value: Partial<RemixDraft["units"][number]>) =>
    setDraft(d => ({
      ...d,
      units: d.units.map((r, i) => (i === index ? { ...r, ...value } : r)),
    }));
  const move = (index: number, delta: number) =>
    setDraft(d => {
      const units = [...d.units];
      const target = index + delta;
      if (target < 0 || target >= units.length) return d;
      [units[index], units[target]] = [units[target]!, units[index]!];
      return { ...d, units };
    });
  const adopt = () => {
    if (!evidence) return;
    setDraft(draftFromEvidence(evidence, format, brief));
    setConfirmReplace(false);
    setCandidate(null);
    persistCandidate(null);
    setDeleted(null);
    setStatus(
      format === "video"
        ? "已载入本次拆解；时长与音轨仍需核对"
        : "已载入封面及明确标注的页面；未标页正文完整保留在下方，可手动分到新页面"
    );
  };
  const field =
    "mt-2 w-full rounded-xl border border-white/20 bg-[#101622] p-3 text-sm leading-6 text-white focus:border-orange-300 focus:outline-none";
  const button =
    "rounded-xl border border-white/20 px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-40";
  const total = draft.units.reduce(
    (sum, row) => sum + (row.durationSeconds || 0),
    0
  );
  return (
    <section
      aria-label="复刻编辑稿"
      className="mt-6 rounded-3xl border border-orange-200/25 bg-[#151b28] p-4 text-white sm:p-6"
    >
      {rewriteBusy && (
        <p role="status" className="mb-4 text-orange-200">
          正在改写当前内容，原稿保留；请勿重复提交。
        </p>
      )}
      {readError && (
        <div role="alert" className="mb-4 flex flex-wrap gap-3">
          <button
            className={button}
            onClick={() => {
              try {
                download(
                  localStorage.getItem(storageKey) || "",
                  "复刻草稿原始备份.json",
                  "application/json"
                );
              } catch {
                setStatus("浏览器阻止了读取，请检查存储权限");
              }
            }}
          >
            下载原始记录
          </button>
          <button
            className={button}
            onClick={() => {
              if (
                window.confirm("确认已备份？新建将覆盖本机损坏的草稿记录。")
              ) {
                setReadError(false);
                setReadyKey(storageKey);
              }
            }}
          >
            新建可保存草稿
          </button>
        </div>
      )}
      <fieldset disabled={rewriteBusy || readError} className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">
              {format === "video" ? "复刻分镜稿" : "逐页编辑"}
            </h2>
            <p role="status" className="mt-2 text-xs leading-6 text-white/65">
              {status} · 草稿不等于已生成成品
            </p>
          </div>
          <button
            className={button}
            disabled={!evidence}
            onClick={() =>
              draft.units.length || draft.body || draft.title
                ? setConfirmReplace(true)
                : adopt()
            }
          >
            载入本次拆解
          </button>
        </div>
        {confirmReplace && (
          <div role="alert" className="my-4 rounded-xl bg-orange-400/10 p-4">
            <p className="text-sm">
              载入会替换当前编辑稿及未采用候选，先下载或复制可保留旧稿。
            </p>
            <div className="mt-3 flex gap-3">
              <button className={button} onClick={adopt}>
                替换当前稿
              </button>
              <button
                className={button}
                onClick={() => setConfirmReplace(false)}
              >
                保留当前稿
              </button>
            </div>
          </div>
        )}
        <div className="my-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            作品标题
            <input
              className={field}
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            这次换成什么内容？
            <textarea
              className={field}
              rows={2}
              value={draft.brief}
              onChange={e => setDraft(d => ({ ...d, brief: e.target.value }))}
              placeholder="例如：保留悬念结构，换成我的人物、产品和案例"
            />
          </label>
        </div>
        {!draft.units.length && (
          <p className="rounded-xl border border-dashed border-white/20 p-6 text-sm leading-7 text-white/60">
            完成上方参考分析后，点击“载入本次拆解”。也可以添加
            {format === "video" ? "镜头" : "页面"}
            自行编排；不会自动填入虚构内容。
          </p>
        )}
        <div className="space-y-4">
          {draft.units.map((row, index) => (
            <article
              key={row.id}
              className="rounded-2xl border border-white/15 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">
                  {format === "video" ? "镜头" : "页面"} {index + 1}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    aria-label={`上移第${index + 1}项`}
                    className={button}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`下移第${index + 1}项`}
                    className={button}
                    disabled={index === draft.units.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className={button}
                    onClick={() => {
                      setDeleted({ row, index });
                      setDraft(d => ({
                        ...d,
                        units: d.units.filter(r => r.id !== row.id),
                      }));
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl bg-black/15 p-3">
                  <p className="text-xs text-white/50">参考拆解依据</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-white/75">
                    {row.source || "手动添加，无原片/原页依据"}
                  </p>
                </div>
                <label className="text-sm">
                  本次{format === "video" ? "镜头内容" : "页面内容"}
                  <textarea
                    className={field}
                    rows={5}
                    value={row.content}
                    onChange={e => patch(index, { content: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-4">
                <label className="text-xs">
                  采用方式
                  <select
                    className={field}
                    value={row.decision}
                    onChange={e =>
                      patch(index, {
                        decision: e.target.value as typeof row.decision,
                      })
                    }
                  >
                    <option value="keep">沿用结构</option>
                    <option value="replace">替换内容</option>
                    <option value="rework">重新设计</option>
                  </select>
                </label>
                {format === "video" && (
                  <>
                    <label className="text-xs">
                      时长（秒，可暂留空）
                      <input
                        className={field}
                        type="number"
                        min="0.001"
                        step="any"
                        value={row.durationSeconds ?? ""}
                        onChange={e => {
                          const n = Number(e.target.value);
                          patch(index, {
                            durationSeconds:
                              e.target.value && Number.isFinite(n) && n > 0
                                ? n
                                : null,
                          });
                        }}
                      />
                    </label>
                    <label className="min-w-0 flex-1 text-xs">
                      对白 / 音效 / 配乐
                      <input
                        className={field}
                        value={row.sound}
                        onChange={e => patch(index, { sound: e.target.value })}
                        placeholder="按动作、对白或情绪变化安排，不套固定卡点"
                      />
                    </label>
                  </>
                )}
              </div>
              {onRewrite && (
                <button
                  disabled={Boolean(candidate)}
                  title={candidate ? "请先处理已有改写候选" : undefined}
                  className={`${button} mt-4`}
                  onClick={() => {
                    void (async () => {
                      if (rewriteLock.current) return;
                      rewriteLock.current = true;
                      try {
                        const input = buildRemixRewriteInput(draft, row.id);
                        setRewriteBusy(true);
                        const text = (await onRewrite(input)).trim();
                        if (!text)
                          throw new Error("改写未返回内容，原稿已保留");
                        const next = { id: row.id, text, before: row.content };
                        const saved = persistCandidate(next);
                        if (mounted.current) {
                          setCandidate(next);
                          if (saved)
                            setStatus("改写结果已返回并保存，请对照后采用");
                        }
                      } catch (error) {
                        if (mounted.current)
                          setStatus(
                            error instanceof Error
                              ? error.message
                              : "改写失败，原稿保留"
                          );
                      } finally {
                        rewriteLock.current = false;
                        if (mounted.current) setRewriteBusy(false);
                      }
                    })();
                  }}
                >
                  按我的要求改写这一{format === "video" ? "镜" : "页"}（
                  {rewriteCost}积分）
                </button>
              )}
            </article>
          ))}
        </div>
        {deleted && (
          <button
            className={`${button} mt-4 mr-3`}
            onClick={() => {
              setDraft(d => {
                const units = [...d.units];
                if (!units.some(r => r.id === deleted.row.id))
                  units.splice(
                    Math.min(deleted.index, units.length),
                    0,
                    deleted.row
                  );
                return { ...d, units };
              });
              setDeleted(null);
            }}
          >
            撤销最近一次删除
          </button>
        )}
        <button
          className={`${button} mt-4`}
          onClick={() =>
            setDraft(d => ({
              ...d,
              units: [
                ...d.units,
                {
                  id: crypto.randomUUID(),
                  source: "",
                  content: "",
                  decision: "rework",
                  durationSeconds: null,
                  sound: "",
                },
              ],
            }))
          }
        >
          + 添加{format === "video" ? "镜头" : "页面"}
        </button>
        {format === "video" ? (
          <p className="mt-4 text-xs text-white/65">
            已编排 {total} 秒 ·{" "}
            {draft.units.filter(r => r.durationSeconds === null).length}{" "}
            镜待定。总时长与镜数不设固定上限。
          </p>
        ) : (
          <label className="mt-5 block text-sm">
            发布正文
            <textarea
              rows={7}
              className={field}
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
            />
          </label>
        )}
        {candidate && (
          <div className="mt-5 rounded-xl border border-orange-200/30 p-4">
            <h3 className="font-semibold">改写候选 · 尚未采用</h3>
            <pre className="my-3 whitespace-pre-wrap break-words font-sans text-sm leading-7">
              {candidate.text}
            </pre>
            <button
              className={button}
              onClick={() => {
                const index = draft.units.findIndex(r => r.id === candidate.id);
                if (
                  index < 0 ||
                  draft.units[index]!.content !== candidate.before
                ) {
                  setStatus("原稿已修改，候选未覆盖；请复制需要的内容");
                  return;
                }
                patch(index, { content: candidate.text });
                setCandidate(null);
                persistCandidate(null);
                setStatus("已采用本次改写，其他镜头/页面未改动");
              }}
            >
              采用这版
            </button>
            <button
              className={`${button} ml-2`}
              onClick={() => {
                setCandidate(null);
                persistCandidate(null);
              }}
            >
              保留原稿
            </button>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-xl bg-orange-200 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
            disabled={!draft.units.length}
            onClick={() => {
              try {
                saveRemixProductionHandoff(userId, draft);
                window.location.assign(
                  format === "video"
                    ? "/canvas?from=remix"
                    : "/platform?mode=create&tab=copy&from=remix"
                );
              } catch (e) {
                setStatus(
                  e instanceof Error
                    ? e.message
                    : "交接保存失败，请下载备份后再继续"
                );
              }
            }}
          >
            去制作{format === "video" ? "视频" : "笔记"}
          </button>
          <button
            className={button}
            disabled={!draft.units.length && !draft.body}
            onClick={() =>
              download(
                exportRemixMarkdown(draft),
                "复刻编辑稿.md",
                "text/markdown;charset=utf-8"
              )
            }
          >
            下载{format === "note" ? "图文与正文" : "分镜文字稿"}
          </button>
          <button
            className={button}
            disabled={!draft.units.length && !draft.body}
            onClick={() =>
              download(
                JSON.stringify(exportRemixPackage(draft), null, 2),
                "复刻交接稿.json",
                "application/json"
              )
            }
          >
            下载可编辑交接稿
          </button>
        </div>
      </fieldset>
      <p className="mt-3 text-xs leading-6 text-white/50">
        交接稿保留全部编辑内容。
        {format === "video"
          ? "ChatCut需另行绑定真实素材并建立时间线，下载不会提交生成任务。"
          : "逐页画面与排版尚需制作，下载稿不会自动发布。"}
      </p>
    </section>
  );
}

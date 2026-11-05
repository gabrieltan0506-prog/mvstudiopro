import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import KnowledgePublicationPanel from "./KnowledgePublicationPanel";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  buildLayoutHtml,
  editableLayoutSchema,
  layoutFromSource,
  layoutLibrarySchema,
  layoutImageSchema,
  type EditableLayout,
  type LayoutLibrary,
  type LayoutSource,
} from "@shared/editableLayout";
import {
  downloadLayoutBlob,
  exportEditableLayout,
} from "@/lib/editableLayoutExport";
type Cache = {
  library: LayoutLibrary;
  generation: string;
  dirty: boolean;
  activeId: string;
};
const button =
  "rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
const field =
  "w-full rounded-lg border border-white/20 bg-[#201b32] p-2 text-white";
/** 按账号恢复，条件写入防止旧会话覆盖新稿。 */
export default function EditableLayoutStudio({
  owner,
  source,
}: {
  owner: string;
  source: LayoutSource | null;
}) {
  const key = `mvstudiopro.editableLayout.v1.${owner}`;
  const [state, setState] = useState<Cache>({
    library: { version: 1, owner, documents: [] },
    generation: "0",
    dirty: false,
    activeId: "",
  });
  const current = useRef(state);
  const cacheWritable = useRef(true);
  const alive = useRef(true);
  const sourceSeen = useRef<LayoutSource | null>(null);
  const [ready, setReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [autoPublicationId,setAutoPublicationId]=useState("");
  const utils = trpc.useUtils();
  const saveMutation = trpc.editableLayout.save.useMutation();
  const install = (next: Cache) => {
    current.current = next;
    setState(next);
    try {
      if (!cacheWritable.current) throw new Error("本机原记录尚未安全备份");
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError(
        "浏览器保存失败，当前内容仍在页面；请立即导出稿件备份或保存云端"
      );
    }
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let local = current.current;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        const library = layoutLibrarySchema.parse(value.library);
        if (library.owner !== owner || !/^\d+$/.test(value.generation))
          throw new Error("本机稿件账号或版本不匹配");
        local = {
          library,
          generation: value.generation,
          dirty: Boolean(value.dirty),
          activeId: String(value.activeId || ""),
        };
        current.current = local;
        setState(local);
      }
    } catch {
      // 自动恢复云端前先保留损坏原文；备份失败时禁止后续本机写入覆盖它。
      try {
        if (raw === null) throw new Error("浏览器存储不可读");
        localStorage.setItem(`${key}.unreadable.${Date.now()}`, raw);
        setError("本机稿件无法读取，已另存原始副本；正在读取云端稿件");
      } catch {
        cacheWritable.current = false;
        setError("本机原记录无法备份，未覆盖；请保存云端或导出当前稿件");
      }
    }
    void utils.editableLayout.get
      .fetch()
      .then(result => {
        if (cancelled) return;
        if (result.library && result.library.owner !== owner)
          throw new Error("云端稿件账号不匹配，未读取");
        if (!local.dirty)
          install({
            library: result.library || { version: 1, owner, documents: [] },
            generation: result.generation,
            dirty: false,
            activeId: local.activeId,
          });
        else if (result.generation !== local.generation)
          setError(
            "云端有不同版本，本机修改已保留；先导出备份，再读取云端，避免覆盖"
          );
        setCloudReady(true);
      })
      .catch(e => {
        if (!cancelled) setError(`云端读取失败，本机稿保留：${e.message}`);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [owner]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (current.current.dirty || locked.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const add = (doc: EditableLayout) => {
    const old = current.current;
    const library = layoutLibrarySchema.parse({
      ...old.library,
      documents: [...old.library.documents, doc],
    });
    install({ ...old, library, dirty: true, activeId: doc.id });
    setPageIndex(0);
    if(doc.publication)setAutoPublicationId(doc.id);
    setOpen(true);
  };
  useEffect(() => {
    if (
      !ready ||
      busy ||
      !source ||
      source.owner !== owner ||
      source === sourceSeen.current
    )
      return;
    sourceSeen.current = source;
    try {
      add(layoutFromSource(source));
      setMessage("已导入现有稿件，原稿保留。修改后请保存云端。");
    } catch (e) {
      setOpen(true);
      setError(e instanceof Error ? e.message : "稿件导入失败，未截断内容");
    }
  }, [source, ready, busy]);
  const doc =
    state.library.documents.find(d => d.id === state.activeId) ||
    state.library.documents[0];
  const index = doc ? Math.min(pageIndex, doc.pages.length - 1) : 0;
  const page = doc?.pages[index];
  const update = (patch: Partial<EditableLayout>) => {
    if (!doc) return;
    const nextDoc = { ...doc, ...patch, updatedAt: new Date().toISOString() };
    install({
      ...current.current,
      dirty: true,
      library: {
        ...current.current.library,
        documents: current.current.library.documents.map(d =>
          d.id === doc.id ? nextDoc : d
        ),
      },
    });
  };
  const commitPublication = async(nextDoc:EditableLayout) => {
    const previous=current.current;
    const library=layoutLibrarySchema.parse({...previous.library,documents:previous.library.documents.map(d=>d.id===nextDoc.id?nextDoc:d)});
    install({...previous,library,dirty:true});
    const result=await saveMutation.mutateAsync({library,expectedGeneration:previous.generation});
    if(alive.current)install({...current.current,generation:result.generation,dirty:current.current.library!==library});
    return {generation:result.generation};
  };
  const editPage = (patch: Partial<EditableLayout["pages"][number]>) => {
    if (doc)
      update({
        pages: doc.pages.map((p, i) => (i === index ? { ...p, ...patch } : p)),
      });
  };
  const action = async (run: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "操作失败，原稿已保留");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = () =>
    action(async () => {
      const captured = current.current;
      layoutLibrarySchema.parse(captured.library);
      const result = await saveMutation.mutateAsync({
        library: captured.library,
        expectedGeneration: captured.generation,
      });
      if (!alive.current) return;
      install({
        ...current.current,
        generation: result.generation,
        dirty: current.current.library !== captured.library,
      });
      setMessage(
        `云端已保存 · ${new Date(result.updatedAt).toLocaleString("zh-CN")}`
      );
    });
  const restore = () =>
    action(async () => {
      if (
        current.current.dirty &&
        !window.confirm(
          "读取云端将替换当前本机修改。请先导出稿件备份。确定继续？"
        )
      )
        return;
      const result = await utils.editableLayout.get.fetch();
      if (!alive.current) return;
      if (result.library && result.library.owner !== owner)
        throw new Error("云端稿件账号不匹配，未读取");
      install({
        library: result.library || { version: 1, owner, documents: [] },
        generation: result.generation,
        dirty: false,
        activeId: "",
      });
      setCloudReady(true);
      setPageIndex(0);
      setMessage(result.library ? "已读取云端完整稿件" : "云端尚无排版稿");
    });
  const backup = () =>
    downloadLayoutBlob(
      new Blob([JSON.stringify(current.current.library, null, 2)], {
        type: "application/json",
      }),
      "排版稿件备份.json"
    );
  const importBackup = (file: File) =>
    action(async () => {
      if (file.size > 64 * 1024 * 1024) throw new Error("备份超过64MB，未读取");
      const library = layoutLibrarySchema.parse(JSON.parse(await file.text()));
      if (library.owner !== owner) throw new Error("备份属于其他账号，未导入");
      const incoming = library.documents.map(d => ({
        ...d,
        id: crypto.randomUUID(),
        ...(d.publication ? {publication:{...d.publication,requestId:crypto.randomUUID(),completedBatches:0,attempts:{},review:undefined,confirmedManuscript:undefined}} : {}),
      }));
      const merged = layoutLibrarySchema.parse({
        ...current.current.library,
        documents: [...current.current.library.documents, ...incoming],
      });
      install({
        ...current.current,
        library: merged,
        activeId: incoming[0]?.id || current.current.activeId,
        dirty: true,
      });
      setPageIndex(0);
      setMessage("备份已作为独立稿件导入，已有稿件保留");
    });
  let preview = "";
  if (doc) {
    try {
      preview = buildLayoutHtml(doc, {}, true).replace(
        "</head>",
        `<style>.page{display:none}.page:nth-of-type(${index + 1}){display:block}</style></head>`
      );
    } catch {
      /* 编辑中的空标题保留，导出时校验。 */
    }
  }
  return (
    <section
      id="editable-layout-studio"
      className="mb-5 rounded-2xl border border-[#ddbc87]/40 bg-[#181521] p-4 text-white"
      aria-label="可编辑排版与导出"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[#edd4ac]">排版与导出</h3>
          <p className="text-xs text-gray-400">
            知识卡自动审校与图文阅读稿 · 云端保存恢复 · HTML / PDF
          </p>
        </div>
        <button className={button} onClick={() => setOpen(!open)}>
          {open
            ? "收起排版"
            : `打开稿件库（${state.library.documents.length}）`}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          {!ready && <p role="status">正在读取稿件…</p>}
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={!ready || !cloudReady || busy || !state.dirty}
              onClick={() => void save()}
            >
              保存云端
            </button>
            <button
              className={button}
              disabled={!ready || busy}
              onClick={() => void restore()}
            >
              读取云端
            </button>
            <button
              className={button}
              disabled={!ready || busy}
              onClick={backup}
            >
              导出稿件备份
            </button>
            <label className={button}>
              导入备份
              <input
                aria-label="导入排版备份"
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={!ready || busy}
                onChange={e => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void importBackup(f);
                }}
              />
            </label>
            <span className="self-center text-xs text-amber-100">
              {state.dirty ? "有修改尚未保存云端" : "无未保存修改"}
            </span>
          </div>
          {message && (
            <p role="status" className="text-sm text-emerald-200">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-200">
              {sanitizePlatformUserMessage(error)}
            </p>
          )}
          {!doc ? (
            <p className="text-sm text-gray-300">
              在下方已有稿件点击“编辑排版与导出”，即可带入正文与现有配图；原稿保留。
            </p>
          ) : (
            <fieldset disabled={!ready || (busy && !doc.publication)} className="space-y-4">
              <label className="block text-sm">
                已保存稿件
                <select
                  aria-label="选择排版稿件"
                  className={field}
                  value={doc.id}
                  disabled={busy}
                  onChange={e => {
                    install({ ...current.current, activeId: e.target.value });
                    setPageIndex(0);
                  }}
                >
                  {state.library.documents.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              {doc.publication ? <KnowledgePublicationPanel key={doc.id} doc={doc} commit={commitPublication}
                onChange={next=>update(next)} onBusy={value=>{locked.current=value;setBusy(value);}} autoStart={doc.id===autoPublicationId}/>:<>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <label className="block text-sm">
                    稿件标题
                    <input
                      aria-label="排版稿标题"
                      className={field}
                      value={doc.title}
                      maxLength={500}
                      onChange={e => update({ title: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label>
                      画幅
                      <select
                        aria-label="排版画幅"
                        className={field}
                        value={doc.aspect}
                        onChange={e =>
                          update({
                            aspect: e.target.value as EditableLayout["aspect"],
                          })
                        }
                      >
                        <option>3:4</option>
                        <option>9:16</option>
                        <option>1:1</option>
                      </select>
                    </label>
                    <label>
                      风格
                      <select
                        aria-label="排版风格"
                        className={field}
                        value={doc.theme}
                        onChange={e =>
                          update({
                            theme: e.target.value as EditableLayout["theme"],
                          })
                        }
                      >
                        <option value="paper">暖纸</option>
                        <option value="ink">深墨</option>
                        <option value="sage">青叶</option>
                      </select>
                    </label>
                    <label>
                      字号
                      <input
                        aria-label="排版字号"
                        className={field}
                        type="number"
                        min={18}
                        max={36}
                        value={doc.fontSize}
                        onChange={e => {
                          const n = Number(e.target.value);
                          if (n >= 18 && n <= 36)
                            update({ fontSize: Math.round(n) });
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {doc.pages.map((p, i) => (
                      <button
                        key={p.id}
                        className={button}
                        aria-pressed={i === index}
                        onClick={() => setPageIndex(i)}
                      >
                        第{i + 1}页
                      </button>
                    ))}
                  </div>
                  {page && (
                    <>
                      <label className="block">
                        本页标题
                        <input
                          aria-label="本页标题"
                          className={field}
                          value={page.headline}
                          maxLength={500}
                          onChange={e => editPage({ headline: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        本页正文
                        <textarea
                          aria-label="本页正文"
                          className={field}
                          rows={9}
                          value={page.body}
                          maxLength={50000}
                          onChange={e => editPage({ body: e.target.value })}
                        />
                      </label>
                      {page.imageUrl && (
                        <div className="rounded-xl border border-white/15 p-3">
                          <img
                            src={
                              layoutImageSchema.safeParse(page.imageUrl).success
                                ? page.imageUrl
                                : undefined
                            }
                            alt="本页原有配图"
                            className="max-h-48 max-w-full"
                          />
                          <select
                            aria-label="配图位置"
                            className={field}
                            value={page.imagePlacement}
                            onChange={e =>
                              editPage({
                                imagePlacement: e.target.value as
                                  | "above"
                                  | "below",
                              })
                            }
                          >
                            <option value="above">图片在文字上方</option>
                            <option value="below">图片在文字下方</option>
                          </select>
                          <button
                            className={button}
                            onClick={() => editPage({ imageUrl: "" })}
                          >
                            移除本页配图
                          </button>
                        </div>
                      )}
                      <details className="text-sm">
                        <summary>替换配图</summary>
                        <label>
                          图片地址
                          <input
                            aria-label="本页配图地址"
                            className={field}
                            value={page.imageUrl}
                            onChange={e =>
                              editPage({ imageUrl: e.target.value })
                            }
                          />
                        </label>
                      </details>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={button}
                          disabled={index === 0}
                          onClick={() => {
                            const pages = [...doc.pages];
                            [pages[index - 1], pages[index]] = [
                              pages[index],
                              pages[index - 1],
                            ];
                            update({ pages });
                            setPageIndex(index - 1);
                          }}
                        >
                          上移本页
                        </button>
                        <button
                          className={button}
                          disabled={index === doc.pages.length - 1}
                          onClick={() => {
                            const pages = [...doc.pages];
                            [pages[index + 1], pages[index]] = [
                              pages[index],
                              pages[index + 1],
                            ];
                            update({ pages });
                            setPageIndex(index + 1);
                          }}
                        >
                          下移本页
                        </button>
                        <button
                          className={button}
                          disabled={doc.pages.length >= 100}
                          onClick={() => {
                            update({
                              pages: [
                                ...doc.pages,
                                {
                                  id: crypto.randomUUID(),
                                  headline: "新页",
                                  body: "",
                                  imageUrl: "",
                                  imagePlacement: "below",
                                },
                              ],
                            });
                            setPageIndex(doc.pages.length);
                          }}
                        >
                          新增一页
                        </button>
                        <button
                          className={button}
                          disabled={doc.pages.length <= 1}
                          onClick={() => {
                            if (
                              window.confirm("移除当前页？原始稿件不受影响。")
                            ) {
                              update({
                                pages: doc.pages.filter((_, i) => i !== index),
                              });
                              setPageIndex(Math.max(0, index - 1));
                            }
                          }}
                        >
                          移除本页
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs text-gray-400">
                    排版预览 · 长内容自动延长页面，不裁掉正文。
                  </p>
                  <iframe
                    title="排版预览"
                    sandbox="allow-same-origin"
                    srcDoc={preview}
                    className="h-[650px] w-full rounded-xl border-0 bg-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["html", "png", "pdf"] as const).map(format => (
                  <button
                    key={format}
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const exact = editableLayoutSchema.parse(doc);
                        const blob = await exportEditableLayout(exact, format);
                        downloadLayoutBlob(
                          blob,
                          `${exact.title}.${format === "png" ? "zip" : format}`
                        );
                        setMessage(
                          `已导出${format === "png" ? "逐页PNG压缩包" : format.toUpperCase()} · ${exact.pages.length}页`
                        );
                      })
                    }
                  >
                    {busy
                      ? "处理中…"
                      : format === "html"
                        ? "导出可编辑HTML"
                        : format === "png"
                          ? "导出逐页PNG"
                          : "导出PDF"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                HTML包含完整文字和配图，可离线改字；PNG/PDF为排版成品。已生成图片中的文字仍属于图片，不能单独改字。
              </p>
              </>}
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}

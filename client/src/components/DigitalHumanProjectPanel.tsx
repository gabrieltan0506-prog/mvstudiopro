import { digitalHumanPostProdMedia } from "@/lib/digitalHumanPostProd";
import { digitalHumanProjectSegmentOutputs as digitalHumanSegmentOutputs } from "@/lib/digitalHumanProjectMedia";
import { useState } from "react";
import { useDigitalHumanStorage } from "@/lib/useDigitalHumanStorage";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import {
  currentDigitalHumanAudio,
  digitalHumanPending,
} from "@shared/digitalHumanStudio";
import {
  digitalHumanProjectSegments,
  ensureDigitalHumanProject,
} from "@shared/digitalHumanProject";
import { DigitalHumanPostProdWorkbench } from "./DigitalHumanPostProdWorkbench";

export type DigitalHumanProjectView = "overview" | "segment" | "output";
export function DigitalHumanProjectPanel(props: {
  draft: DigitalHumanDraft;
  view: DigitalHumanProjectView;
  setView: (v: DigitalHumanProjectView) => void;
  save: (fn: (d: DigitalHumanDraft) => DigitalHumanDraft) => void;
  select: (id: string) => Promise<void>;
  add: (chapter?: string) => Promise<void>;
  disabled: boolean;
  beforeSubmit: () => Promise<void>;
  acquireWork: (label: string) => () => void;
  role: string;
}) {
  const [chapterFilter, setChapterFilter] = useState<string | null>(null);
  const [newChapter, setNewChapter] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  const draft = ensureDigitalHumanProject(props.draft),
    project = draft.project!;
  const segments = digitalHumanProjectSegments(draft);
  function save(fn: (d: DigitalHumanDraft) => DigitalHumanDraft) {
    try {
      props.save(d => fn(ensureDigitalHumanProject(d)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function metadata(
    id: string,
    patch: Partial<(typeof project.segments)[number]>
  ) {
    save(d => ({
      ...d,
      project: {
        ...d.project!,
        segments: d.project!.segments.map(s =>
          s.id === id ? { ...s, ...patch } : s
        ),
      },
    }));
  }
  function move(id: string, offset: number) {
    save(d => {
      const rows = [...d.project!.segments],
        index = rows.findIndex(s => s.id === id),
        target = index + offset;
      if (index < 0 || target < 0 || target >= rows.length) return d;
      [rows[index], rows[target]] = [rows[target], rows[index]];
      return { ...d, project: { ...d.project!, segments: rows } };
    });
  }
  const storage = useDigitalHumanStorage(project.postProdStorage, update => props.save(raw => {
    const d = ensureDigitalHumanProject(raw);
    return { ...d, project: { ...d.project!, postProdStorage: update(d.project!.postProdStorage) } };
  }));
  const status = (d: DigitalHumanDraft) =>
    d.videos.some(v => digitalHumanPending(v.status))
      ? "生成中"
      : digitalHumanSegmentOutputs(d).length
        ? "待验收"
        : d.keyframes?.some(k => k.adopted)
          ? "关键帧已审"
          : d.script.trim()
            ? "待制作"
            : "待编排";
  const filtered = segments.filter(
    s =>
      `${s.title} ${s.chapter} ${s.draft.script}`.includes(query) &&
      (filter === "all" || status(s.draft) === filter) &&
      (chapterFilter === null || s.chapter === chapterFilter)
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10)),
    currentPage = Math.min(page, pages - 1);
  const clips = segments.flatMap((s, i) =>
    digitalHumanSegmentOutputs(s.draft)
      .filter(v => v.source === s.selectedSource)
      .map(v => ({
        id: `${s.id}:${v.id}`,
        url: v.source,
        label: `${i + 1}. ${s.title} · ${v.label}`,
      }))
  );
  const chapters = Array.from(
    new Set(segments.map(s => s.chapter).filter(Boolean))
  );
  return (
    <div className="dh-project">
      <nav className="dh-project-nav" aria-label="整片工作流">
        {(
          [
            ["overview", "整片总览"],
            ["segment", "分段制作"],
            ["output", "合成与输出"],
          ] as const
        ).map(([v, label]) => (
          <button
            type="button"
            key={v}
            aria-current={props.view === v ? "page" : undefined}
            onClick={() => props.setView(v)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      <header className="dh-project-heading">
        <div>
          <p className="dh-eyebrow">
            {props.view === "overview"
              ? "整片总览"
              : props.view === "segment"
                ? "分段制作"
                : "合成与输出"}
          </p>
          <input
            aria-label="影片名称"
            value={project.title}
            maxLength={200}
            disabled={props.disabled}
            onChange={e => {
              const title = e.target.value;
              if (title.trim())
                save(d => ({ ...d, project: { ...d.project!, title } }));
            }}
          />
          <p>
            {chapters.length} 个章节 · {segments.length} 个段落 · {clips.length}{" "}
            段已选成片
          </p>
        </div>
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => void props.add()}
        >
          ＋ 新增段落
        </button>
      </header>
      {props.view === "segment" && (
        <div className="dh-segment-strip" aria-label="段落导航">
          {segments.map((s, i) => (
            <button
              type="button"
              disabled={props.disabled}
              key={s.id}
              aria-current={s.id === draft.id ? "true" : undefined}
              onClick={() => void props.select(s.id)}
            >
              {String(i + 1).padStart(2, "0")} {s.title}
            </button>
          ))}
        </div>
      )}
      {props.view === "overview" && (
        <section className="dh-card dh-project-overview">
          <aside className="dh-chapter-rail" aria-label="章节筛选">
            <h3>章节与段落</h3>
            <button
              type="button"
              aria-pressed={chapterFilter === null}
              onClick={() => {
                setChapterFilter(null);
                setPage(0);
              }}
            >
              全部段落 · {segments.length}
            </button>
            {["", ...chapters].map(chapter => (
              <button
                type="button"
                key={chapter}
                aria-pressed={chapterFilter === chapter}
                onClick={() => {
                  setChapterFilter(chapter);
                  setPage(0);
                }}
              >
                {chapter || "未分章节"} ·{" "}
                {segments.filter(s => s.chapter === chapter).length}
              </button>
            ))}
            <label>
              新增章节
              <input
                aria-label="新章节名称"
                maxLength={200}
                value={newChapter}
                onChange={e => setNewChapter(e.target.value)}
                placeholder="输入章节名称"
              />
            </label>
            <button
              type="button"
              disabled={props.disabled || !newChapter.trim()}
              onClick={() => {
                void props.add(newChapter.trim());
                setNewChapter("");
              }}
            >
              建立章节并新增段落
            </button>
          </aside>
          <div className="dh-overview-main">
            <div className="dh-project-filters">
              <input
                aria-label="搜索段落"
                placeholder="搜索标题、章节或台词…"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
              <select
                aria-label="段落状态"
                value={filter}
                onChange={e => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">全部状态</option>
                {["待编排", "待制作", "关键帧已审", "生成中", "待验收"].map(
                  s => (
                    <option key={s}>{s}</option>
                  )
                )}
              </select>
            </div>
            <div className="dh-project-table">
              <table>
                <thead>
                  <tr>
                    <th>章节与段落</th>
                    <th>台词摘要</th>
                    <th>原声时长</th>
                    <th>制作状态</th>
                    <th>顺序与编辑</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .slice(currentPage * 10, currentPage * 10 + 10)
                    .map(s => {
                      const index = segments.findIndex(v => v.id === s.id),
                        audio = currentDigitalHumanAudio(s.draft);
                      return (
                        <tr key={s.id}>
                          <td>
                            <input
                              aria-label={`段落${index + 1}名称`}
                              value={s.title}
                              maxLength={200}
                              disabled={props.disabled}
                              onChange={e => {
                                if (e.target.value.trim())
                                  metadata(s.id, { title: e.target.value });
                              }}
                            />
                            <input
                              aria-label={`段落${index + 1}章节`}
                              placeholder="章节名称（可选）"
                              list="dh-project-chapters"
                              value={s.chapter}
                              maxLength={200}
                              disabled={props.disabled}
                              onChange={e =>
                                metadata(s.id, { chapter: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <p>{s.draft.script || "尚未填写台词"}</p>
                          </td>
                          <td>
                            {audio?.durationSec
                              ? `${audio.durationSec.toFixed(1)} 秒`
                              : "未录制"}
                          </td>
                          <td>
                            <span className="dh-project-status">
                              {status(s.draft)}
                            </span>
                          </td>
                          <td>
                            <div className="dh-project-actions">
                              <button
                                type="button"
                                aria-label={`上移${s.title}`}
                                disabled={props.disabled || index === 0}
                                onClick={() => move(s.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`下移${s.title}`}
                                disabled={
                                  props.disabled ||
                                  index === segments.length - 1
                                }
                                onClick={() => move(s.id, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                disabled={props.disabled}
                                onClick={() => void props.select(s.id)}
                              >
                                进入编辑 →
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <datalist id="dh-project-chapters">
              {chapters.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <footer className="dh-project-pagination">
              <span>
                共 {filtered.length} 段 · 第 {currentPage + 1} / {pages} 页
              </span>
              <button
                type="button"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                disabled={currentPage + 1 >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </footer>
          </div>
        </section>
      )}
      {props.view === "output" && (
        <section className="dh-project-output">
          <h3>逐段选择已审成片</h3>
          <p>
            按项目顺序选择版本，再在下方核对拼接顺序、转场、画幅与声音。原片和历史版本都会保留。
          </p>
          {segments.map((s, i) => (
            <label className="dh-output-selection" key={s.id}>
              <span>
                {i + 1}. {s.chapter && `${s.chapter} / `}
                {s.title}
              </span>
              <select
                aria-label={`${s.title}成片版本`}
                disabled={props.disabled}
                value={s.selectedSource || ""}
                onChange={e =>
                  metadata(s.id, {
                    selectedSource: e.target.value || undefined,
                  })
                }
              >
                <option value="">请选择已审版本</option>
                {digitalHumanSegmentOutputs(s.draft).map(v => (
                  <option key={v.id} value={v.source}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p>
            {clips.length} / {segments.length}{" "}
            段已选。单次拼接容量以剪辑工具提示为准；较长影片可分批导出后继续拼接。
          </p>
          <DigitalHumanPostProdWorkbench
            orderedClipIds={clips.map(c => c.id)}
            key={project.id}
            draft={draft}
            drafts={segments.map(s => s.draft)}
            userRole={props.role}
            scope={`digital-human:project:${project.id}`}
            media={{
              clips,
              audio: segments.flatMap(s => digitalHumanPostProdMedia(s.draft).audio),
              story: segments.map(s => s.draft.script).join("\n"),
            }}
            storage={storage}
            beforeSubmit={props.beforeSubmit}
            acquireWork={props.acquireWork}
            disabled={props.disabled}
          />
        </section>
      )}
    </div>
  );
}

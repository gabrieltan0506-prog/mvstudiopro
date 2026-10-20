import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import type { listLocalManhuaProjects } from "@/lib/novelFactoryProject";
import "./CreativeProjects.css";

export default function MusicMvProjects() {
  const { user, loading } = useAuth();
  if (loading) return <main className="p-8">正在读取账号…</main>;
  if (!user)
    return (
      <main className="p-8">
        <a href="/login">请先登录</a>
      </main>
    );
  return <MusicMvProjectLibrary key={user.id} userId={String(user.id)} />;
}

export function MusicMvProjectLibrary({ userId }: { userId: string }) {
  const [local, setLocal] = useState<
    ReturnType<typeof listLocalManhuaProjects>
  >([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busyRef = useRef(false);
  const cloud = trpc.manhuaCloudDraft.listProjects.useQuery(undefined, {
    retry: 1,
  });
  const save = trpc.manhuaCloudDraft.upsert.useMutation();
  const reload = async () => {
    const { listLocalManhuaProjects } = await import(
      "@/lib/novelFactoryProject"
    );
    const rows = listLocalManhuaProjects(localStorage, userId);
    if (alive.current) setLocal(rows);
  };
  useEffect(() => {
    alive.current = true;
    void reload()
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
    return () => {
      alive.current = false;
    };
  }, [userId]);
  const projects = new Map(
    (cloud.data?.projects || [])
      .filter(p => p.kind === "mv")
      .map(p => [p.projectId, p])
  );
  for (const row of local.filter(p => p.kind === "mv")) {
    const previous = projects.get(row.projectId);
    if (!previous || row.updatedAt >= previous.updatedAt)
      projects.set(row.projectId, row);
  }
  const items = Array.from(projects.values())
    .filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const create = async () => {
    if (busyRef.current || !title.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { createEmptyManhuaProject } = await import(
        "@/lib/novelFactoryProject"
      );
      const { scopedManhuaStorage, parseManhuaProjectScope } = await import(
        "@shared/manhuaProjectScope"
      );
      const { buildManhuaCloudDraftPayload } = await import(
        "@shared/manhuaCloudDraft"
      );
      const { parseManhuaWriterSession, MANHUA_WRITER_SESSION_LS_KEY } =
        await import("@shared/manhuaWriterSession");
      const { CLOUD_DRAFT_BASE_KEY } = await import(
        "@/lib/manhuaDraftRecovery"
      );
      const href = createEmptyManhuaProject(localStorage, userId, title, "mv");
      const scope = parseManhuaProjectScope(href.slice(href.indexOf("?")))!;
      const storage = scopedManhuaStorage(localStorage, scope);
      const writerSession = parseManhuaWriterSession(
        storage.getItem(MANHUA_WRITER_SESSION_LS_KEY)
      )!;
      const canvas = JSON.parse(storage.getItem("mv-freeform-canvas-v1")!);
      const payload = buildManhuaCloudDraftPayload({
        writerSession,
        blocks: canvas.blocks,
        edges: canvas.edges,
        clientUpdatedAt: storage.getItem("mv-manhua-cloud-draft-local-at-v1")!,
        factoryPrefs: { topic: title.trim() },
      });
      const receipt = await save.mutateAsync({
        projectId: scope.projectId,
        expectedGeneration: "0",
        payloadJson: JSON.stringify(payload),
      });
      if (!receipt.generation)
        throw new Error(
          "云端保存缺少版本回执，本机作品已保留，请打开后核对云端。"
        );
      storage.setItem(CLOUD_DRAFT_BASE_KEY, receipt.generation);
      if (alive.current) window.location.assign(href);
    } catch (e) {
      if (alive.current) {
        setError(
          `${e instanceof Error ? e.message : "创建未完成"} 已写入本机的作品会保留在列表中。`
        );
        await reload();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <main className="creative-projects" data-mv-projects>
      <div className="creative-projects-inner">
        <nav className="creative-projects-nav">
          <a href="/#image-workshop">← 影像工坊</a>
          <a href="/manhua-projects">我的漫剧</a>
          <a href="/novel-projects">我的小说</a>
        </nav>
        <header className="creative-projects-heading">
          <div>
            <span className="creative-projects-eyebrow">音乐影像</span>
            <h1>我的 MV</h1>
            <p>选定一首歌，逐步完成视觉方案、镜头与剪辑。每部作品独立保存。</p>
          </div>
          <span className="creative-projects-count">
            {projects.size} 部作品
          </span>
        </header>
        <form
          className="creative-projects-create"
          onSubmit={e => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            作品名称
            <input
              aria-label="新MV作品名称"
              value={title}
              maxLength={200}
              disabled={busy}
              onChange={e => setTitle(e.target.value)}
              placeholder="歌曲名，或这支 MV 的名字"
            />
          </label>
          <button disabled={busy || !title.trim()}>
            {busy ? "正在保存…" : "新建 MV"}
          </button>
        </form>
        <p className="creative-projects-note">
          制作歌词、歌曲与方形专辑封面，或选择30–60秒高光制作抖音MV。新建只建立作品，不会生成歌曲、图片或视频。
        </p>
        {error && (
          <p role="alert" className="creative-projects-error">
            {error}
          </p>
        )}
        {cloud.isError && (
          <p role="alert">
            云端作品暂时无法读取，本机作品保留。
            <button onClick={() => void cloud.refetch()}>重试云端</button>
          </p>
        )}
        {cloud.data?.hasMore && (
          <p role="alert">
            云端作品列表尚未全部载入，可通过已保存的作品地址继续。
          </p>
        )}
        <div className="creative-projects-list-heading">
          <h2>继续制作</h2>
          <input
            aria-label="搜索MV作品"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索 MV 名称"
          />
        </div>
        {(loading || cloud.isLoading) && <p role="status">正在读取作品…</p>}
        {!loading && !cloud.isLoading && !items.length && (
          <p className="creative-projects-empty">
            {search ? "没有匹配的 MV" : "新建第一部 MV，从选歌开始。"}
          </p>
        )}
        <div className="creative-projects-list">
          {items.map(p => (
            <article className="creative-project-row" key={p.projectId}>
              <div className="creative-project-copy">
                <h3>{p.title}</h3>
                <p>歌曲、分镜、镜头与成片保存在同一作品中</p>
                <small>
                  {p.updatedAt
                    ? `最近保存 ${new Date(p.updatedAt).toLocaleString()}`
                    : "本机作品"}
                  {!cloud.data?.projects.some(
                    row => row.projectId === p.projectId
                  ) && " · 云端尚未确认"}
                </small>
              </div>
              <div className="creative-project-actions">
                <a
                  aria-disabled={busy}
                  onClick={e => {
                    if (busy) e.preventDefault();
                  }}
                  href={`/canvas?project=${p.projectId}&owner=${userId}&workflow=mv`}
                >
                  继续制作
                </a>
              </div>
            </article>
          ))}
        </div>
        <p className="creative-projects-note">
          已有作品在原自由画布中？
          <a href="/canvas?workflow=mv" className="underline">
            打开原画布继续
          </a>
          ，已有节点与任务保留。
        </p>
      </div>
    </main>
  );
}
